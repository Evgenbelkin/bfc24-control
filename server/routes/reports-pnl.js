const express = require("express");
const pool = require("../db");
const {
  authRequired,
  getEffectiveTenantId,
} = require("../middleware/auth");

const router = express.Router();

function normalizeText(value) {
  return String(value || "").trim();
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * GET /reports/pnl
 * query:
 * - tenant_id
 * - date_from (YYYY-MM-DD)
 * - date_to   (YYYY-MM-DD)
 *
 * PnL v1:
 * - revenue      = core.sales.total_amount
 * - cogs         = core.sale_items.qty * core.items.purchase_price
 * - expenses     = core.expenses.amount
 * - gross_profit = revenue - cogs
 * - net_profit   = gross_profit - expenses
 */
router.get("/pnl", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const dateFrom = normalizeText(req.query.date_from || "");
    const dateTo = normalizeText(req.query.date_to || "");

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    if (dateFrom && !isValidDate(dateFrom)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_date_from",
      });
    }

    if (dateTo && !isValidDate(dateTo)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_date_to",
      });
    }

    const salesParams = [tenantId];
    let salesWhere = `WHERE s.tenant_id = $1`;

    if (dateFrom) {
      salesParams.push(dateFrom);
      salesWhere += ` AND s.created_at >= $${salesParams.length}::date`;
    }

    if (dateTo) {
      salesParams.push(dateTo);
      salesWhere += ` AND s.created_at < ($${salesParams.length}::date + INTERVAL '1 day')`;
    }

    const revenueSql = `
      SELECT
        COUNT(*)::int AS sales_count,
        COALESCE(SUM(s.total_amount), 0) AS revenue_total,
        COALESCE(SUM(s.paid_amount), 0) AS paid_total,
        COALESCE(SUM(s.debt_amount), 0) AS debt_total
      FROM core.sales s
      ${salesWhere}
    `;

    const cogsSql = `
      SELECT
        COALESCE(SUM(si.qty), 0) AS sold_qty_total,
        COALESCE(SUM(si.qty * COALESCE(i.purchase_price, 0)), 0) AS cogs_total
      FROM core.sale_items si
      INNER JOIN core.sales s
        ON s.id = si.sale_id
      LEFT JOIN core.items i
        ON i.id = si.item_id
       AND i.tenant_id = s.tenant_id
      ${salesWhere}
    `;

    const expensesParams = [tenantId];
    let expensesWhere = `WHERE e.tenant_id = $1`;

    if (dateFrom) {
      expensesParams.push(dateFrom);
      expensesWhere += ` AND e.expense_date >= $${expensesParams.length}::date`;
    }

    if (dateTo) {
      expensesParams.push(dateTo);
      expensesWhere += ` AND e.expense_date <= $${expensesParams.length}::date`;
    }

    const expensesSql = `
      SELECT
        COUNT(*)::int AS expenses_count,
        COALESCE(SUM(e.amount), 0) AS expenses_total
      FROM core.expenses e
      ${expensesWhere}
    `;

    const expensesByCategorySql = `
      SELECT
        e.category,
        COALESCE(SUM(e.amount), 0) AS total_amount,
        COUNT(*)::int AS rows_count
      FROM core.expenses e
      ${expensesWhere}
      GROUP BY e.category
      ORDER BY total_amount DESC, e.category ASC
    `;

    const [revenueResult, cogsResult, expensesResult, expensesByCategoryResult] =
      await Promise.all([
        pool.query(revenueSql, salesParams),
        pool.query(cogsSql, salesParams),
        pool.query(expensesSql, expensesParams),
        pool.query(expensesByCategorySql, expensesParams),
      ]);

    const revenueRow = revenueResult.rows[0] || {};
    const cogsRow = cogsResult.rows[0] || {};
    const expensesRow = expensesResult.rows[0] || {};

    const salesCount = toNumber(revenueRow.sales_count);
    const revenueTotal = toNumber(revenueRow.revenue_total);
    const paidTotal = toNumber(revenueRow.paid_total);
    const debtTotal = toNumber(revenueRow.debt_total);

    const soldQtyTotal = toNumber(cogsRow.sold_qty_total);
    const cogsTotal = toNumber(cogsRow.cogs_total);

    const expensesCount = toNumber(expensesRow.expenses_count);
    const expensesTotal = toNumber(expensesRow.expenses_total);

    const grossProfit = revenueTotal - cogsTotal;
    const netProfit = grossProfit - expensesTotal;

    const averageCheck = salesCount > 0 ? revenueTotal / salesCount : 0;
    const grossMarginPercent = revenueTotal > 0 ? (grossProfit / revenueTotal) * 100 : 0;
    const netMarginPercent = revenueTotal > 0 ? (netProfit / revenueTotal) * 100 : 0;

    const expensesByCategory = (expensesByCategoryResult.rows || []).map((row) => ({
      category: row.category,
      total_amount: toNumber(row.total_amount),
      rows_count: toNumber(row.rows_count),
    }));

    return res.json({
      ok: true,
      pnl: {
        tenant_id: Number(tenantId),
        date_from: dateFrom || null,
        date_to: dateTo || null,

        revenue_total: revenueTotal,
        paid_total: paidTotal,
        debt_total: debtTotal,
        sales_count: salesCount,
        sold_qty_total: soldQtyTotal,
        average_check: averageCheck,

        cogs_total: cogsTotal,
        expenses_total: expensesTotal,
        expenses_count: expensesCount,

        gross_profit: grossProfit,
        net_profit: netProfit,

        gross_margin_percent: Number(grossMarginPercent.toFixed(2)),
        net_margin_percent: Number(netMarginPercent.toFixed(2)),
      },
      expenses_by_category: expensesByCategory,
      meta: {
        calculation_mode: "pnl_v1_purchase_price",
        notes: [
          "revenue = core.sales.total_amount",
          "cogs = core.sale_items.qty * core.items.purchase_price",
          "expenses = core.expenses.amount",
          "later_upgrade_planned = FIFO_batches",
        ],
      },
    });
  } catch (e) {
    console.error("[GET /reports/pnl] error:", e);
    return res.status(500).json({
      ok: false,
      error: "pnl_report_failed",
      details: e.message,
    });
  }
});

module.exports = router;