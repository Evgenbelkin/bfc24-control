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

async function logActivity({
  actorUserId,
  tenantId = null,
  action,
  entityType,
  entityId = null,
  details = null,
  req = null
}) {
  try {
    await pool.query(
      `
      INSERT INTO audit.activity_log (
        user_id,
        tenant_id,
        action,
        entity_type,
        entity_id,
        details,
        ip_address,
        user_agent,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW())
      `,
      [
        actorUserId != null ? Number(actorUserId) : null,
        tenantId != null ? Number(tenantId) : null,
        action,
        entityType,
        entityId != null ? String(entityId) : null,
        details ? JSON.stringify(details) : null,
        req?.ip || null,
        req?.get ? req.get('user-agent') || null : null
      ]
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
        id,
        tenant_id,
        contact_name,
        phone,
        email,
        comment,
        status,
        created_at,
        updated_at,
        processed_at,
        processed_by
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
          sr.id,
          sr.tenant_id,
          t.name AS tenant_name,
          sr.contact_name,
          sr.phone,
          sr.email,
          sr.comment,
          sr.status,
          sr.created_at,
          sr.updated_at,
          sr.processed_at,
          sr.processed_by,
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
            WHEN $2 IN ('done', 'cancelled') THEN $3
            ELSE NULL
          END
        WHERE id = $1
        RETURNING
          id,
          tenant_id,
          contact_name,
          phone,
          email,
          comment,
          status,
          created_at,
          updated_at,
          processed_at,
          processed_by
        `,
        [id, status, req.user?.id ? Number(req.user.id) : null]
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

module.exports = router;