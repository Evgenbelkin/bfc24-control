"use strict";

const express = require("express");
const pool = require("../db");
const {
  authRequired,
  getEffectiveTenantId,
} = require("../middleware/auth");

const router = express.Router();

router.get("/pnl", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenant_not_defined" });
    }

    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    const salesParams = [tenantId];
    let salesWhere = "WHERE s.tenant_id = $1";

    if (dateFrom) {
      salesParams.push(dateFrom);
      salesWhere += ` AND s.created_at >= $${salesParams.length}::date`;
    }
    if (dateTo) {
      salesParams.push(dateTo);
      salesWhere += ` AND s.created_at < ($${salesParams.length}::date + INTERVAL '1 day')`;
    }

    const { rows: salesRows } = await pool.query(
      `
      SELECT
        COALESCE(SUM(si.line_amount), 0) AS revenue,
        COALESCE(SUM(si.qty * si.cost_price), 0) AS cogs,
        COALESCE(SUM(si.gross_profit), 0) AS gross_profit,
        COALESCE(SUM(si.discount_amount), 0) AS total_discount,
        COUNT(DISTINCT s.id) AS sales_count,
        COUNT(si.id) AS line_items_count,

        COALESCE(SUM(
          CASE
            WHEN s.payment_method = 'cash' AND s.payment_status IN ('paid', 'partial')
            THEN s.paid_amount
            ELSE 0
          END
        ), 0) AS revenue_cash,

        COALESCE(SUM(
          CASE
            WHEN s.payment_method = 'card' AND s.payment_status IN ('paid', 'partial')
            THEN s.paid_amount
            ELSE 0
          END
        ), 0) AS revenue_card,

        COALESCE(SUM(
          CASE
            WHEN s.payment_method = 'transfer' AND s.sale_type <> 'consignment' AND s.payment_status IN ('paid', 'partial')
            THEN s.paid_amount
            ELSE 0
          END
        ), 0) AS revenue_transfer,

        COALESCE(SUM(
          CASE
            WHEN s.sale_type = 'consignment'
            THEN s.total_amount
            ELSE 0
          END
        ), 0) AS revenue_consignment,

        COALESCE(SUM(
          CASE
            WHEN s.sale_type = 'consignment'
            THEN s.paid_amount
            ELSE 0
          END
        ), 0) AS consignment_paid

      FROM core.sales s
      JOIN core.sale_items si
        ON si.sale_id = s.id
       AND si.tenant_id = s.tenant_id
      ${salesWhere}
      `,
      salesParams
    );

    const expParams = [tenantId];
    let expWhere = "WHERE tenant_id = $1 AND transaction_type = 'expense'";

    if (dateFrom) {
      expParams.push(dateFrom);
      expWhere += ` AND created_at >= $${expParams.length}::date`;
    }
    if (dateTo) {
      expParams.push(dateTo);
      expWhere += ` AND created_at < ($${expParams.length}::date + INTERVAL '1 day')`;
    }

    const { rows: expRows } = await pool.query(
      `
      SELECT
        COALESCE(SUM(amount), 0) AS total_expenses,
        COALESCE(SUM(CASE WHEN category = 'rent' THEN amount ELSE 0 END), 0) AS rent,
        COALESCE(SUM(CASE WHEN category = 'salary' THEN amount ELSE 0 END), 0) AS salary,
        COALESCE(SUM(CASE WHEN category = 'delivery' THEN amount ELSE 0 END), 0) AS delivery,
        COALESCE(SUM(CASE WHEN category = 'ads' THEN amount ELSE 0 END), 0) AS ads,
        COALESCE(SUM(CASE WHEN category = 'utilities' THEN amount ELSE 0 END), 0) AS utilities,
        COALESCE(SUM(CASE WHEN category = 'other' THEN amount ELSE 0 END), 0) AS other,
        COALESCE(SUM(CASE WHEN category IS NULL OR category = '' THEN amount ELSE 0 END), 0) AS uncategorized
      FROM core.cash_transactions
      ${expWhere}
      `,
      expParams
    );

    const s = salesRows[0];
    const e = expRows[0];

    const revenue = Number(s.revenue);
    const cogs = Number(s.cogs);
    const grossProfit = Number(s.gross_profit);
    const totalExpenses = Number(e.total_expenses);
    const netProfit = Math.round((grossProfit - totalExpenses) * 100) / 100;
    const grossMargin = revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : 0;
    const netMargin = revenue > 0 ? Math.round((netProfit / revenue) * 10000) / 100 : 0;

    return res.json({
      ok: true,
      period: {
        date_from: dateFrom || null,
        date_to: dateTo || null,
      },
      pnl: {
        revenue,
        total_discount: Number(s.total_discount),
        cogs,
        gross_profit: grossProfit,
        gross_margin_pct: grossMargin,
        operating_expenses: totalExpenses,
        expenses_breakdown: {
          rent: Number(e.rent),
          salary: Number(e.salary),
          delivery: Number(e.delivery),
          ads: Number(e.ads),
          utilities: Number(e.utilities),
          other: Number(e.other),
          uncategorized: Number(e.uncategorized),
        },
        net_profit: netProfit,
        net_margin_pct: netMargin,
        sales_count: Number(s.sales_count),
        line_items_count: Number(s.line_items_count),
        revenue_by_method: {
          cash: Number(s.revenue_cash),
          card: Number(s.revenue_card),
          transfer: Number(s.revenue_transfer),
          consignment: Number(s.revenue_consignment),
          consignment_paid: Number(s.consignment_paid),
        },
      },
    });
  } catch (err) {
    console.error("[GET /reports/pnl] error:", err);
    return res.status(500).json({ ok: false, error: "pnl_report_failed" });
  }
});

router.get("/stock-value", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenant_not_defined" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        i.id AS item_id,
        i.name AS item_name,
        i.sku,
        i.unit,
        i.sale_price,

        COALESCE(SUM(b.qty_remaining), 0) AS qty_in_batches,

        CASE
          WHEN SUM(b.qty_remaining) > 0
          THEN ROUND(SUM(b.qty_remaining * b.unit_cost) / SUM(b.qty_remaining), 4)
          ELSE 0
        END AS avg_unit_cost,

        COALESCE(SUM(b.qty_remaining * b.unit_cost), 0) AS stock_cost_value,
        COALESCE(SUM(b.qty_remaining) * i.sale_price, 0) AS stock_sale_value,
        COALESCE(SUM(b.qty_remaining) * i.sale_price - SUM(b.qty_remaining * b.unit_cost), 0) AS potential_profit,

        COALESCE(
          (
            SELECT SUM(s.qty)
            FROM core.stock s
            WHERE s.tenant_id = b.tenant_id
              AND s.item_id = b.item_id
          ),
          0
        ) AS qty_in_stock

      FROM core.item_batches b
      JOIN core.items i
        ON i.id = b.item_id
       AND i.tenant_id = b.tenant_id
      WHERE b.tenant_id = $1
        AND b.qty_remaining > 0
      GROUP BY i.id, i.name, i.sku, i.unit, i.sale_price, b.tenant_id, b.item_id
      ORDER BY stock_cost_value DESC
      `,
      [tenantId]
    );

    const totals = rows.reduce(
      (acc, r) => {
        acc.cost_value += Number(r.stock_cost_value);
        acc.sale_value += Number(r.stock_sale_value);
        acc.potential_profit += Number(r.potential_profit);
        return acc;
      },
      { cost_value: 0, sale_value: 0, potential_profit: 0 }
    );

    const outOfSync = rows.filter(
      (r) => Math.abs(Number(r.qty_in_batches) - Number(r.qty_in_stock)) > 0.001
    );

    return res.json({
      ok: true,
      stock_value: rows,
      totals: {
        stock_cost_value: Math.round(totals.cost_value * 100) / 100,
        stock_sale_value: Math.round(totals.sale_value * 100) / 100,
        potential_profit: Math.round(totals.potential_profit * 100) / 100,
        total_skus: rows.length,
      },
      sync_check: {
        ok: outOfSync.length === 0,
        out_of_sync: outOfSync.map((r) => ({
          item_id: r.item_id,
          item_name: r.item_name,
          qty_in_stock: Number(r.qty_in_stock),
          qty_in_batches: Number(r.qty_in_batches),
          diff: Number(r.qty_in_batches) - Number(r.qty_in_stock),
        })),
      },
    });
  } catch (err) {
    console.error("[GET /reports/stock-value] error:", err);
    return res.status(500).json({ ok: false, error: "stock_value_failed" });
  }
});

router.get("/item/:id", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenant_not_defined" });
    }

    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_item_id" });
    }

    const { rows: itemRows } = await pool.query(
      `
      SELECT *
      FROM core.items
      WHERE id = $1
        AND tenant_id = $2
      LIMIT 1
      `,
      [itemId, tenantId]
    );

    if (!itemRows.length) {
      return res.status(404).json({ ok: false, error: "item_not_found" });
    }

    const { rows: batches } = await pool.query(
      `
      SELECT
        b.id,
        b.batch_date,
        b.qty_total,
        b.qty_remaining,
        b.qty_total - b.qty_remaining AS qty_sold,
        b.unit_cost,
        b.qty_total * b.unit_cost AS batch_total_cost,
        b.receipt_id,
        b.created_at,
        b.updated_at
      FROM core.item_batches b
      WHERE b.tenant_id = $1
        AND b.item_id = $2
      ORDER BY b.batch_date ASC, b.id ASC
      `,
      [tenantId, itemId]
    );

    const { rows: sales } = await pool.query(
      `
      SELECT
        s.id AS sale_id,
        s.created_at,
        s.payment_method,
        s.payment_status,
        s.sale_type,
        si.qty,
        si.price AS unit_sale_price,
        si.line_amount,
        si.cost_price,
        si.gross_profit,
        si.discount_amount,
        si.batch_deductions,
        cp.name AS counterparty_name
      FROM core.sale_items si
      JOIN core.sales s
        ON s.id = si.sale_id
       AND s.tenant_id = si.tenant_id
      LEFT JOIN core.counterparties cp
        ON cp.id = s.counterparty_id
      WHERE si.tenant_id = $1
        AND si.item_id = $2
      ORDER BY s.created_at DESC
      LIMIT 200
      `,
      [tenantId, itemId]
    );

    const batchAgg = batches.reduce(
      (acc, b) => {
        acc.qty_received += Number(b.qty_total);
        acc.qty_remaining += Number(b.qty_remaining);
        acc.total_invested += Number(b.batch_total_cost);
        return acc;
      },
      { qty_received: 0, qty_remaining: 0, total_invested: 0 }
    );

    const salesAgg = sales.reduce(
      (acc, s) => {
        acc.qty_sold += Number(s.qty);
        acc.revenue += Number(s.line_amount);
        acc.cogs += Number(s.qty) * Number(s.cost_price);
        acc.gross_profit += Number(s.gross_profit);
        acc.discount += Number(s.discount_amount);
        return acc;
      },
      { qty_sold: 0, revenue: 0, cogs: 0, gross_profit: 0, discount: 0 }
    );

    return res.json({
      ok: true,
      item: itemRows[0],
      batches,
      sales,
      summary: {
        qty_received: batchAgg.qty_received,
        qty_remaining: batchAgg.qty_remaining,
        qty_sold: salesAgg.qty_sold,
        total_invested: Math.round(batchAgg.total_invested * 100) / 100,
        revenue: Math.round(salesAgg.revenue * 100) / 100,
        cogs: Math.round(salesAgg.cogs * 100) / 100,
        gross_profit: Math.round(salesAgg.gross_profit * 100) / 100,
        gross_margin_pct:
          salesAgg.revenue > 0
            ? Math.round((salesAgg.gross_profit / salesAgg.revenue) * 10000) / 100
            : 0,
        total_discount: Math.round(salesAgg.discount * 100) / 100,
        avg_unit_cost:
          batchAgg.qty_remaining > 0
            ? Math.round(
                (batches
                  .filter((b) => Number(b.qty_remaining) > 0)
                  .reduce((sum, b) => sum + Number(b.qty_remaining) * Number(b.unit_cost), 0) /
                  batchAgg.qty_remaining) *
                  10000
              ) / 10000
            : 0,
      },
    });
  } catch (err) {
    console.error("[GET /reports/item/:id] error:", err);
    return res.status(500).json({ ok: false, error: "item_report_failed" });
  }
});

module.exports = router;