"use strict";

/**
 * routes/reports.js
 *
 * Финансовые отчёты:
 *  GET /reports/pnl           — P&L за период (агрегат)
 *  GET /reports/pnl-daily     — P&L по дням
 *  GET /reports/top-items     — топ товаров по выручке / прибыли
 *  GET /reports/debts-summary — сводка по долгам
 *  GET /reports/stock-value   — капитализация склада на текущий момент
 *  GET /reports/item/:id      — аналитика по конкретному товару
 */

const express = require("express");
const pool = require("../db");
const {
  authRequired,
  getEffectiveTenantId,
} = require("../middleware/auth");

const router = express.Router();

// ─── GET /reports/pnl ─────────────────────────────────────────────────────────
//
// Отчёт о прибылях и убытках за период.
//
// Источник расходов:
//   core.expenses
//
// Источник продаж:
//   core.sales + core.sale_items
//
// Логика:
//   revenue        = SUM(si.line_amount)
//   cogs           = SUM(si.qty * si.cost_price)
//   gross_profit   = SUM(si.gross_profit)
//   expenses       = SUM(core.expenses.amount)
//   net_profit     = gross_profit - expenses
//
router.get("/pnl", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenant_not_defined" });
    }

    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    // ── Выручка и себестоимость продаж ────────────────────────────────────
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
        -- Выручка (с учётом скидок и фактической суммы строк продаж)
        COALESCE(SUM(si.line_amount), 0)                          AS revenue,

        -- Себестоимость продаж (FIFO/зафиксирована в строке продажи)
        COALESCE(SUM(si.qty * si.cost_price), 0)                  AS cogs,

        -- Валовая прибыль (зафиксирована в момент продажи)
        COALESCE(SUM(si.gross_profit), 0)                         AS gross_profit,

        -- Суммарная скидка
        COALESCE(SUM(si.discount_amount), 0)                      AS total_discount,

        -- Количество продаж
        COUNT(DISTINCT s.id)                                      AS sales_count,

        -- Количество позиций
        COUNT(si.id)                                              AS line_items_count,

        -- Количество проданных единиц
        COALESCE(SUM(si.qty), 0)                                  AS sold_qty_total,

        -- Выручка наличными / картой / переводом
        COALESCE(SUM(CASE WHEN s.payment_method = 'cash'     AND s.payment_status = 'paid'
                          THEN si.line_amount ELSE 0 END), 0)    AS revenue_cash,
        COALESCE(SUM(CASE WHEN s.payment_method = 'card'     AND s.payment_status = 'paid'
                          THEN si.line_amount ELSE 0 END), 0)    AS revenue_card,
        COALESCE(SUM(CASE WHEN s.payment_method = 'transfer' AND s.payment_status = 'paid'
                          THEN si.line_amount ELSE 0 END), 0)    AS revenue_transfer,

        -- Реализация (долги)
        COALESCE(SUM(CASE WHEN s.sale_type = 'consignment'
                          THEN si.line_amount ELSE 0 END), 0)    AS revenue_consignment,

        -- Оплачено из реализации
        COALESCE(SUM(CASE WHEN s.sale_type = 'consignment'
                          THEN s.paid_amount ELSE 0 END), 0)     AS consignment_paid

      FROM core.sales s
      JOIN core.sale_items si
        ON si.sale_id = s.id AND si.tenant_id = s.tenant_id
      ${salesWhere}
      `,
      salesParams
    );

    // ── Операционные расходы (новая таблица core.expenses) ────────────────
    const expParams = [tenantId];
    let expWhere = "WHERE e.tenant_id = $1";

    if (dateFrom) {
      expParams.push(dateFrom);
      expWhere += ` AND e.expense_date >= $${expParams.length}::date`;
    }
    if (dateTo) {
      expParams.push(dateTo);
      expWhere += ` AND e.expense_date <= $${expParams.length}::date`;
    }

    const { rows: expRows } = await pool.query(
      `
      SELECT
        COALESCE(SUM(e.amount), 0)                                                AS total_expenses,
        COALESCE(SUM(CASE WHEN e.category = 'rent'      THEN e.amount ELSE 0 END), 0) AS rent,
        COALESCE(SUM(CASE WHEN e.category = 'salary'    THEN e.amount ELSE 0 END), 0) AS salary,
        COALESCE(SUM(CASE WHEN e.category = 'purchase'  THEN e.amount ELSE 0 END), 0) AS purchase,
        COALESCE(SUM(CASE WHEN e.category = 'delivery'  THEN e.amount ELSE 0 END), 0) AS delivery,
        COALESCE(SUM(CASE WHEN e.category = 'ads'       THEN e.amount ELSE 0 END), 0) AS ads,
        COALESCE(SUM(CASE WHEN e.category = 'utilities' THEN e.amount ELSE 0 END), 0) AS utilities,
        COALESCE(SUM(CASE WHEN e.category = 'other'     THEN e.amount ELSE 0 END), 0) AS other,
        COALESCE(SUM(CASE WHEN e.category IS NULL OR e.category = ''
                          THEN e.amount ELSE 0 END), 0)                           AS uncategorized
      FROM core.expenses e
      ${expWhere}
      `,
      expParams
    );

    // ── Сборка P&L ─────────────────────────────────────────────────────────
    const s = salesRows[0] || {};
    const e = expRows[0] || {};

    const revenue = Number(s.revenue || 0);
    const cogs = Number(s.cogs || 0);
    const grossProfit = Number(s.gross_profit || 0);
    const totalExpenses = Number(e.total_expenses || 0);
    const netProfit = Math.round((grossProfit - totalExpenses) * 100) / 100;
    const grossMargin = revenue > 0
      ? Math.round((grossProfit / revenue) * 10000) / 100
      : 0;
    const netMargin = revenue > 0
      ? Math.round((netProfit / revenue) * 10000) / 100
      : 0;

    return res.json({
      ok: true,
      period: { date_from: dateFrom || null, date_to: dateTo || null },
      pnl: {
        // Выручка
        revenue,
        total_discount: Number(s.total_discount || 0),

        // Себестоимость и валовая прибыль
        cogs,
        gross_profit: grossProfit,
        gross_margin_pct: grossMargin,

        // Операционные расходы
        operating_expenses: totalExpenses,
        expenses_breakdown: {
          rent: Number(e.rent || 0),
          salary: Number(e.salary || 0),
          purchase: Number(e.purchase || 0),
          delivery: Number(e.delivery || 0),
          ads: Number(e.ads || 0),
          utilities: Number(e.utilities || 0),
          other: Number(e.other || 0),
          uncategorized: Number(e.uncategorized || 0),
        },

        // Чистая прибыль
        net_profit: netProfit,
        net_margin_pct: netMargin,

        // Дополнительно
        sales_count: Number(s.sales_count || 0),
        line_items_count: Number(s.line_items_count || 0),
        sold_qty_total: Number(s.sold_qty_total || 0),
        revenue_by_method: {
          cash: Number(s.revenue_cash || 0),
          card: Number(s.revenue_card || 0),
          transfer: Number(s.revenue_transfer || 0),
          consignment: Number(s.revenue_consignment || 0),
          consignment_paid: Number(s.consignment_paid || 0),
        },
      },
      meta: {
        expenses_source: "core.expenses",
        sales_source: "core.sales + core.sale_items",
        cost_source: "core.sale_items.cost_price",
      },
    });

  } catch (err) {
    console.error("[GET /reports/pnl] error:", err);
    return res.status(500).json({ ok: false, error: "pnl_report_failed" });
  }
});

// ─── GET /reports/stock-value ─────────────────────────────────────────────────
//
// Капитализация склада: текущая стоимость остатков по FIFO-ценам.
//
router.get("/stock-value", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenant_not_defined" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        i.id                                              AS item_id,
        i.name                                            AS item_name,
        i.sku,
        i.unit,
        i.sale_price,

        -- Остаток в партиях (должен совпадать с core.stock)
        COALESCE(SUM(b.qty_remaining), 0)                 AS qty_in_batches,

        -- Средняя себестоимость остатка (взвешенная по партиям)
        CASE
          WHEN SUM(b.qty_remaining) > 0
          THEN ROUND(
            SUM(b.qty_remaining * b.unit_cost) / SUM(b.qty_remaining),
            4
          )
          ELSE 0
        END                                               AS avg_unit_cost,

        -- Стоимость остатка по себестоимости (капитализация)
        COALESCE(SUM(b.qty_remaining * b.unit_cost), 0)   AS stock_cost_value,

        -- Стоимость остатка по цене продажи (потенциальная выручка)
        COALESCE(SUM(b.qty_remaining) * i.sale_price, 0)  AS stock_sale_value,

        -- Потенциальная прибыль при продаже всего остатка
        COALESCE(
          SUM(b.qty_remaining) * i.sale_price
          - SUM(b.qty_remaining * b.unit_cost),
          0
        )                                                 AS potential_profit,

        -- Фактический остаток из core.stock (для сверки)
        COALESCE(
          (SELECT SUM(s.qty)
           FROM core.stock s
           WHERE s.tenant_id = b.tenant_id AND s.item_id = b.item_id),
          0
        )                                                 AS qty_in_stock

      FROM core.item_batches b
      JOIN core.items i
        ON i.id = b.item_id AND i.tenant_id = b.tenant_id
      WHERE
        b.tenant_id = $1
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
        acc.pot_profit += Number(r.potential_profit);
        acc.qty_batches += Number(r.qty_in_batches);
        acc.qty_stock += Number(r.qty_in_stock);
        return acc;
      },
      { cost_value: 0, sale_value: 0, pot_profit: 0, qty_batches: 0, qty_stock: 0 }
    );

    const outOfSync = rows.filter(r =>
      Math.abs(Number(r.qty_in_batches) - Number(r.qty_in_stock)) > 0.001
    );

    return res.json({
      ok: true,
      stock_value: rows,
      totals: {
        stock_cost_value: Math.round(totals.cost_value * 100) / 100,
        stock_sale_value: Math.round(totals.sale_value * 100) / 100,
        potential_profit: Math.round(totals.pot_profit * 100) / 100,
        total_skus: rows.length,
      },
      sync_check: {
        ok: outOfSync.length === 0,
        out_of_sync: outOfSync.map(r => ({
          item_id: r.item_id,
          item_name: r.item_name,
          qty_in_stock: r.qty_in_stock,
          qty_in_batches: r.qty_in_batches,
          diff: Number(r.qty_in_batches) - Number(r.qty_in_stock),
        })),
      },
    });

  } catch (err) {
    console.error("[GET /reports/stock-value] error:", err);
    return res.status(500).json({ ok: false, error: "stock_value_failed" });
  }
});

// ─── GET /reports/item/:id ────────────────────────────────────────────────────
//
// Полная аналитика по конкретному товару:
// история партий, продажи, прибыль.
//
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
      `SELECT * FROM core.items WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
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
        b.qty_total - b.qty_remaining   AS qty_sold,
        b.unit_cost,
        b.qty_total * b.unit_cost       AS batch_total_cost,
        b.receipt_id,
        b.created_at
      FROM core.item_batches b
      WHERE b.tenant_id = $1 AND b.item_id = $2
      ORDER BY b.batch_date ASC, b.id ASC
      `,
      [tenantId, itemId]
    );

    const { rows: sales } = await pool.query(
      `
      SELECT
        s.id            AS sale_id,
        s.created_at,
        s.payment_method,
        si.qty,
        si.price        AS unit_sale_price,
        si.line_amount,
        si.cost_price,
        si.gross_profit,
        si.discount_amount,
        cp.name         AS counterparty_name
      FROM core.sale_items si
      JOIN core.sales s
        ON s.id = si.sale_id AND s.tenant_id = si.tenant_id
      LEFT JOIN core.counterparties cp
        ON cp.id = s.counterparty_id
      WHERE si.tenant_id = $1 AND si.item_id = $2
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
        gross_margin_pct: salesAgg.revenue > 0
          ? Math.round((salesAgg.gross_profit / salesAgg.revenue) * 10000) / 100
          : 0,
        total_discount: Math.round(salesAgg.discount * 100) / 100,
        avg_unit_cost: batchAgg.qty_remaining > 0
          ? Math.round(
              batches
                .filter(b => Number(b.qty_remaining) > 0)
                .reduce((s, b) => s + Number(b.qty_remaining) * Number(b.unit_cost), 0)
              / batchAgg.qty_remaining * 10000
            ) / 10000
          : 0,
      },
    });

  } catch (err) {
    console.error("[GET /reports/item/:id] error:", err);
    return res.status(500).json({ ok: false, error: "item_report_failed" });
  }
});

// ─── GET /reports/pnl-daily ──────────────────────────────────────────────────
//
// P&L с разбивкой по календарным дням.
//
// Продажи по дням:
//   core.sales + core.sale_items
//
// Расходы по дням:
//   core.expenses.expense_date
//
router.get("/pnl-daily", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenant_not_defined" });
    }

    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    const salesParams = [tenantId];
    let salesDateFilter = "";

    if (dateFrom) {
      salesParams.push(dateFrom);
      salesDateFilter += ` AND s.created_at >= $${salesParams.length}::date`;
    }
    if (dateTo) {
      salesParams.push(dateTo);
      salesDateFilter += ` AND s.created_at < ($${salesParams.length}::date + INTERVAL '1 day')`;
    }

    const expDateFilter = salesDateFilter.replace(/s\.created_at/g, "e.expense_date");

    const { rows } = await pool.query(
      `
      WITH

      sales_daily AS (
        SELECT
          s.created_at::date                            AS day,
          COALESCE(SUM(si.line_amount), 0)              AS revenue,
          COALESCE(SUM(si.qty * si.cost_price), 0)      AS cogs,
          COALESCE(SUM(si.gross_profit), 0)             AS gross_profit,
          COUNT(DISTINCT s.id)                          AS sales_count
        FROM core.sales s
        JOIN core.sale_items si
          ON si.sale_id = s.id AND si.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1
          ${salesDateFilter}
        GROUP BY s.created_at::date
      ),

      expenses_daily AS (
        SELECT
          e.expense_date::date                          AS day,
          COALESCE(SUM(e.amount), 0)                    AS expenses
        FROM core.expenses e
        WHERE e.tenant_id = $1
          ${expDateFilter}
        GROUP BY e.expense_date::date
      )

      SELECT
        COALESCE(sd.day, ed.day)                        AS date,
        COALESCE(sd.revenue, 0)                         AS revenue,
        COALESCE(sd.cogs, 0)                            AS cogs,
        COALESCE(sd.gross_profit, 0)                    AS gross_profit,
        COALESCE(ed.expenses, 0)                        AS expenses,
        COALESCE(sd.gross_profit, 0)
          - COALESCE(ed.expenses, 0)                    AS net_profit,
        COALESCE(sd.sales_count, 0)                     AS sales_count,

        CASE
          WHEN COALESCE(sd.revenue, 0) > 0
          THEN ROUND(
            COALESCE(sd.gross_profit, 0)
            / COALESCE(sd.revenue, 0) * 100,
            2
          )
          ELSE NULL
        END                                             AS gross_margin_pct

      FROM sales_daily sd
      FULL OUTER JOIN expenses_daily ed
        ON sd.day = ed.day

      ORDER BY date ASC
      `,
      salesParams
    );

    const daily = rows.map(r => ({
      date: r.date instanceof Date
        ? r.date.toISOString().split("T")[0]
        : String(r.date),
      revenue: Math.round(Number(r.revenue) * 100) / 100,
      cogs: Math.round(Number(r.cogs) * 100) / 100,
      gross_profit: Math.round(Number(r.gross_profit) * 100) / 100,
      expenses: Math.round(Number(r.expenses) * 100) / 100,
      net_profit: Math.round(Number(r.net_profit) * 100) / 100,
      sales_count: Number(r.sales_count),
      gross_margin_pct: r.gross_margin_pct !== null ? Number(r.gross_margin_pct) : null,
    }));

    const totals = daily.reduce(
      (acc, d) => {
        acc.revenue += d.revenue;
        acc.cogs += d.cogs;
        acc.gross_profit += d.gross_profit;
        acc.expenses += d.expenses;
        acc.net_profit += d.net_profit;
        acc.sales_count += d.sales_count;
        return acc;
      },
      { revenue: 0, cogs: 0, gross_profit: 0, expenses: 0, net_profit: 0, sales_count: 0 }
    );

    return res.json({
      ok: true,
      period: { date_from: dateFrom || null, date_to: dateTo || null },
      daily,
      totals: {
        revenue: Math.round(totals.revenue * 100) / 100,
        cogs: Math.round(totals.cogs * 100) / 100,
        gross_profit: Math.round(totals.gross_profit * 100) / 100,
        expenses: Math.round(totals.expenses * 100) / 100,
        net_profit: Math.round(totals.net_profit * 100) / 100,
        sales_count: totals.sales_count,
        days_count: daily.length,
        gross_margin_pct: totals.revenue > 0
          ? Math.round((totals.gross_profit / totals.revenue) * 10000) / 100
          : null,
      },
    });

  } catch (err) {
    console.error("[GET /reports/pnl-daily] error:", err);
    return res.status(500).json({ ok: false, error: "pnl_daily_failed" });
  }
});

// ─── GET /reports/top-items ───────────────────────────────────────────────────
//
// Топ товаров по выручке/прибыли за период.
// Сортировка: по revenue DESC (самые продаваемые по деньгам).
//
router.get("/top-items", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenant_not_defined" });
    }

    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    const rawLimit = Number(req.query.limit || 20);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 && rawLimit <= 100
      ? rawLimit
      : 20;

    const params = [tenantId];
    let dateFilter = "";

    if (dateFrom) {
      params.push(dateFrom);
      dateFilter += ` AND s.created_at >= $${params.length}::date`;
    }
    if (dateTo) {
      params.push(dateTo);
      dateFilter += ` AND s.created_at < ($${params.length}::date + INTERVAL '1 day')`;
    }

    params.push(limit);
    const limitPlaceholder = `$${params.length}`;

    const { rows } = await pool.query(
      `
      SELECT
        si.item_id,
        i.name                                              AS item_name,
        i.sku,
        i.unit,

        SUM(si.qty)                                         AS qty_sold,
        COALESCE(SUM(si.line_amount), 0)                    AS revenue,
        COALESCE(SUM(si.qty * si.cost_price), 0)            AS cogs,
        COALESCE(SUM(si.gross_profit), 0)                   AS gross_profit,
        COALESCE(SUM(si.discount_amount), 0)                AS total_discount,
        COUNT(si.id)                                        AS sales_lines,

        CASE
          WHEN SUM(si.qty) > 0
          THEN ROUND(SUM(si.line_amount) / SUM(si.qty), 4)
          ELSE 0
        END                                                 AS avg_sale_price,

        CASE
          WHEN SUM(si.qty) > 0
          THEN ROUND(SUM(si.qty * si.cost_price) / SUM(si.qty), 4)
          ELSE 0
        END                                                 AS avg_cost_price,

        CASE
          WHEN SUM(si.line_amount) > 0
          THEN ROUND(
            SUM(si.gross_profit) / SUM(si.line_amount) * 100,
            2
          )
          ELSE 0
        END                                                 AS margin_pct

      FROM core.sale_items si
      JOIN core.sales s
        ON s.id = si.sale_id AND s.tenant_id = si.tenant_id
      JOIN core.items i
        ON i.id = si.item_id
      WHERE si.tenant_id = $1
        ${dateFilter}
      GROUP BY si.item_id, i.name, i.sku, i.unit
      ORDER BY revenue DESC
      LIMIT ${limitPlaceholder}
      `,
      params
    );

    const items = rows.map((r, idx) => ({
      rank: idx + 1,
      item_id: Number(r.item_id),
      item_name: r.item_name,
      sku: r.sku || null,
      unit: r.unit || null,
      qty_sold: Math.round(Number(r.qty_sold) * 1000) / 1000,
      revenue: Math.round(Number(r.revenue) * 100) / 100,
      cogs: Math.round(Number(r.cogs) * 100) / 100,
      gross_profit: Math.round(Number(r.gross_profit) * 100) / 100,
      total_discount: Math.round(Number(r.total_discount) * 100) / 100,
      sales_lines: Number(r.sales_lines),
      avg_sale_price: Math.round(Number(r.avg_sale_price) * 10000) / 10000,
      avg_cost_price: Math.round(Number(r.avg_cost_price) * 10000) / 10000,
      margin_pct: Number(r.margin_pct),
    }));

    const totals = items.reduce(
      (acc, it) => {
        acc.revenue += it.revenue;
        acc.cogs += it.cogs;
        acc.gross_profit += it.gross_profit;
        acc.qty_sold += it.qty_sold;
        return acc;
      },
      { revenue: 0, cogs: 0, gross_profit: 0, qty_sold: 0 }
    );

    return res.json({
      ok: true,
      period: { date_from: dateFrom || null, date_to: dateTo || null },
      limit,
      items,
      totals: {
        revenue: Math.round(totals.revenue * 100) / 100,
        cogs: Math.round(totals.cogs * 100) / 100,
        gross_profit: Math.round(totals.gross_profit * 100) / 100,
        qty_sold: Math.round(totals.qty_sold * 1000) / 1000,
        margin_pct: totals.revenue > 0
          ? Math.round((totals.gross_profit / totals.revenue) * 10000) / 100
          : 0,
      },
    });

  } catch (err) {
    console.error("[GET /reports/top-items] error:", err);
    return res.status(500).json({ ok: false, error: "top_items_failed" });
  }
});

// ─── GET /reports/debts-summary ──────────────────────────────────────────────
//
// Сводка по долгам тенанта.
//
router.get("/debts-summary", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenant_not_defined" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        COALESCE(
          SUM(balance_amount) FILTER (WHERE status IN ('open', 'partial')),
          0
        )                                                     AS total_balance_amount,

        COALESCE(SUM(initial_amount), 0)                      AS total_initial_amount,
        COALESCE(SUM(paid_amount), 0)                         AS total_paid_amount,

        COUNT(*) FILTER (WHERE status = 'open')               AS open_count,
        COUNT(*) FILTER (WHERE status = 'partial')            AS partial_count,
        COUNT(*) FILTER (WHERE status = 'paid')               AS paid_count,

        COUNT(*) FILTER (
          WHERE status IN ('open', 'partial')
            AND due_date IS NOT NULL
            AND due_date < CURRENT_DATE
        )                                                     AS overdue_count,

        COALESCE(
          SUM(balance_amount) FILTER (
            WHERE status IN ('open', 'partial')
              AND due_date IS NOT NULL
              AND due_date < CURRENT_DATE
          ),
          0
        )                                                     AS overdue_amount,

        COUNT(*)                                              AS total_count

      FROM core.debts
      WHERE tenant_id = $1
      `,
      [tenantId]
    );

    const r = rows[0];

    const { rows: topDebts } = await pool.query(
      `
      SELECT
        d.id,
        d.initial_amount,
        d.paid_amount,
        d.balance_amount,
        d.status,
        d.due_date,
        d.comment,
        d.created_at,
        cp.name   AS counterparty_name,
        CASE
          WHEN d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE
            AND d.status IN ('open', 'partial')
          THEN TRUE
          ELSE FALSE
        END       AS is_overdue,
        CASE
          WHEN d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE
            AND d.status IN ('open', 'partial')
          THEN (CURRENT_DATE - d.due_date)
          ELSE 0
        END       AS overdue_days
      FROM core.debts d
      LEFT JOIN core.counterparties cp ON cp.id = d.counterparty_id
      WHERE d.tenant_id = $1
        AND d.status IN ('open', 'partial')
      ORDER BY d.balance_amount DESC
      LIMIT 5
      `,
      [tenantId]
    );

    const topDebtsClean = topDebts.map(d => ({
      id: Number(d.id),
      counterparty_name: d.counterparty_name || null,
      initial_amount: Math.round(Number(d.initial_amount) * 100) / 100,
      paid_amount: Math.round(Number(d.paid_amount) * 100) / 100,
      balance_amount: Math.round(Number(d.balance_amount) * 100) / 100,
      status: d.status,
      due_date: d.due_date
        ? (d.due_date instanceof Date
            ? d.due_date.toISOString().split("T")[0]
            : String(d.due_date))
        : null,
      is_overdue: Boolean(d.is_overdue),
      overdue_days: Number(d.overdue_days),
      comment: d.comment || null,
      created_at: d.created_at,
    }));

    return res.json({
      ok: true,
      summary: {
        total_balance_amount: Math.round(Number(r.total_balance_amount) * 100) / 100,
        total_initial_amount: Math.round(Number(r.total_initial_amount) * 100) / 100,
        total_paid_amount: Math.round(Number(r.total_paid_amount) * 100) / 100,
        open_count: Number(r.open_count),
        partial_count: Number(r.partial_count),
        paid_count: Number(r.paid_count),
        overdue_count: Number(r.overdue_count),
        overdue_amount: Math.round(Number(r.overdue_amount) * 100) / 100,
        total_count: Number(r.total_count),
        collection_rate_pct: Number(r.total_initial_amount) > 0
          ? Math.round(
              Number(r.total_paid_amount) / Number(r.total_initial_amount) * 10000
            ) / 100
          : 0,
      },
      top_open_debts: topDebtsClean,
    });

  } catch (err) {
    console.error("[GET /reports/debts-summary] error:", err);
    return res.status(500).json({ ok: false, error: "debts_summary_failed" });
  }
});

// ─── GET /reports/top-items ───────────────────────────────────────────────────
//
// Топ товаров по выручке/прибыли за период.
// Сортировка: по revenue DESC (самые продаваемые по деньгам).
//
router.get("/top-items", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenant_not_defined" });
    }

    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    const rawLimit = Number(req.query.limit || 20);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 && rawLimit <= 100
      ? rawLimit
      : 20;

    const params = [tenantId];
    let dateFilter = "";

    if (dateFrom) {
      params.push(dateFrom);
      dateFilter += ` AND s.created_at >= $${params.length}::date`;
    }
    if (dateTo) {
      params.push(dateTo);
      dateFilter += ` AND s.created_at < ($${params.length}::date + INTERVAL '1 day')`;
    }

    params.push(limit);
    const limitPlaceholder = `$${params.length}`;

    const { rows } = await pool.query(
      `
      SELECT
        si.item_id,
        i.name                                              AS item_name,
        i.sku,
        i.unit,

        SUM(si.qty)                                         AS qty_sold,
        COALESCE(SUM(si.line_amount), 0)                    AS revenue,
        COALESCE(SUM(si.qty * si.cost_price), 0)            AS cogs,
        COALESCE(SUM(si.gross_profit), 0)                   AS gross_profit,
        COALESCE(SUM(si.discount_amount), 0)                AS total_discount,
        COUNT(si.id)                                        AS sales_lines,

        CASE
          WHEN SUM(si.qty) > 0
          THEN ROUND(SUM(si.line_amount) / SUM(si.qty), 4)
          ELSE 0
        END                                                 AS avg_sale_price,

        CASE
          WHEN SUM(si.qty) > 0
          THEN ROUND(SUM(si.qty * si.cost_price) / SUM(si.qty), 4)
          ELSE 0
        END                                                 AS avg_cost_price,

        CASE
          WHEN SUM(si.line_amount) > 0
          THEN ROUND(
            SUM(si.gross_profit) / SUM(si.line_amount) * 100,
            2
          )
          ELSE 0
        END                                                 AS margin_pct

      FROM core.sale_items si
      JOIN core.sales s
        ON s.id = si.sale_id AND s.tenant_id = si.tenant_id
      JOIN core.items i
        ON i.id = si.item_id
      WHERE si.tenant_id = $1
        ${dateFilter}
      GROUP BY si.item_id, i.name, i.sku, i.unit
      ORDER BY revenue DESC
      LIMIT ${limitPlaceholder}
      `,
      params
    );

    const items = rows.map((r, idx) => ({
      rank: idx + 1,
      item_id: Number(r.item_id),
      item_name: r.item_name,
      sku: r.sku || null,
      unit: r.unit || null,
      qty_sold: Math.round(Number(r.qty_sold) * 1000) / 1000,
      revenue: Math.round(Number(r.revenue) * 100) / 100,
      cogs: Math.round(Number(r.cogs) * 100) / 100,
      gross_profit: Math.round(Number(r.gross_profit) * 100) / 100,
      total_discount: Math.round(Number(r.total_discount) * 100) / 100,
      sales_lines: Number(r.sales_lines),
      avg_sale_price: Math.round(Number(r.avg_sale_price) * 10000) / 10000,
      avg_cost_price: Math.round(Number(r.avg_cost_price) * 10000) / 10000,
      margin_pct: Number(r.margin_pct),
    }));

    const totals = items.reduce(
      (acc, it) => {
        acc.revenue += it.revenue;
        acc.cogs += it.cogs;
        acc.gross_profit += it.gross_profit;
        acc.qty_sold += it.qty_sold;
        return acc;
      },
      { revenue: 0, cogs: 0, gross_profit: 0, qty_sold: 0 }
    );

    return res.json({
      ok: true,
      period: { date_from: dateFrom || null, date_to: dateTo || null },
      limit,
      items,
      totals: {
        revenue: Math.round(totals.revenue * 100) / 100,
        cogs: Math.round(totals.cogs * 100) / 100,
        gross_profit: Math.round(totals.gross_profit * 100) / 100,
        qty_sold: Math.round(totals.qty_sold * 1000) / 1000,
        margin_pct: totals.revenue > 0
          ? Math.round((totals.gross_profit / totals.revenue) * 10000) / 100
          : 0,
      },
    });

  } catch (err) {
    console.error("[GET /reports/top-items] error:", err);
    return res.status(500).json({ ok: false, error: "top_items_failed" });
  }
});

module.exports = router;