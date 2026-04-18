const express = require('express');
const pool = require('../db');
const { authRequired, getEffectiveTenantId } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

const ALLOWED_STATUSES = new Set(['new', 'in_progress', 'done', 'cancelled']);

function normalizeOptionalText(value) {
  const text = String(value == null ? '' : value).trim();
  return text || null;
}

function toBigIntOrNull(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

let activityLogColumnsCache = null;

async function getActivityLogColumns() {
  if (activityLogColumnsCache) return activityLogColumnsCache;

  const { rows } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'audit'
      AND table_name = 'activity_log'
    ORDER BY ordinal_position
    `
  );

  activityLogColumnsCache = new Set(rows.map((r) => r.column_name));
  return activityLogColumnsCache;
}

async function logActivity({
  actorUserId = null,
  tenantId = null,
  action = null,
  entityType = null,
  entityId = null,
  details = null,
  req = null
}) {
  try {
    const columns = await getActivityLogColumns();
    if (!columns || columns.size === 0) return;

    const data = {};

    if (columns.has('user_id')) data.user_id = toBigIntOrNull(actorUserId);
    if (columns.has('tenant_id')) data.tenant_id = toBigIntOrNull(tenantId);
    if (columns.has('action')) data.action = action || null;
    if (columns.has('event_code')) data.event_code = action || null;
    if (columns.has('entity_type')) data.entity_type = entityType || null;
    if (columns.has('entity_name')) data.entity_name = entityType || null;
    if (columns.has('entity_id')) data.entity_id = entityId != null ? String(entityId) : null;
    if (columns.has('details')) data.details = details ? JSON.stringify(details) : null;
    if (columns.has('meta')) data.meta = details ? JSON.stringify(details) : null;
    if (columns.has('ip_address')) data.ip_address = req?.ip || null;
    if (columns.has('user_agent')) data.user_agent = req?.get ? req.get('user-agent') || null : null;
    if (columns.has('created_at')) data.created_at = null;

    const insertColumns = [];
    const values = [];
    const params = [];

    Object.entries(data).forEach(([key, value]) => {
      if (key === 'created_at') {
        insertColumns.push(key);
        values.push('NOW()');
        return;
      }

      insertColumns.push(key);

      if (key === 'details' || key === 'meta') {
        params.push(value);
        values.push(`$${params.length}::jsonb`);
        return;
      }

      params.push(value);
      values.push(`$${params.length}`);
    });

    if (!insertColumns.length) return;

    await pool.query(
      `
      INSERT INTO audit.activity_log (${insertColumns.join(', ')})
      VALUES (${values.join(', ')})
      `,
      params
    );
  } catch (error) {
    console.error('[subscription-requests] activity_log error:', error);
  }
}

router.post('/subscription-requests', authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);

    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'tenant_id_required' });
    }

    const contactName = normalizeOptionalText(req.body?.contact_name);
    const phone = normalizeOptionalText(req.body?.phone);
    const email = normalizeOptionalText(req.body?.email);
    const comment = normalizeOptionalText(req.body?.comment);

    if (!phone && !email) {
      return res.status(400).json({ ok: false, error: 'phone_or_email_required' });
    }

    const tenantResult = await pool.query(
      `
      SELECT id, name, is_active, is_blocked
      FROM saas.tenants
      WHERE id = $1
      LIMIT 1
      `,
      [tenantId]
    );

    const tenant = tenantResult.rows[0];
    if (!tenant) {
      return res.status(404).json({ ok: false, error: 'tenant_not_found' });
    }

    const insertResult = await pool.query(
      `
      INSERT INTO saas.subscription_requests (
        tenant_id,
        contact_name,
        phone,
        email,
        comment,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 'new', NOW(), NOW())
      RETURNING
        id::text AS id,
        tenant_id::text AS tenant_id,
        contact_name,
        phone,
        email,
        comment,
        status,
        created_at,
        updated_at,
        processed_at,
        processed_by::text AS processed_by
      `,
      [tenantId, contactName, phone, email, comment]
    );

    const requestRow = insertResult.rows[0];

    await logActivity({
      actorUserId: req.user?.id || null,
      tenantId,
      action: 'subscription_request_created',
      entityType: 'subscription_request',
      entityId: requestRow.id,
      details: {
        tenant_name: tenant.name,
        status: requestRow.status
      },
      req
    });

    return res.status(201).json({
      ok: true,
      request: requestRow
    });
  } catch (error) {
    console.error('[POST /subscription-requests] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_server_error' });
  }
});

router.get(
  '/owner-admin/subscription-requests',
  authRequired,
  requirePermission('owner.subscription_requests.read'),
  async (req, res) => {
    try {
      const status = normalizeOptionalText(req.query?.status);
      const search = normalizeOptionalText(req.query?.search);
      const limitRaw = Number(req.query?.limit || 100);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 100;

      const params = [];
      const where = [];

      if (status) {
        params.push(status);
        where.push(`sr.status = $${params.length}`);
      }

      if (search) {
        params.push(`%${search}%`);
        where.push(`
          (
            CAST(sr.id AS TEXT) ILIKE $${params.length}
            OR COALESCE(t.name, '') ILIKE $${params.length}
            OR COALESCE(sr.contact_name, '') ILIKE $${params.length}
            OR COALESCE(sr.phone, '') ILIKE $${params.length}
            OR COALESCE(sr.email, '') ILIKE $${params.length}
            OR COALESCE(sr.comment, '') ILIKE $${params.length}
          )
        `);
      }

      params.push(limit);

      const sql = `
        SELECT
          sr.id::text AS id,
          sr.tenant_id::text AS tenant_id,
          t.name AS tenant_name,
          t.subscription_status,
          t.subscription_start_at,
          t.subscription_end_at,
          sr.contact_name,
          sr.phone,
          sr.email,
          sr.comment,
          sr.status,
          sr.created_at,
          sr.updated_at,
          sr.processed_at,
          sr.processed_by::text AS processed_by,
          pu.username AS processed_by_username,
          pu.full_name AS processed_by_full_name
        FROM saas.subscription_requests sr
        LEFT JOIN saas.tenants t ON t.id = sr.tenant_id
        LEFT JOIN saas.users pu ON pu.id = sr.processed_by
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY
          CASE sr.status
            WHEN 'new' THEN 1
            WHEN 'in_progress' THEN 2
            WHEN 'done' THEN 3
            WHEN 'cancelled' THEN 4
            ELSE 9
          END,
          sr.created_at DESC,
          sr.id DESC
        LIMIT $${params.length}
      `;

      const { rows } = await pool.query(sql, params);

      return res.json({
        ok: true,
        items: rows
      });
    } catch (error) {
      console.error('[GET /owner-admin/subscription-requests] error:', error);
      return res.status(500).json({ ok: false, error: 'internal_server_error' });
    }
  }
);

router.patch(
  '/owner-admin/subscription-requests/:id/status',
  authRequired,
  requirePermission('owner.subscription_requests.update'),
  async (req, res) => {
    try {
      const id = Number(req.params?.id);
      const status = normalizeOptionalText(req.body?.status);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: 'invalid_request_id' });
      }

      if (!status) {
        return res.status(400).json({ ok: false, error: 'status_required' });
      }

      if (!ALLOWED_STATUSES.has(status)) {
        return res.status(400).json({ ok: false, error: 'invalid_status' });
      }

      const currentResult = await pool.query(
        `
        SELECT
          sr.id,
          sr.tenant_id,
          sr.status,
          sr.contact_name,
          sr.phone,
          sr.email,
          sr.comment,
          t.name AS tenant_name
        FROM saas.subscription_requests sr
        LEFT JOIN saas.tenants t ON t.id = sr.tenant_id
        WHERE sr.id = $1
        LIMIT 1
        `,
        [id]
      );

      const current = currentResult.rows[0];
      if (!current) {
        return res.status(404).json({ ok: false, error: 'subscription_request_not_found' });
      }

      const processedBy = toBigIntOrNull(req.user?.id);

      const updateResult = await pool.query(
        `
        UPDATE saas.subscription_requests
        SET
          status = $2,
          updated_at = NOW(),
          processed_at = CASE
            WHEN $2 IN ('done', 'cancelled') THEN NOW()
            ELSE NULL
          END,
          processed_by = CASE
            WHEN $2 IN ('done', 'cancelled') THEN $3::bigint
            ELSE NULL
          END
        WHERE id = $1
        RETURNING
          id::text AS id,
          tenant_id::text AS tenant_id,
          contact_name,
          phone,
          email,
          comment,
          status,
          created_at,
          updated_at,
          processed_at,
          processed_by::text AS processed_by
        `,
        [id, status, processedBy]
      );

      const updated = updateResult.rows[0];

      await logActivity({
        actorUserId: req.user?.id || null,
        tenantId: current.tenant_id,
        action: 'subscription_request_status_updated',
        entityType: 'subscription_request',
        entityId: updated.id,
        details: {
          old_status: current.status,
          new_status: updated.status,
          tenant_name: current.tenant_name || null
        },
        req
      });

      return res.json({
        ok: true,
        request: updated
      });
    } catch (error) {
      console.error('[PATCH /owner-admin/subscription-requests/:id/status] error:', error);
      return res.status(500).json({ ok: false, error: 'internal_server_error' });
    }
  }
);

router.post(
  '/owner-admin/subscription-requests/:id/activate',
  authRequired,
  requirePermission('owner.subscription_requests.update'),
  async (req, res) => {
    try {
      const id = Number(req.params?.id);
      const daysRaw = Number(req.body?.days || 30);
      const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(daysRaw, 3650)) : 30;

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: 'invalid_request_id' });
      }

      const requestResult = await pool.query(
        `
        SELECT
          sr.id,
          sr.tenant_id,
          sr.status,
          sr.contact_name,
          sr.phone,
          sr.email,
          sr.comment,
          t.name AS tenant_name,
          t.subscription_status,
          t.subscription_start_at,
          t.subscription_end_at
        FROM saas.subscription_requests sr
        LEFT JOIN saas.tenants t ON t.id = sr.tenant_id
        WHERE sr.id = $1
        LIMIT 1
        `,
        [id]
      );

      const requestRow = requestResult.rows[0];
      if (!requestRow) {
        return res.status(404).json({ ok: false, error: 'subscription_request_not_found' });
      }

      if (!requestRow.tenant_id) {
        return res.status(400).json({ ok: false, error: 'tenant_not_found' });
      }

      const processedBy = toBigIntOrNull(req.user?.id);

      await pool.query('BEGIN');

      const tenantUpdateResult = await pool.query(
        `
        UPDATE saas.tenants
        SET
          subscription_status = 'active',
          subscription_start_at = NOW(),
          subscription_end_at = NOW() + ($2::text || ' days')::interval,
          updated_at = NOW(),
          is_blocked = false,
          block_reason = NULL,
          status = 'active',
          is_active = true
        WHERE id = $1
        RETURNING
          id::text AS id,
          name,
          subscription_status,
          subscription_start_at,
          subscription_end_at,
          status,
          is_active,
          is_blocked
        `,
        [requestRow.tenant_id, String(days)]
      );

      const tenant = tenantUpdateResult.rows[0];
      if (!tenant) {
        await pool.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: 'tenant_not_found' });
      }

      const requestUpdateResult = await pool.query(
        `
        UPDATE saas.subscription_requests
        SET
          status = 'done',
          updated_at = NOW(),
          processed_at = NOW(),
          processed_by = $2::bigint
        WHERE id = $1
        RETURNING
          id::text AS id,
          tenant_id::text AS tenant_id,
          contact_name,
          phone,
          email,
          comment,
          status,
          created_at,
          updated_at,
          processed_at,
          processed_by::text AS processed_by
        `,
        [id, processedBy]
      );

      const updatedRequest = requestUpdateResult.rows[0];

      await pool.query('COMMIT');

      await logActivity({
        actorUserId: req.user?.id || null,
        tenantId: requestRow.tenant_id,
        action: 'subscription_activated',
        entityType: 'tenant',
        entityId: tenant.id,
        details: {
          request_id: String(id),
          tenant_name: tenant.name,
          days,
          subscription_status: tenant.subscription_status,
          subscription_start_at: tenant.subscription_start_at,
          subscription_end_at: tenant.subscription_end_at
        },
        req
      });

      await logActivity({
        actorUserId: req.user?.id || null,
        tenantId: requestRow.tenant_id,
        action: 'subscription_request_activated',
        entityType: 'subscription_request',
        entityId: updatedRequest.id,
        details: {
          tenant_name: tenant.name,
          days,
          final_status: updatedRequest.status
        },
        req
      });

      return res.json({
        ok: true,
        tenant,
        request: updatedRequest
      });
    } catch (error) {
      try {
        await pool.query('ROLLBACK');
      } catch (_) {}

      console.error('[POST /owner-admin/subscription-requests/:id/activate] error:', error);
      return res.status(500).json({ ok: false, error: 'internal_server_error' });
    }
  }
);

module.exports = router;