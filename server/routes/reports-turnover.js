const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authRequired, getEffectiveTenantId } = require('../middleware/auth');

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(v);
}

router.get('/turnover', authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: 'tenant_id_required'
      });
    }

    const periodDays = toPositiveInt(req.query.period_days, 30);
    const yellowDays = toPositiveInt(req.query.yellow_days, 30);
    const orangeDays = toPositiveInt(req.query.orange_days, 60);
    const redDays = toPositiveInt(req.query.red_days, 90);

    const includeZero = toBool(req.query.include_zero, false);

    const itemId =
      req.query.item_id && String(req.query.item_id).trim() !== ''
        ? Number(req.query.item_id)
        : null;

    const search =
      req.query.search && String(req.query.search).trim() !== ''
        ? String(req.query.search).trim()
        : null;

    if (itemId !== null && !Number.isFinite(itemId)) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_item_id'
      });
    }

    const sql = `
      WITH stock_agg AS (
        SELECT
          st.item_id,
          SUM(COALESCE(st.qty, 0))::numeric AS qty_on_hand
        FROM core.stock st
        WHERE st.tenant_id = $1
        GROUP BY st.item_id
      ),
      sales_agg AS (
        SELECT
          si.item_id,
          SUM(COALESCE(si.qty, 0))::numeric AS sold_qty_period
        FROM core.sale_items si
        INNER JOIN core.sales s
          ON s.id = si.sale_id
         AND s.tenant_id = si.tenant_id
        WHERE si.tenant_id = $1
          AND s.created_at >= NOW() - ($2::text || ' days')::interval
        GROUP BY si.item_id
      ),
      batch_agg AS (
        SELECT
          b.item_id,
          SUM(COALESCE(b.qty_remaining, 0) * COALESCE(b.unit_cost, 0))::numeric AS stock_cost_total
        FROM core.item_batches b
        WHERE b.tenant_id = $1
        GROUP BY b.item_id
      )
      SELECT
        i.id,
        i.name,
        i.sku,
        i.barcode,
        i.unit,
        COALESCE(i.purchase_price, 0)::numeric AS purchase_price,
        COALESCE(i.sale_price, 0)::numeric AS sale_price,

        COALESCE(sa.qty_on_hand, 0)::numeric AS qty_on_hand,
        COALESCE(sla.sold_qty_period, 0)::numeric AS sold_qty_period,

        ROUND(COALESCE(sla.sold_qty_period, 0)::numeric / $2::numeric, 4) AS avg_daily_sales,

        CASE
          WHEN COALESCE(sla.sold_qty_period, 0) <= 0 THEN NULL
          ELSE ROUND(
            COALESCE(sa.qty_on_hand, 0)::numeric
            / NULLIF(COALESCE(sla.sold_qty_period, 0)::numeric / $2::numeric, 0),
            2
          )
        END AS days_on_hand,

        COALESCE(ba.stock_cost_total, COALESCE(sa.qty_on_hand, 0) * COALESCE(i.purchase_price, 0))::numeric AS stock_cost_total,
        (COALESCE(sa.qty_on_hand, 0) * COALESCE(i.sale_price, 0))::numeric AS potential_revenue,
        (
          (COALESCE(sa.qty_on_hand, 0) * COALESCE(i.sale_price, 0))
          - COALESCE(ba.stock_cost_total, COALESCE(sa.qty_on_hand, 0) * COALESCE(i.purchase_price, 0))
        )::numeric AS potential_profit
      FROM core.items i
      LEFT JOIN stock_agg sa ON sa.item_id = i.id
      LEFT JOIN sales_agg sla ON sla.item_id = i.id
      LEFT JOIN batch_agg ba ON ba.item_id = i.id
      WHERE i.tenant_id = $1
        AND COALESCE(i.is_active, true) = true
        AND ($3::bigint IS NULL OR i.id = $3)
        AND (
          $4::text IS NULL
          OR i.name ILIKE '%' || $4 || '%'
          OR i.sku ILIKE '%' || $4 || '%'
          OR i.barcode ILIKE '%' || $4 || '%'
        )
        AND (
          $5::boolean = true
          OR COALESCE(sa.qty_on_hand, 0) > 0
        )
      ORDER BY i.name ASC, i.id ASC
    `;

    const { rows } = await pool.query(sql, [
      tenantId,
      periodDays,
      itemId,
      search,
      includeZero
    ]);

    const items = rows.map((row) => {
      const qtyOnHand = Number(row.qty_on_hand || 0);
      const soldQtyPeriod = Number(row.sold_qty_period || 0);
      const avgDailySales = Number(row.avg_daily_sales || 0);
      const daysOnHand =
        row.days_on_hand === null || row.days_on_hand === undefined
          ? null
          : Number(row.days_on_hand);

      let turnoverStatus = 'no_sales';

      if (daysOnHand === null && qtyOnHand <= 0) {
        turnoverStatus = 'out_of_stock';
      } else if (daysOnHand === null && qtyOnHand > 0 && soldQtyPeriod <= 0) {
        turnoverStatus = 'stale_no_sales';
      } else if (daysOnHand !== null) {
        if (daysOnHand > redDays) turnoverStatus = 'critical';
        else if (daysOnHand > orangeDays) turnoverStatus = 'risk';
        else if (daysOnHand > yellowDays) turnoverStatus = 'warning';
        else turnoverStatus = 'healthy';
      }

      return {
        id: Number(row.id),
        name: row.name,
        sku: row.sku,
        barcode: row.barcode,
        unit: row.unit,
        purchase_price: Number(row.purchase_price || 0),
        sale_price: Number(row.sale_price || 0),

        qty_on_hand: qtyOnHand,
        sold_qty_period: soldQtyPeriod,
        avg_daily_sales: avgDailySales,
        days_on_hand: daysOnHand,

        stock_cost_total: Number(row.stock_cost_total || 0),
        potential_revenue: Number(row.potential_revenue || 0),
        potential_profit: Number(row.potential_profit || 0),

        turnover_status: turnoverStatus
      };
    });

    const summary = items.reduce(
      (acc, item) => {
        acc.items_count += 1;
        acc.total_qty_on_hand += item.qty_on_hand;
        acc.total_stock_cost += item.stock_cost_total;
        acc.total_potential_revenue += item.potential_revenue;
        acc.total_potential_profit += item.potential_profit;

        switch (item.turnover_status) {
          case 'healthy':
            acc.healthy_count += 1;
            break;
          case 'warning':
            acc.warning_count += 1;
            break;
          case 'risk':
            acc.risk_count += 1;
            break;
          case 'critical':
            acc.critical_count += 1;
            break;
          case 'stale_no_sales':
            acc.stale_no_sales_count += 1;
            break;
          case 'out_of_stock':
            acc.out_of_stock_count += 1;
            break;
          default:
            acc.no_sales_count += 1;
            break;
        }

        return acc;
      },
      {
        items_count: 0,
        total_qty_on_hand: 0,
        total_stock_cost: 0,
        total_potential_revenue: 0,
        total_potential_profit: 0,
        healthy_count: 0,
        warning_count: 0,
        risk_count: 0,
        critical_count: 0,
        stale_no_sales_count: 0,
        out_of_stock_count: 0,
        no_sales_count: 0
      }
    );

    return res.json({
      ok: true,
      period_days: periodDays,
      thresholds: {
        yellow_days: yellowDays,
        orange_days: orangeDays,
        red_days: redDays
      },
      filters: {
        item_id: itemId,
        search,
        include_zero: includeZero
      },
      summary,
      items
    });
  } catch (error) {
    console.error('[GET /reports/turnover] error:', error);
    return res.status(500).json({
      ok: false,
      error: 'internal_error'
    });
  }
});

module.exports = router;