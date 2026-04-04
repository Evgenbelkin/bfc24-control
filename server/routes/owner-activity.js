const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/summary', async (req, res) => {
  try {
    const sql = `
      WITH last_logins AS (
        SELECT
          u.tenant_id,
          MAX(u.last_login_at) AS last_login_at,
          COUNT(*) FILTER (WHERE u.role = 'client') AS users_count
        FROM saas.users u
        WHERE u.tenant_id IS NOT NULL
        GROUP BY u.tenant_id
      ),
      activity_7d AS (
        SELECT
          tenant_id,
          COUNT(*) AS activity_7d
        FROM saas.activity_log
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY tenant_id
      ),
      activity_30d AS (
        SELECT
          tenant_id,
          COUNT(*) AS activity_30d
        FROM saas.activity_log
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY tenant_id
      ),
      sales_7d AS (
        SELECT
          tenant_id,
          COUNT(*) AS sales_7d
        FROM core.sales
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY tenant_id
      ),
      sales_30d AS (
        SELECT
          tenant_id,
          COUNT(*) AS sales_30d
        FROM core.sales
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY tenant_id
      ),
      receipts_7d AS (
        SELECT
          tenant_id,
          COUNT(*) AS receipts_7d
        FROM core.receipts
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY tenant_id
      ),
      receipts_30d AS (
        SELECT
          tenant_id,
          COUNT(*) AS receipts_30d
        FROM core.receipts
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY tenant_id
      ),
      writeoffs_7d AS (
        SELECT
          tenant_id,
          COUNT(*) AS writeoffs_7d
        FROM core.writeoffs
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY tenant_id
      ),
      writeoffs_30d AS (
        SELECT
          tenant_id,
          COUNT(*) AS writeoffs_30d
        FROM core.writeoffs
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY tenant_id
      )
      SELECT
        t.id,
        t.name,
        t.slug,
        t.tariff_name,
        t.subscription_status,
        t.subscription_start_at,
        t.subscription_end_at,
        t.is_active,
        t.is_blocked,
        t.status,
        COALESCE(ll.users_count, 0) AS users_count,
        ll.last_login_at,
        COALESCE(a7.activity_7d, 0) AS activity_7d,
        COALESCE(a30.activity_30d, 0) AS activity_30d,
        COALESCE(s7.sales_7d, 0) AS sales_7d,
        COALESCE(s30.sales_30d, 0) AS sales_30d,
        COALESCE(r7.receipts_7d, 0) AS receipts_7d,
        COALESCE(r30.receipts_30d, 0) AS receipts_30d,
        COALESCE(w7.writeoffs_7d, 0) AS writeoffs_7d,
        COALESCE(w30.writeoffs_30d, 0) AS writeoffs_30d,
        CASE
          WHEN t.is_blocked = TRUE
            OR t.is_active = FALSE
            OR t.subscription_status IN ('blocked', 'expired')
          THEN 'blocked'
          WHEN COALESCE(a7.activity_7d, 0) > 0
            OR ll.last_login_at >= NOW() - INTERVAL '7 days'
          THEN 'active'
          WHEN COALESCE(a30.activity_30d, 0) > 0
            OR ll.last_login_at >= NOW() - INTERVAL '30 days'
          THEN 'warning'
          ELSE 'inactive'
        END AS activity_status
      FROM saas.tenants t
      LEFT JOIN last_logins ll ON ll.tenant_id = t.id
      LEFT JOIN activity_7d a7 ON a7.tenant_id = t.id
      LEFT JOIN activity_30d a30 ON a30.tenant_id = t.id
      LEFT JOIN sales_7d s7 ON s7.tenant_id = t.id
      LEFT JOIN sales_30d s30 ON s30.tenant_id = t.id
      LEFT JOIN receipts_7d r7 ON r7.tenant_id = t.id
      LEFT JOIN receipts_30d r30 ON r30.tenant_id = t.id
      LEFT JOIN writeoffs_7d w7 ON w7.tenant_id = t.id
      LEFT JOIN writeoffs_30d w30 ON w30.tenant_id = t.id
      ORDER BY t.id DESC;
    `;

    const { rows } = await pool.query(sql);

    return res.json({
      ok: true,
      summary: rows
    });
  } catch (error) {
    console.error('[GET /owner-activity/summary] error:', error);
    return res.status(500).json({
      ok: false,
      error: 'failed_to_load_owner_activity_summary'
    });
  }
});

router.get('/tenant/:tenantId/events', async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);

    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_tenant_id'
      });
    }

    const sql = `
      SELECT
        al.id,
        al.user_id,
        al.tenant_id,
        al.event_type,
        al.entity_type,
        al.entity_id,
        al.created_at,
        al.meta,
        u.username,
        u.full_name,
        t.name AS tenant_name
      FROM saas.activity_log al
      LEFT JOIN saas.users u ON u.id = al.user_id
      LEFT JOIN saas.tenants t ON t.id = al.tenant_id
      WHERE al.tenant_id = $1
      ORDER BY al.created_at DESC
      LIMIT $2;
    `;

    const { rows } = await pool.query(sql, [tenantId, limit]);

    return res.json({
      ok: true,
      events: rows
    });
  } catch (error) {
    console.error('[GET /owner-activity/tenant/:tenantId/events] error:', error);
    return res.status(500).json({
      ok: false,
      error: 'failed_to_load_tenant_activity_events'
    });
  }
});

module.exports = router;