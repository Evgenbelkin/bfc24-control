const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(authRequired);
router.use(requireRole('owner'));

const SALT_ROUNDS = 10;
const SUBSCRIPTION_STATUSES = ['trial', 'active', 'expired', 'blocked'];
const USER_ROLES = ['owner', 'client'];
const TENANT_STATUSES = ['active', 'blocked', 'archived'];

function normalizeModules(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function buildTenantResponse(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    code: row.code,
    status: row.status,
    subscription_status: row.subscription_status,
    plan_code: row.plan_code,
    tariff_name: row.tariff_name,
    contact_name: row.contact_name,
    contact_phone: row.contact_phone,
    contact_email: row.contact_email,
    phone: row.phone,
    email: row.email,
    comment: row.comment,
    subscription_start_at: row.subscription_start_at,
    subscription_end_at: row.subscription_end_at,
    max_sku: row.max_sku,
    max_locations: row.max_locations,
    enabled_modules: row.enabled_modules || [],
    is_active: row.is_active,
    is_blocked: row.is_blocked,
    block_reason: row.block_reason,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function buildUserResponse(row) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    username: row.username,
    full_name: row.full_name,
    role: row.role,
    is_active: row.is_active,
    is_blocked: row.is_blocked,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function makeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

async function ensureUniqueTenantSlug(baseSlug, excludeId = null) {
  let slug = makeSlug(baseSlug || 'client');
  if (!slug) slug = 'client';

  let counter = 1;
  while (true) {
    const candidate = counter === 1 ? slug : `${slug}-${counter}`;
    const params = excludeId ? [candidate, excludeId] : [candidate];
    const sql = excludeId
      ? `SELECT 1 FROM saas.tenants WHERE slug = $1 AND id <> $2 LIMIT 1`
      : `SELECT 1 FROM saas.tenants WHERE slug = $1 LIMIT 1`;

    const { rows } = await pool.query(sql, params);
    if (rows.length === 0) return candidate;
    counter += 1;
  }
}

async function ensureUniqueTenantCode(baseCode, excludeId = null) {
  const normalized = String(baseCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  let code = normalized || 'CLIENT';
  let counter = 1;

  while (true) {
    const candidate = counter === 1 ? code : `${code}-${counter}`;
    const params = excludeId ? [candidate, excludeId] : [candidate];
    const sql = excludeId
      ? `SELECT 1 FROM saas.tenants WHERE code = $1 AND id <> $2 LIMIT 1`
      : `SELECT 1 FROM saas.tenants WHERE code = $1 LIMIT 1`;

    const { rows } = await pool.query(sql, params);
    if (rows.length === 0) return candidate;
    counter += 1;
  }
}

function deriveTenantStatus(subscriptionStatus, isBlocked) {
  if (isBlocked) return 'blocked';
  if (subscriptionStatus === 'blocked') return 'blocked';
  return 'active';
}

async function validateTenantPayload(payload, tenantId = null) {
  const name = String(payload.name || '').trim();
  if (!name) {
    return { ok: false, error: 'name_required' };
  }

  const subscriptionStatus = String(
    payload.subscription_status || 'trial'
  ).trim().toLowerCase();

  if (!SUBSCRIPTION_STATUSES.includes(subscriptionStatus)) {
    return { ok: false, error: 'invalid_subscription_status' };
  }

  const maxSku = Number(payload.max_sku ?? 1000);
  const maxLocations = Number(payload.max_locations ?? 10);

  if (!Number.isInteger(maxSku) || maxSku < 0) {
    return { ok: false, error: 'invalid_max_sku' };
  }

  if (!Number.isInteger(maxLocations) || maxLocations < 0) {
    return { ok: false, error: 'invalid_max_locations' };
  }

  const slug = await ensureUniqueTenantSlug(payload.slug || name, tenantId);
  const code = await ensureUniqueTenantCode(payload.code || name, tenantId);

  const enabledModules = normalizeModules(payload.enabled_modules);

  const phone = payload.phone != null ? String(payload.phone).trim() : null;
  const email = payload.email != null ? String(payload.email).trim() : null;
  const contactName =
    payload.contact_name != null
      ? String(payload.contact_name).trim()
      : null;

  const planCode = String(payload.plan_code || payload.tariff_name || 'basic')
    .trim()
    .toLowerCase();
  const tariffName = String(payload.tariff_name || payload.plan_code || 'basic')
    .trim()
    .toLowerCase();

  const isActive =
    payload.is_active === undefined ? true : Boolean(payload.is_active);
  const isBlocked =
    payload.is_blocked === undefined ? false : Boolean(payload.is_blocked);

  const status = deriveTenantStatus(subscriptionStatus, isBlocked);

  if (!TENANT_STATUSES.includes(status)) {
    return { ok: false, error: 'invalid_status' };
  }

  return {
    ok: true,
    data: {
      name,
      slug,
      code,
      status,
      subscription_status: subscriptionStatus,
      plan_code: planCode,
      tariff_name: tariffName,
      contact_name: contactName,
      contact_phone: phone,
      contact_email: email,
      phone,
      email,
      comment: payload.comment != null ? String(payload.comment).trim() : null,
      subscription_start_at: payload.subscription_start_at || null,
      subscription_end_at: payload.subscription_end_at || null,
      max_sku: maxSku,
      max_locations: maxLocations,
      enabled_modules: JSON.stringify(enabledModules),
      is_active: isActive,
      is_blocked: isBlocked,
      block_reason:
        payload.block_reason != null ? String(payload.block_reason).trim() : null
    }
  };
}

async function validateUserPayload(payload, userId = null) {
  const tenantId =
    payload.tenant_id === null || payload.tenant_id === undefined || payload.tenant_id === ''
      ? null
      : Number(payload.tenant_id);

  const username = String(payload.username || '').trim();
  const fullName = String(payload.full_name || '').trim();
  const role = String(payload.role || 'client').trim().toLowerCase();

  if (!username) {
    return { ok: false, error: 'username_required' };
  }

  if (!fullName) {
    return { ok: false, error: 'full_name_required' };
  }

  if (!USER_ROLES.includes(role)) {
    return { ok: false, error: 'invalid_role' };
  }

  if (role === 'client' && !tenantId) {
    return { ok: false, error: 'tenant_id_required_for_client' };
  }

  if (role === 'owner' && tenantId) {
    return { ok: false, error: 'owner_must_have_null_tenant_id' };
  }

  if (tenantId) {
    const tenantCheck = await pool.query(
      `SELECT id FROM saas.tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );
    if (tenantCheck.rows.length === 0) {
      return { ok: false, error: 'tenant_not_found' };
    }
  }

  const usernameCheckParams = userId ? [username, userId] : [username];
  const usernameCheckSql = userId
    ? `SELECT id FROM saas.users WHERE username = $1 AND id <> $2 LIMIT 1`
    : `SELECT id FROM saas.users WHERE username = $1 LIMIT 1`;

  const usernameCheck = await pool.query(usernameCheckSql, usernameCheckParams);
  if (usernameCheck.rows.length > 0) {
    return { ok: false, error: 'username_already_exists' };
  }

  const isActive =
    payload.is_active === undefined ? true : Boolean(payload.is_active);
  const isBlocked =
    payload.is_blocked === undefined ? false : Boolean(payload.is_blocked);

  return {
    ok: true,
    data: {
      tenant_id: tenantId,
      username,
      full_name: fullName,
      role,
      is_active: isActive,
      is_blocked: isBlocked
    }
  };
}

/* =========================================================
   TENANTS
========================================================= */

router.get('/tenants', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        t.*,
        (
          SELECT COUNT(*)
          FROM saas.users u
          WHERE u.tenant_id = t.id
        )::int AS users_count
      FROM saas.tenants t
      ORDER BY t.id DESC
    `);

    return res.json({
      ok: true,
      tenants: rows.map((row) => ({
        ...buildTenantResponse(row),
        users_count: row.users_count
      }))
    });
  } catch (error) {
    console.error('[GET /owner-admin/tenants] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.get('/tenants/:id', async (req, res) => {
  try {
    const tenantId = Number(req.params.id);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'invalid_tenant_id' });
    }

    const tenantResult = await pool.query(
      `SELECT * FROM saas.tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'tenant_not_found' });
    }

    const usersResult = await pool.query(
      `
      SELECT id, tenant_id, username, full_name, role, is_active, is_blocked, last_login_at, created_at, updated_at
      FROM saas.users
      WHERE tenant_id = $1
      ORDER BY id DESC
      `,
      [tenantId]
    );

    return res.json({
      ok: true,
      tenant: buildTenantResponse(tenantResult.rows[0]),
      users: usersResult.rows.map(buildUserResponse)
    });
  } catch (error) {
    console.error('[GET /owner-admin/tenants/:id] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.post('/tenants', async (req, res) => {
  try {
    const validated = await validateTenantPayload(req.body || {});
    if (!validated.ok) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    const d = validated.data;

    const { rows } = await pool.query(
      `
      INSERT INTO saas.tenants (
        name,
        slug,
        status,
        plan_code,
        contact_name,
        contact_phone,
        contact_email,
        comment,
        code,
        phone,
        email,
        tariff_name,
        subscription_status,
        subscription_start_at,
        subscription_end_at,
        max_sku,
        max_locations,
        enabled_modules,
        is_active,
        is_blocked,
        block_reason,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18::jsonb, $19, $20, $21,
        NOW(), NOW()
      )
      RETURNING *
      `,
      [
        d.name,
        d.slug,
        d.status,
        d.plan_code,
        d.contact_name,
        d.contact_phone,
        d.contact_email,
        d.comment,
        d.code,
        d.phone,
        d.email,
        d.tariff_name,
        d.subscription_status,
        d.subscription_start_at,
        d.subscription_end_at,
        d.max_sku,
        d.max_locations,
        d.enabled_modules,
        d.is_active,
        d.is_blocked,
        d.block_reason
      ]
    );

    return res.status(201).json({
      ok: true,
      tenant: buildTenantResponse(rows[0])
    });
  } catch (error) {
    console.error('[POST /owner-admin/tenants] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error', details: error.message });
  }
});

router.put('/tenants/:id', async (req, res) => {
  try {
    const tenantId = Number(req.params.id);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'invalid_tenant_id' });
    }

    const exists = await pool.query(
      `SELECT id FROM saas.tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );
    if (exists.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'tenant_not_found' });
    }

    const validated = await validateTenantPayload(req.body || {}, tenantId);
    if (!validated.ok) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    const d = validated.data;

    const { rows } = await pool.query(
      `
      UPDATE saas.tenants
      SET
        name = $1,
        slug = $2,
        status = $3,
        plan_code = $4,
        contact_name = $5,
        contact_phone = $6,
        contact_email = $7,
        comment = $8,
        code = $9,
        phone = $10,
        email = $11,
        tariff_name = $12,
        subscription_status = $13,
        subscription_start_at = $14,
        subscription_end_at = $15,
        max_sku = $16,
        max_locations = $17,
        enabled_modules = $18::jsonb,
        is_active = $19,
        is_blocked = $20,
        block_reason = $21,
        updated_at = NOW()
      WHERE id = $22
      RETURNING *
      `,
      [
        d.name,
        d.slug,
        d.status,
        d.plan_code,
        d.contact_name,
        d.contact_phone,
        d.contact_email,
        d.comment,
        d.code,
        d.phone,
        d.email,
        d.tariff_name,
        d.subscription_status,
        d.subscription_start_at,
        d.subscription_end_at,
        d.max_sku,
        d.max_locations,
        d.enabled_modules,
        d.is_active,
        d.is_blocked,
        d.block_reason,
        tenantId
      ]
    );

    return res.json({
      ok: true,
      tenant: buildTenantResponse(rows[0])
    });
  } catch (error) {
    console.error('[PUT /owner-admin/tenants/:id] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error', details: error.message });
  }
});

router.patch('/tenants/:id/toggle-active', async (req, res) => {
  try {
    const tenantId = Number(req.params.id);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'invalid_tenant_id' });
    }

    const existing = await pool.query(
      `SELECT * FROM saas.tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'tenant_not_found' });
    }

    const tenant = existing.rows[0];
    const nextIsActive = !tenant.is_active;

    const { rows } = await pool.query(
      `
      UPDATE saas.tenants
      SET
        is_active = $2,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [tenantId, nextIsActive]
    );

    return res.json({
      ok: true,
      tenant: buildTenantResponse(rows[0])
    });
  } catch (error) {
    console.error('[PATCH /owner-admin/tenants/:id/toggle-active] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.patch('/tenants/:id/toggle-block', async (req, res) => {
  try {
    const tenantId = Number(req.params.id);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'invalid_tenant_id' });
    }

    const existing = await pool.query(
      `SELECT * FROM saas.tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'tenant_not_found' });
    }

    const tenant = existing.rows[0];
    const nextIsBlocked = !tenant.is_blocked;
    const reason =
      req.body && req.body.block_reason != null
        ? String(req.body.block_reason).trim()
        : null;

    let nextStatus = tenant.status;
    let nextSubscriptionStatus = tenant.subscription_status;
    let nextBlockReason = null;

    if (nextIsBlocked) {
      nextStatus = 'blocked';
      nextSubscriptionStatus = 'blocked';
      nextBlockReason = reason || 'manual block';
    } else {
      nextStatus = 'active';
      nextSubscriptionStatus =
        tenant.subscription_status === 'blocked' ? 'active' : tenant.subscription_status;
      nextBlockReason = null;
    }

    const { rows } = await pool.query(
      `
      UPDATE saas.tenants
      SET
        is_blocked = $2,
        block_reason = $3,
        status = $4,
        subscription_status = $5,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [tenantId, nextIsBlocked, nextBlockReason, nextStatus, nextSubscriptionStatus]
    );

    return res.json({
      ok: true,
      tenant: buildTenantResponse(rows[0])
    });
  } catch (error) {
    console.error('[PATCH /owner-admin/tenants/:id/toggle-block] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error', details: error.message });
  }
});

/* =========================================================
   USERS
========================================================= */

router.get('/users', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.tenant_id,
        u.username,
        u.full_name,
        u.role,
        u.is_active,
        u.is_blocked,
        u.last_login_at,
        u.created_at,
        u.updated_at,
        t.name AS tenant_name
      FROM saas.users u
      LEFT JOIN saas.tenants t ON t.id = u.tenant_id
      ORDER BY u.id DESC
    `);

    return res.json({
      ok: true,
      users: rows.map((row) => ({
        ...buildUserResponse(row),
        tenant_name: row.tenant_name
      }))
    });
  } catch (error) {
    console.error('[GET /owner-admin/users] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'invalid_user_id' });
    }

    const { rows } = await pool.query(
      `
      SELECT
        u.id,
        u.tenant_id,
        u.username,
        u.full_name,
        u.role,
        u.is_active,
        u.is_blocked,
        u.last_login_at,
        u.created_at,
        u.updated_at,
        t.name AS tenant_name
      FROM saas.users u
      LEFT JOIN saas.tenants t ON t.id = u.tenant_id
      WHERE u.id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'user_not_found' });
    }

    return res.json({
      ok: true,
      user: {
        ...buildUserResponse(rows[0]),
        tenant_name: rows[0].tenant_name
      }
    });
  } catch (error) {
    console.error('[GET /owner-admin/users/:id] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const password = String(req.body?.password || '').trim();
    if (!password || password.length < 4) {
      return res.status(400).json({ ok: false, error: 'invalid_password' });
    }

    const validated = await validateUserPayload(req.body || {});
    if (!validated.ok) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    const d = validated.data;
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const { rows } = await pool.query(
      `
      INSERT INTO saas.users (
        tenant_id,
        username,
        password_hash,
        full_name,
        role,
        is_active,
        is_blocked,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id, tenant_id, username, full_name, role, is_active, is_blocked, last_login_at, created_at, updated_at
      `,
      [
        d.tenant_id,
        d.username,
        passwordHash,
        d.full_name,
        d.role,
        d.is_active,
        d.is_blocked
      ]
    );

    return res.status(201).json({
      ok: true,
      user: buildUserResponse(rows[0])
    });
  } catch (error) {
    console.error('[POST /owner-admin/users] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error', details: error.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'invalid_user_id' });
    }

    const exists = await pool.query(
      `SELECT id FROM saas.users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    if (exists.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'user_not_found' });
    }

    const validated = await validateUserPayload(req.body || {}, userId);
    if (!validated.ok) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    const d = validated.data;

    const { rows } = await pool.query(
      `
      UPDATE saas.users
      SET
        tenant_id = $1,
        username = $2,
        full_name = $3,
        role = $4,
        is_active = $5,
        is_blocked = $6,
        updated_at = NOW()
      WHERE id = $7
      RETURNING id, tenant_id, username, full_name, role, is_active, is_blocked, last_login_at, created_at, updated_at
      `,
      [
        d.tenant_id,
        d.username,
        d.full_name,
        d.role,
        d.is_active,
        d.is_blocked,
        userId
      ]
    );

    return res.json({
      ok: true,
      user: buildUserResponse(rows[0])
    });
  } catch (error) {
    console.error('[PUT /owner-admin/users/:id] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.patch('/users/:id/toggle-active', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'invalid_user_id' });
    }

    const { rows } = await pool.query(
      `
      UPDATE saas.users
      SET
        is_active = NOT is_active,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, tenant_id, username, full_name, role, is_active, is_blocked, last_login_at, created_at, updated_at
      `,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'user_not_found' });
    }

    return res.json({
      ok: true,
      user: buildUserResponse(rows[0])
    });
  } catch (error) {
    console.error('[PATCH /owner-admin/users/:id/toggle-active] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.patch('/users/:id/toggle-block', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'invalid_user_id' });
    }

    const { rows } = await pool.query(
      `
      UPDATE saas.users
      SET
        is_blocked = NOT is_blocked,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, tenant_id, username, full_name, role, is_active, is_blocked, last_login_at, created_at, updated_at
      `,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'user_not_found' });
    }

    return res.json({
      ok: true,
      user: buildUserResponse(rows[0])
    });
  } catch (error) {
    console.error('[PATCH /owner-admin/users/:id/toggle-block] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'invalid_user_id' });
    }

    const newPassword = String(req.body?.password || '').trim();
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ ok: false, error: 'invalid_password' });
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const { rows } = await pool.query(
      `
      UPDATE saas.users
      SET
        password_hash = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING id, tenant_id, username, full_name, role, is_active, is_blocked, last_login_at, created_at, updated_at
      `,
      [passwordHash, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'user_not_found' });
    }

    return res.json({
      ok: true,
      user: buildUserResponse(rows[0])
    });
  } catch (error) {
    console.error('[POST /owner-admin/users/:id/reset-password] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

module.exports = router;