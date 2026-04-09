const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { requirePermission, checkTenantUserLimit } = require('../middleware/permissions');

const router = express.Router();

router.use(authRequired);

function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function slugify(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function normalizeNullableText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const v = String(value).trim();
  return v === '' ? null : v;
}

function normalizeText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function parseIntOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return fallback;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function deriveTenantStatus({
  is_blocked,
  subscription_status,
}) {
  if (is_blocked === true) return 'blocked';
  if (subscription_status === 'blocked') return 'blocked';
  return 'active';
}

async function logOwnerAction({
  req,
  actionCode,
  entityType,
  entityId,
  entityLabel,
  details = {},
  tenantId = null,
}) {
  try {
    await pool.query(
      `
        INSERT INTO audit.activity_log (
          tenant_id,
          user_id,
          action_code,
          entity_type,
          entity_id,
          entity_label,
          details_json,
          ip_address,
          user_agent
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
      `,
      [
        tenantId,
        req.user?.id || null,
        actionCode,
        entityType || null,
        entityId ? String(entityId) : null,
        entityLabel || null,
        JSON.stringify(details || {}),
        req.ip || null,
        req.headers['user-agent'] || null,
      ]
    );
  } catch (error) {
    console.error('[owner-admin.logOwnerAction] error:', error);
  }
}

async function getTenantById(id) {
  const { rows } = await pool.query(
    `
      SELECT
        t.id,
        t.name,
        t.slug,
        t.code,
        t.status,
        t.subscription_status,
        t.plan_code,
        t.tariff_name,
        t.tariff_id,
        t.contact_name,
        t.contact_phone,
        t.contact_email,
        t.phone,
        t.email,
        t.comment,
        t.subscription_start_at,
        t.subscription_end_at,
        t.max_users,
        t.max_sku,
        t.max_locations,
        t.enabled_modules,
        t.is_active,
        t.is_blocked,
        t.block_reason,
        t.showcase_enabled,
        t.showcase_slug,
        t.showcase_settings,
        t.created_at,
        t.updated_at
      FROM saas.tenants t
      WHERE t.id = $1
      LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

async function getUserById(id) {
  const { rows } = await pool.query(
    `
      SELECT
        u.id,
        u.username,
        u.full_name,
        u.role,
        u.tenant_id,
        u.email,
        u.phone,
        u.is_active,
        u.is_blocked,
        u.last_login_at,
        u.created_at,
        u.updated_at,
        t.name AS tenant_name
      FROM saas.users u
      LEFT JOIN saas.tenants t
        ON t.id = u.tenant_id
      WHERE u.id = $1
      LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

router.get(
  '/tenants',
  requirePermission('owner.tenants.read'),
  async (req, res) => {
    try {
      const search = normalizeText(req.query.search);
      const status = normalizeText(req.query.status);
      const subscriptionStatus = normalizeText(req.query.subscription_status);
      const isActive = req.query.is_active;
      const isBlocked = req.query.is_blocked;

      const where = [];
      const params = [];
      let p = 1;

      if (search) {
        where.push(`
          (
            t.name ILIKE $${p}
            OR t.slug ILIKE $${p}
            OR COALESCE(t.code, '') ILIKE $${p}
            OR COALESCE(t.phone, '') ILIKE $${p}
            OR COALESCE(t.email, '') ILIKE $${p}
            OR COALESCE(t.contact_name, '') ILIKE $${p}
          )
        `);
        params.push(`%${search}%`);
        p++;
      }

      if (status) {
        where.push(`t.status = $${p}`);
        params.push(status);
        p++;
      }

      if (subscriptionStatus) {
        where.push(`t.subscription_status = $${p}`);
        params.push(subscriptionStatus);
        p++;
      }

      if (isActive !== undefined && isActive !== '') {
        where.push(`t.is_active = $${p}`);
        params.push(toBool(isActive));
        p++;
      }

      if (isBlocked !== undefined && isBlocked !== '') {
        where.push(`t.is_blocked = $${p}`);
        params.push(toBool(isBlocked));
        p++;
      }

      const sql = `
        SELECT
          t.id,
          t.name,
          t.slug,
          t.code,
          t.status,
          t.subscription_status,
          t.plan_code,
          t.tariff_name,
          t.tariff_id,
          tr.code AS tariff_code,
          tr.name AS tariff_title,
          t.contact_name,
          t.contact_phone,
          t.contact_email,
          t.phone,
          t.email,
          t.comment,
          t.subscription_start_at,
          t.subscription_end_at,
          t.max_users,
          t.max_sku,
          t.max_locations,
          t.enabled_modules,
          t.is_active,
          t.is_blocked,
          t.block_reason,
          t.showcase_enabled,
          t.showcase_slug,
          t.showcase_settings,
          t.created_at,
          t.updated_at,
          COALESCE(u.users_count, 0) AS users_count
        FROM saas.tenants t
        LEFT JOIN saas.tariffs tr
          ON tr.id = t.tariff_id
        LEFT JOIN (
          SELECT tenant_id, COUNT(*)::int AS users_count
          FROM saas.users
          GROUP BY tenant_id
        ) u
          ON u.tenant_id = t.id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY t.id DESC
      `;

      const { rows } = await pool.query(sql, params);

      return res.json({
        ok: true,
        tenants: rows,
      });
    } catch (error) {
      console.error('[owner-admin.GET /tenants] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'owner_tenants_list_failed',
        message: 'Не удалось получить список клиентов',
      });
    }
  }
);

router.get(
  '/tenants/:id',
  requirePermission('owner.tenants.read'),
  async (req, res) => {
    try {
      const tenantId = parseIntOrNull(req.params.id);
      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: 'tenant_id_invalid',
          message: 'Некорректный tenant_id',
        });
      }

      const { rows } = await pool.query(
        `
          SELECT
            t.id,
            t.name,
            t.slug,
            t.code,
            t.status,
            t.subscription_status,
            t.plan_code,
            t.tariff_name,
            t.tariff_id,
            tr.code AS tariff_code,
            tr.name AS tariff_title,
            t.contact_name,
            t.contact_phone,
            t.contact_email,
            t.phone,
            t.email,
            t.comment,
            t.subscription_start_at,
            t.subscription_end_at,
            t.max_users,
            t.max_sku,
            t.max_locations,
            t.enabled_modules,
            t.is_active,
            t.is_blocked,
            t.block_reason,
            t.showcase_enabled,
            t.showcase_slug,
            t.showcase_settings,
            t.created_at,
            t.updated_at
          FROM saas.tenants t
          LEFT JOIN saas.tariffs tr
            ON tr.id = t.tariff_id
          WHERE t.id = $1
          LIMIT 1
        `,
        [tenantId]
      );

      const tenant = rows[0];
      if (!tenant) {
        return res.status(404).json({
          ok: false,
          error: 'tenant_not_found',
          message: 'Клиент не найден',
        });
      }

      return res.json({
        ok: true,
        tenant,
      });
    } catch (error) {
      console.error('[owner-admin.GET /tenants/:id] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'owner_tenant_read_failed',
        message: 'Не удалось получить клиента',
      });
    }
  }
);

router.post(
  '/tenants',
  requirePermission('owner.tenants.create'),
  async (req, res) => {
    try {
      const name = normalizeText(req.body.name);
      let slug = normalizeText(req.body.slug);
      const code = normalizeNullableText(req.body.code);
      const planCode = normalizeText(req.body.plan_code, 'basic');
      const tariffName = normalizeText(req.body.tariff_name, 'basic');
      let subscriptionStatus = normalizeText(req.body.subscription_status, 'trial');
      const contactName = normalizeNullableText(req.body.contact_name);
      const contactPhone = normalizeNullableText(req.body.contact_phone);
      const contactEmail = normalizeNullableText(req.body.contact_email);
      const phone = normalizeNullableText(req.body.phone);
      const email = normalizeNullableText(req.body.email);
      const comment = normalizeNullableText(req.body.comment);
      const subscriptionStartAt = req.body.subscription_start_at || null;
      const subscriptionEndAt = req.body.subscription_end_at || null;
      const maxUsers = parseIntOrNull(req.body.max_users) ?? 3;
      const maxSku = parseIntOrNull(req.body.max_sku) ?? 1000;
      const maxLocations = parseIntOrNull(req.body.max_locations) ?? 10;
      const enabledModules = parseJsonArray(req.body.enabled_modules, []);
      const isActive = req.body.is_active === undefined ? true : toBool(req.body.is_active, true);
      const isBlocked = req.body.is_blocked === undefined ? false : toBool(req.body.is_blocked, false);
      const blockReason = normalizeNullableText(req.body.block_reason);
      const tariffId = parseIntOrNull(req.body.tariff_id);
      const showcaseEnabled = toBool(req.body.showcase_enabled, false);
      const showcaseSlug = normalizeNullableText(req.body.showcase_slug);
      const showcaseSettings =
        req.body.showcase_settings && typeof req.body.showcase_settings === 'object'
          ? req.body.showcase_settings
          : {};

      if (!name) {
        return res.status(400).json({
          ok: false,
          error: 'name_required',
          message: 'Название клиента обязательно',
        });
      }

      if (!slug) {
        slug = slugify(name);
      }

      if (!slug) {
        return res.status(400).json({
          ok: false,
          error: 'slug_required',
          message: 'Slug обязателен',
        });
      }

      if (!['trial', 'active', 'expired', 'blocked'].includes(subscriptionStatus)) {
        subscriptionStatus = 'trial';
      }

      const status = deriveTenantStatus({
        is_blocked: isBlocked,
        subscription_status: subscriptionStatus,
      });

      const duplicateSlug = await pool.query(
        `SELECT 1 FROM saas.tenants WHERE slug = $1 LIMIT 1`,
        [slug]
      );

      if (duplicateSlug.rows.length) {
        return res.status(409).json({
          ok: false,
          error: 'slug_exists',
          message: 'Клиент с таким slug уже существует',
        });
      }

      const { rows } = await pool.query(
        `
          INSERT INTO saas.tenants (
            name,
            slug,
            code,
            status,
            plan_code,
            tariff_name,
            tariff_id,
            contact_name,
            contact_phone,
            contact_email,
            phone,
            email,
            comment,
            subscription_status,
            subscription_start_at,
            subscription_end_at,
            max_users,
            max_sku,
            max_locations,
            enabled_modules,
            is_active,
            is_blocked,
            block_reason,
            showcase_enabled,
            showcase_slug,
            showcase_settings
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,
            $21,$22,$23,$24,$25,$26::jsonb
          )
          RETURNING *
        `,
        [
          name,
          slug,
          code,
          status,
          planCode,
          tariffName,
          tariffId,
          contactName,
          contactPhone,
          contactEmail,
          phone,
          email,
          comment,
          subscriptionStatus,
          subscriptionStartAt,
          subscriptionEndAt,
          maxUsers,
          maxSku,
          maxLocations,
          JSON.stringify(enabledModules),
          isActive,
          isBlocked,
          blockReason,
          showcaseEnabled,
          showcaseSlug,
          JSON.stringify(showcaseSettings),
        ]
      );

      const tenant = rows[0];

      await logOwnerAction({
        req,
        actionCode: 'owner.tenant.create',
        entityType: 'tenant',
        entityId: tenant.id,
        entityLabel: tenant.name,
        details: {
          subscription_status: tenant.subscription_status,
          tariff_id: tenant.tariff_id,
          max_users: tenant.max_users,
          max_sku: tenant.max_sku,
          max_locations: tenant.max_locations,
        },
      });

      return res.status(201).json({
        ok: true,
        tenant,
      });
    } catch (error) {
      console.error('[owner-admin.POST /tenants] error:', error);

      if (String(error.message || '').includes('duplicate key')) {
        return res.status(409).json({
          ok: false,
          error: 'tenant_duplicate',
          message: 'Клиент с такими данными уже существует',
        });
      }

      return res.status(500).json({
        ok: false,
        error: 'owner_tenant_create_failed',
        message: 'Не удалось создать клиента',
      });
    }
  }
);

router.put(
  '/tenants/:id',
  requirePermission('owner.tenants.update'),
  async (req, res) => {
    try {
      const tenantId = parseIntOrNull(req.params.id);
      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: 'tenant_id_invalid',
          message: 'Некорректный tenant_id',
        });
      }

      const current = await getTenantById(tenantId);
      if (!current) {
        return res.status(404).json({
          ok: false,
          error: 'tenant_not_found',
          message: 'Клиент не найден',
        });
      }

      const name = normalizeText(req.body.name);
      let slug = normalizeText(req.body.slug);
      const code = normalizeNullableText(req.body.code);
      const planCode = normalizeText(req.body.plan_code, current.plan_code || 'basic');
      const tariffName = normalizeText(req.body.tariff_name, current.tariff_name || 'basic');
      let subscriptionStatus = normalizeText(
        req.body.subscription_status,
        current.subscription_status || 'trial'
      );
      const contactName = normalizeNullableText(
        req.body.contact_name !== undefined ? req.body.contact_name : current.contact_name
      );
      const contactPhone = normalizeNullableText(
        req.body.contact_phone !== undefined ? req.body.contact_phone : current.contact_phone
      );
      const contactEmail = normalizeNullableText(
        req.body.contact_email !== undefined ? req.body.contact_email : current.contact_email
      );
      const phone = normalizeNullableText(
        req.body.phone !== undefined ? req.body.phone : current.phone
      );
      const email = normalizeNullableText(
        req.body.email !== undefined ? req.body.email : current.email
      );
      const comment = normalizeNullableText(
        req.body.comment !== undefined ? req.body.comment : current.comment
      );
      const subscriptionStartAt =
        req.body.subscription_start_at !== undefined
          ? req.body.subscription_start_at
          : current.subscription_start_at;
      const subscriptionEndAt =
        req.body.subscription_end_at !== undefined
          ? req.body.subscription_end_at
          : current.subscription_end_at;
      const maxUsers = parseIntOrNull(
        req.body.max_users !== undefined ? req.body.max_users : current.max_users
      );
      const maxSku = parseIntOrNull(
        req.body.max_sku !== undefined ? req.body.max_sku : current.max_sku
      );
      const maxLocations = parseIntOrNull(
        req.body.max_locations !== undefined ? req.body.max_locations : current.max_locations
      );
      const enabledModules =
        req.body.enabled_modules !== undefined
          ? parseJsonArray(req.body.enabled_modules, [])
          : Array.isArray(current.enabled_modules)
          ? current.enabled_modules
          : [];
      const isActive =
        req.body.is_active !== undefined ? toBool(req.body.is_active) : current.is_active;
      const isBlocked =
        req.body.is_blocked !== undefined ? toBool(req.body.is_blocked) : current.is_blocked;
      const blockReason = normalizeNullableText(
        req.body.block_reason !== undefined ? req.body.block_reason : current.block_reason
      );
      const tariffId =
        req.body.tariff_id !== undefined
          ? parseIntOrNull(req.body.tariff_id)
          : current.tariff_id;
      const showcaseEnabled =
        req.body.showcase_enabled !== undefined
          ? toBool(req.body.showcase_enabled)
          : current.showcase_enabled;
      const showcaseSlug = normalizeNullableText(
        req.body.showcase_slug !== undefined ? req.body.showcase_slug : current.showcase_slug
      );
      const showcaseSettings =
        req.body.showcase_settings !== undefined &&
        req.body.showcase_settings &&
        typeof req.body.showcase_settings === 'object'
          ? req.body.showcase_settings
          : current.showcase_settings || {};

      if (!name) {
        return res.status(400).json({
          ok: false,
          error: 'name_required',
          message: 'Название клиента обязательно',
        });
      }

      if (!slug) {
        slug = slugify(name);
      }

      if (!slug) {
        return res.status(400).json({
          ok: false,
          error: 'slug_required',
          message: 'Slug обязателен',
        });
      }

      if (!['trial', 'active', 'expired', 'blocked'].includes(subscriptionStatus)) {
        subscriptionStatus = current.subscription_status || 'trial';
      }

      const status = deriveTenantStatus({
        is_blocked: isBlocked,
        subscription_status: subscriptionStatus,
      });

      const duplicateSlug = await pool.query(
        `SELECT 1 FROM saas.tenants WHERE slug = $1 AND id <> $2 LIMIT 1`,
        [slug, tenantId]
      );

      if (duplicateSlug.rows.length) {
        return res.status(409).json({
          ok: false,
          error: 'slug_exists',
          message: 'Клиент с таким slug уже существует',
        });
      }

      const { rows } = await pool.query(
        `
          UPDATE saas.tenants
          SET
            name = $1,
            slug = $2,
            code = $3,
            status = $4,
            plan_code = $5,
            tariff_name = $6,
            tariff_id = $7,
            contact_name = $8,
            contact_phone = $9,
            contact_email = $10,
            phone = $11,
            email = $12,
            comment = $13,
            subscription_status = $14,
            subscription_start_at = $15,
            subscription_end_at = $16,
            max_users = $17,
            max_sku = $18,
            max_locations = $19,
            enabled_modules = $20::jsonb,
            is_active = $21,
            is_blocked = $22,
            block_reason = $23,
            showcase_enabled = $24,
            showcase_slug = $25,
            showcase_settings = $26::jsonb
          WHERE id = $27
          RETURNING *
        `,
        [
          name,
          slug,
          code,
          status,
          planCode,
          tariffName,
          tariffId,
          contactName,
          contactPhone,
          contactEmail,
          phone,
          email,
          comment,
          subscriptionStatus,
          subscriptionStartAt,
          subscriptionEndAt,
          maxUsers,
          maxSku,
          maxLocations,
          JSON.stringify(enabledModules),
          isActive,
          isBlocked,
          blockReason,
          showcaseEnabled,
          showcaseSlug,
          JSON.stringify(showcaseSettings),
          tenantId,
        ]
      );

      const tenant = rows[0];

      await logOwnerAction({
        req,
        actionCode: 'owner.tenant.update',
        entityType: 'tenant',
        entityId: tenant.id,
        entityLabel: tenant.name,
        details: {
          before: current,
          after: tenant,
        },
      });

      return res.json({
        ok: true,
        tenant,
      });
    } catch (error) {
      console.error('[owner-admin.PUT /tenants/:id] error:', error);

      if (String(error.message || '').includes('duplicate key')) {
        return res.status(409).json({
          ok: false,
          error: 'tenant_duplicate',
          message: 'Клиент с такими данными уже существует',
        });
      }

      return res.status(500).json({
        ok: false,
        error: 'owner_tenant_update_failed',
        message: 'Не удалось обновить клиента',
      });
    }
  }
);

router.patch(
  '/tenants/:id/toggle-active',
  requirePermission('owner.tenants.update'),
  async (req, res) => {
    try {
      const tenantId = parseIntOrNull(req.params.id);
      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: 'tenant_id_invalid',
          message: 'Некорректный tenant_id',
        });
      }

      const current = await getTenantById(tenantId);
      if (!current) {
        return res.status(404).json({
          ok: false,
          error: 'tenant_not_found',
          message: 'Клиент не найден',
        });
      }

      const nextIsActive = !current.is_active;

      const { rows } = await pool.query(
        `
          UPDATE saas.tenants
          SET is_active = $1
          WHERE id = $2
          RETURNING *
        `,
        [nextIsActive, tenantId]
      );

      const tenant = rows[0];

      await logOwnerAction({
        req,
        actionCode: 'owner.tenant.toggle_active',
        entityType: 'tenant',
        entityId: tenant.id,
        entityLabel: tenant.name,
        details: {
          before_is_active: current.is_active,
          after_is_active: tenant.is_active,
        },
      });

      return res.json({
        ok: true,
        tenant,
      });
    } catch (error) {
      console.error('[owner-admin.PATCH /tenants/:id/toggle-active] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'owner_tenant_toggle_active_failed',
        message: 'Не удалось изменить активность клиента',
      });
    }
  }
);

router.patch(
  '/tenants/:id/toggle-block',
  requirePermission('owner.tenants.update'),
  async (req, res) => {
    try {
      const tenantId = parseIntOrNull(req.params.id);
      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: 'tenant_id_invalid',
          message: 'Некорректный tenant_id',
        });
      }

      const current = await getTenantById(tenantId);
      if (!current) {
        return res.status(404).json({
          ok: false,
          error: 'tenant_not_found',
          message: 'Клиент не найден',
        });
      }

      const nextBlocked = !current.is_blocked;
      const reasonFromBody = normalizeNullableText(req.body.block_reason);

      let nextSubscriptionStatus = current.subscription_status;
      let nextBlockReason = current.block_reason;

      if (nextBlocked) {
        nextSubscriptionStatus = 'blocked';
        nextBlockReason = reasonFromBody || current.block_reason || 'Заблокировано owner';
      } else {
        nextSubscriptionStatus =
          current.subscription_status === 'blocked' ? 'active' : current.subscription_status;
        nextBlockReason = null;
      }

      const nextStatus = deriveTenantStatus({
        is_blocked: nextBlocked,
        subscription_status: nextSubscriptionStatus,
      });

      const { rows } = await pool.query(
        `
          UPDATE saas.tenants
          SET
            is_blocked = $1,
            status = $2,
            subscription_status = $3,
            block_reason = $4
          WHERE id = $5
          RETURNING *
        `,
        [nextBlocked, nextStatus, nextSubscriptionStatus, nextBlockReason, tenantId]
      );

      const tenant = rows[0];

      await logOwnerAction({
        req,
        actionCode: 'owner.tenant.toggle_block',
        entityType: 'tenant',
        entityId: tenant.id,
        entityLabel: tenant.name,
        details: {
          before_is_blocked: current.is_blocked,
          after_is_blocked: tenant.is_blocked,
          before_subscription_status: current.subscription_status,
          after_subscription_status: tenant.subscription_status,
          block_reason: tenant.block_reason,
        },
      });

      return res.json({
        ok: true,
        tenant,
      });
    } catch (error) {
      console.error('[owner-admin.PATCH /tenants/:id/toggle-block] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'owner_tenant_toggle_block_failed',
        message: 'Не удалось изменить блокировку клиента',
      });
    }
  }
);

router.get(
  '/users',
  requirePermission('owner.users.read'),
  async (req, res) => {
    try {
      const search = normalizeText(req.query.search);
      const role = normalizeText(req.query.role);
      const tenantId = parseIntOrNull(req.query.tenant_id);
      const isActive = req.query.is_active;
      const isBlocked = req.query.is_blocked;

      const where = [];
      const params = [];
      let p = 1;

      if (search) {
        where.push(`
          (
            u.username ILIKE $${p}
            OR u.full_name ILIKE $${p}
            OR COALESCE(u.email, '') ILIKE $${p}
            OR COALESCE(u.phone, '') ILIKE $${p}
            OR COALESCE(t.name, '') ILIKE $${p}
          )
        `);
        params.push(`%${search}%`);
        p++;
      }

      if (role) {
        where.push(`u.role = $${p}`);
        params.push(role);
        p++;
      }

      if (tenantId) {
        where.push(`u.tenant_id = $${p}`);
        params.push(tenantId);
        p++;
      }

      if (isActive !== undefined && isActive !== '') {
        where.push(`u.is_active = $${p}`);
        params.push(toBool(isActive));
        p++;
      }

      if (isBlocked !== undefined && isBlocked !== '') {
        where.push(`u.is_blocked = $${p}`);
        params.push(toBool(isBlocked));
        p++;
      }

      const sql = `
        SELECT
          u.id,
          u.username,
          u.full_name,
          u.role,
          u.tenant_id,
          u.email,
          u.phone,
          u.is_active,
          u.is_blocked,
          u.last_login_at,
          u.created_at,
          u.updated_at,
          t.name AS tenant_name,
          COALESCE(roles.roles_json, '[]'::json) AS rbac_roles
        FROM saas.users u
        LEFT JOIN saas.tenants t
          ON t.id = u.tenant_id
        LEFT JOIN (
          SELECT
            ur.user_id,
            json_agg(r.code ORDER BY r.code) AS roles_json
          FROM saas.user_roles ur
          JOIN saas.roles r ON r.id = ur.role_id
          GROUP BY ur.user_id
        ) roles
          ON roles.user_id = u.id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY u.id DESC
      `;

      const { rows } = await pool.query(sql, params);

      return res.json({
        ok: true,
        users: rows,
      });
    } catch (error) {
      console.error('[owner-admin.GET /users] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'owner_users_list_failed',
        message: 'Не удалось получить список пользователей',
      });
    }
  }
);

router.get(
  '/users/:id',
  requirePermission('owner.users.read'),
  async (req, res) => {
    try {
      const userId = parseIntOrNull(req.params.id);
      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'user_id_invalid',
          message: 'Некорректный user_id',
        });
      }

      const { rows } = await pool.query(
        `
          SELECT
            u.id,
            u.username,
            u.full_name,
            u.role,
            u.tenant_id,
            u.email,
            u.phone,
            u.is_active,
            u.is_blocked,
            u.last_login_at,
            u.created_at,
            u.updated_at,
            t.name AS tenant_name,
            COALESCE(roles.roles_json, '[]'::json) AS rbac_roles
          FROM saas.users u
          LEFT JOIN saas.tenants t
            ON t.id = u.tenant_id
          LEFT JOIN (
            SELECT
              ur.user_id,
              json_agg(r.code ORDER BY r.code) AS roles_json
            FROM saas.user_roles ur
            JOIN saas.roles r ON r.id = ur.role_id
            GROUP BY ur.user_id
          ) roles
            ON roles.user_id = u.id
          WHERE u.id = $1
          LIMIT 1
        `,
        [userId]
      );

      const user = rows[0];
      if (!user) {
        return res.status(404).json({
          ok: false,
          error: 'user_not_found',
          message: 'Пользователь не найден',
        });
      }

      return res.json({
        ok: true,
        user,
      });
    } catch (error) {
      console.error('[owner-admin.GET /users/:id] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'owner_user_read_failed',
        message: 'Не удалось получить пользователя',
      });
    }
  }
);

router.post(
  '/users',
  requirePermission('owner.users.create'),
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const username = normalizeText(req.body.username);
      const password = normalizeText(req.body.password);
      const fullName = normalizeText(req.body.full_name);
      const role = normalizeText(req.body.role, 'client');
      const tenantId = parseIntOrNull(req.body.tenant_id);
      const email = normalizeNullableText(req.body.email);
      const phone = normalizeNullableText(req.body.phone);
      const isActive = req.body.is_active === undefined ? true : toBool(req.body.is_active, true);
      const isBlocked = req.body.is_blocked === undefined ? false : toBool(req.body.is_blocked, false);
      const rbacRolesInput = parseJsonArray(req.body.rbac_roles, []);

      if (!username) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          ok: false,
          error: 'username_required',
          message: 'Логин обязателен',
        });
      }

      if (!password) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          ok: false,
          error: 'password_required',
          message: 'Пароль обязателен',
        });
      }

      if (!fullName) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          ok: false,
          error: 'full_name_required',
          message: 'Имя обязательно',
        });
      }

      if (tenantId) {
        const limitCheck = await checkTenantUserLimit(tenantId);

        if (!limitCheck.ok) {
          await client.query('ROLLBACK');
          return res.status(403).json(limitCheck);
        }
      }

      const duplicate = await client.query(
        `SELECT 1 FROM saas.users WHERE username = $1 LIMIT 1`,
        [username]
      );

      if (duplicate.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          ok: false,
          error: 'username_exists',
          message: 'Пользователь с таким логином уже существует',
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const insertResult = await client.query(
        `
          INSERT INTO saas.users (
            username,
            password_hash,
            full_name,
            role,
            tenant_id,
            email,
            phone,
            is_active,
            is_blocked
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          RETURNING id, username, full_name, role, tenant_id, email, phone, is_active, is_blocked, created_at, updated_at
        `,
        [
          username,
          passwordHash,
          fullName,
          role,
          tenantId,
          email,
          phone,
          isActive,
          isBlocked,
        ]
      );

      const user = insertResult.rows[0];

      let roleCodesToAssign = Array.isArray(rbacRolesInput) && rbacRolesInput.length
        ? rbacRolesInput
        : role === 'owner'
        ? ['owner']
        : ['tenant_owner'];

      roleCodesToAssign = [...new Set(roleCodesToAssign.map((v) => String(v).trim()).filter(Boolean))];

      if (roleCodesToAssign.length) {
        const rolesResult = await client.query(
          `
            SELECT id, code
            FROM saas.roles
            WHERE code = ANY($1::text[])
              AND is_active = TRUE
          `,
          [roleCodesToAssign]
        );

        for (const row of rolesResult.rows) {
          await client.query(
            `
              INSERT INTO saas.user_roles (user_id, role_id)
              VALUES ($1, $2)
              ON CONFLICT (user_id, role_id) DO NOTHING
            `,
            [user.id, row.id]
          );
        }
      }

      await client.query('COMMIT');

      await logOwnerAction({
        req,
        actionCode: 'owner.user.create',
        entityType: 'user',
        entityId: user.id,
        entityLabel: user.username,
        tenantId: user.tenant_id,
        details: {
          role: user.role,
          rbac_roles: roleCodesToAssign,
        },
      });

      return res.status(201).json({
        ok: true,
        user,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[owner-admin.POST /users] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'owner_user_create_failed',
        message: 'Не удалось создать пользователя',
      });
    } finally {
      client.release();
    }
  }
);

router.put(
  '/users/:id',
  requirePermission('owner.users.update'),
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const userId = parseIntOrNull(req.params.id);
      if (!userId) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          ok: false,
          error: 'user_id_invalid',
          message: 'Некорректный user_id',
        });
      }

      const current = await getUserById(userId);
      if (!current) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          ok: false,
          error: 'user_not_found',
          message: 'Пользователь не найден',
        });
      }

      const username = normalizeText(req.body.username, current.username);
      const fullName = normalizeText(req.body.full_name, current.full_name);
      const role = normalizeText(req.body.role, current.role);
      const tenantId =
        req.body.tenant_id !== undefined ? parseIntOrNull(req.body.tenant_id) : current.tenant_id;
      const email = normalizeNullableText(
        req.body.email !== undefined ? req.body.email : current.email
      );
      const phone = normalizeNullableText(
        req.body.phone !== undefined ? req.body.phone : current.phone
      );
      const isActive =
        req.body.is_active !== undefined ? toBool(req.body.is_active) : current.is_active;
      const isBlocked =
        req.body.is_blocked !== undefined ? toBool(req.body.is_blocked) : current.is_blocked;
      const rbacRolesInput =
        req.body.rbac_roles !== undefined ? parseJsonArray(req.body.rbac_roles, []) : null;

      if (!username) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          ok: false,
          error: 'username_required',
          message: 'Логин обязателен',
        });
      }

      if (!fullName) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          ok: false,
          error: 'full_name_required',
          message: 'Имя обязательно',
        });
      }

      const duplicate = await client.query(
        `SELECT 1 FROM saas.users WHERE username = $1 AND id <> $2 LIMIT 1`,
        [username, userId]
      );

      if (duplicate.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          ok: false,
          error: 'username_exists',
          message: 'Пользователь с таким логином уже существует',
        });
      }

      const { rows } = await client.query(
        `
          UPDATE saas.users
          SET
            username = $1,
            full_name = $2,
            role = $3,
            tenant_id = $4,
            email = $5,
            phone = $6,
            is_active = $7,
            is_blocked = $8
          WHERE id = $9
          RETURNING id, username, full_name, role, tenant_id, email, phone, is_active, is_blocked, last_login_at, created_at, updated_at
        `,
        [username, fullName, role, tenantId, email, phone, isActive, isBlocked, userId]
      );

      const user = rows[0];

      if (rbacRolesInput !== null) {
        await client.query(`DELETE FROM saas.user_roles WHERE user_id = $1`, [userId]);

        let roleCodesToAssign = [...new Set(rbacRolesInput.map((v) => String(v).trim()).filter(Boolean))];

        if (!roleCodesToAssign.length) {
          roleCodesToAssign = role === 'owner' ? ['owner'] : ['tenant_owner'];
        }

        const rolesResult = await client.query(
          `
            SELECT id, code
            FROM saas.roles
            WHERE code = ANY($1::text[])
              AND is_active = TRUE
          `,
          [roleCodesToAssign]
        );

        for (const row of rolesResult.rows) {
          await client.query(
            `
              INSERT INTO saas.user_roles (user_id, role_id)
              VALUES ($1, $2)
              ON CONFLICT (user_id, role_id) DO NOTHING
            `,
            [userId, row.id]
          );
        }
      }

      await client.query('COMMIT');

      await logOwnerAction({
        req,
        actionCode: 'owner.user.update',
        entityType: 'user',
        entityId: user.id,
        entityLabel: user.username,
        tenantId: user.tenant_id,
        details: {
          before: current,
          after: user,
          rbac_roles_updated: rbacRolesInput,
        },
      });

      return res.json({
        ok: true,
        user,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[owner-admin.PUT /users/:id] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'owner_user_update_failed',
        message: 'Не удалось обновить пользователя',
      });
    } finally {
      client.release();
    }
  }
);

router.patch(
  '/users/:id/toggle-active',
  requirePermission('owner.users.update'),
  async (req, res) => {
    try {
      const userId = parseIntOrNull(req.params.id);
      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'user_id_invalid',
          message: 'Некорректный user_id',
        });
      }

      const current = await getUserById(userId);
      if (!current) {
        return res.status(404).json({
          ok: false,
          error: 'user_not_found',
          message: 'Пользователь не найден',
        });
      }

      const { rows } = await pool.query(
        `
          UPDATE saas.users
          SET is_active = NOT is_active
          WHERE id = $1
          RETURNING id, username, full_name, role, tenant_id, email, phone, is_active, is_blocked, last_login_at, created_at, updated_at
        `,
        [userId]
      );

      const user = rows[0];

      await logOwnerAction({
        req,
        actionCode: 'owner.user.toggle_active',
        entityType: 'user',
        entityId: user.id,
        entityLabel: user.username,
        tenantId: user.tenant_id,
        details: {
          before_is_active: current.is_active,
          after_is_active: user.is_active,
        },
      });

      return res.json({
        ok: true,
        user,
      });
    } catch (error) {
      console.error('[owner-admin.PATCH /users/:id/toggle-active] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'owner_user_toggle_active_failed',
        message: 'Не удалось изменить активность пользователя',
      });
    }
  }
);

router.patch(
  '/users/:id/toggle-block',
  requirePermission('owner.users.update'),
  async (req, res) => {
    try {
      const userId = parseIntOrNull(req.params.id);
      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'user_id_invalid',
          message: 'Некорректный user_id',
        });
      }

      const current = await getUserById(userId);
      if (!current) {
        return res.status(404).json({
          ok: false,
          error: 'user_not_found',
          message: 'Пользователь не найден',
        });
      }

      const { rows } = await pool.query(
        `
          UPDATE saas.users
          SET is_blocked = NOT is_blocked
          WHERE id = $1
          RETURNING id, username, full_name, role, tenant_id, email, phone, is_active, is_blocked, last_login_at, created_at, updated_at
        `,
        [userId]
      );

      const user = rows[0];

      await logOwnerAction({
        req,
        actionCode: 'owner.user.toggle_block',
        entityType: 'user',
        entityId: user.id,
        entityLabel: user.username,
        tenantId: user.tenant_id,
        details: {
          before_is_blocked: current.is_blocked,
          after_is_blocked: user.is_blocked,
        },
      });

      return res.json({
        ok: true,
        user,
      });
    } catch (error) {
      console.error('[owner-admin.PATCH /users/:id/toggle-block] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'owner_user_toggle_block_failed',
        message: 'Не удалось изменить блокировку пользователя',
      });
    }
  }
);

router.post(
  '/users/:id/reset-password',
  requirePermission('owner.users.update'),
  async (req, res) => {
    try {
      const userId = parseIntOrNull(req.params.id);
      const newPassword = normalizeText(req.body.password);

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'user_id_invalid',
          message: 'Некорректный user_id',
        });
      }

      if (!newPassword) {
        return res.status(400).json({
          ok: false,
          error: 'password_required',
          message: 'Новый пароль обязателен',
        });
      }

      const current = await getUserById(userId);
      if (!current) {
        return res.status(404).json({
          ok: false,
          error: 'user_not_found',
          message: 'Пользователь не найден',
        });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);

      await pool.query(
        `
          UPDATE saas.users
          SET password_hash = $1
          WHERE id = $2
        `,
        [passwordHash, userId]
      );

      await logOwnerAction({
        req,
        actionCode: 'owner.user.reset_password',
        entityType: 'user',
        entityId: current.id,
        entityLabel: current.username,
        tenantId: current.tenant_id,
        details: {
          reset_by: req.user?.username || null,
        },
      });

      return res.json({
        ok: true,
        message: 'Пароль обновлён',
      });
    } catch (error) {
      console.error('[owner-admin.POST /users/:id/reset-password] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'owner_user_reset_password_failed',
        message: 'Не удалось сбросить пароль',
      });
    }
  }
);

module.exports = router;