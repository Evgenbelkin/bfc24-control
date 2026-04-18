const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');

const router = express.Router();

function normalizeText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function normalizeNullableText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const v = String(value).trim();
  return v === '' ? null : v;
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

function buildTrialDates() {
  const start = new Date();
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  };
}

router.post('/', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const companyName = normalizeText(req.body.company_name);
    const contactName = normalizeNullableText(req.body.contact_name);
    const phone = normalizeNullableText(req.body.phone);
    const email = normalizeNullableText(req.body.email);
    const username = normalizeText(req.body.username);
    const password = normalizeText(req.body.password);
    const fullName = normalizeText(req.body.full_name || req.body.contact_name || '');
    let slug = normalizeText(req.body.slug);

    if (!companyName) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        ok: false,
        error: 'company_name_required',
        message: 'Название компании обязательно',
      });
    }

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
        message: 'Имя владельца обязательно',
      });
    }

    if (!slug) {
      slug = slugify(companyName);
    }

    if (!slug) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        ok: false,
        error: 'slug_required',
        message: 'Slug обязателен',
      });
    }

    const existingUsername = await client.query(
      `SELECT 1 FROM saas.users WHERE username = $1 LIMIT 1`,
      [username]
    );

    if (existingUsername.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        ok: false,
        error: 'username_exists',
        message: 'Пользователь с таким логином уже существует',
      });
    }

    const existingSlug = await client.query(
      `SELECT 1 FROM saas.tenants WHERE slug = $1 LIMIT 1`,
      [slug]
    );

    if (existingSlug.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        ok: false,
        error: 'slug_exists',
        message: 'Клиент с таким slug уже существует',
      });
    }

    const tariffResult = await client.query(
      `
        SELECT
          id,
          code,
          name,
          max_users,
          max_items,
          max_locations,
          enabled_modules
        FROM saas.tariffs
        WHERE code = 'basic'
          AND is_active = TRUE
        LIMIT 1
      `
    );

    if (!tariffResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(500).json({
        ok: false,
        error: 'basic_tariff_not_found',
        message: 'Не найден базовый тариф для регистрации',
      });
    }

    const basicTariff = tariffResult.rows[0];
    const { startAt, endAt } = buildTrialDates();

    const tenantInsert = await client.query(
      `
        INSERT INTO saas.tenants (
          name,
          slug,
          status,
          plan_code,
          tariff_name,
          tariff_id,
          contact_name,
          contact_phone,
          contact_email,
          phone,
          email,
          subscription_status,
          subscription_start_at,
          subscription_end_at,
          max_users,
          max_sku,
          max_locations,
          enabled_modules,
          is_active,
          is_blocked,
          showcase_enabled,
          showcase_settings
        )
        VALUES (
          $1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10,
          'trial', $11, $12, $13, $14, $15, $16::jsonb, TRUE, FALSE, FALSE, '{}'::jsonb
        )
        RETURNING *
      `,
      [
        companyName,
        slug,
        basicTariff.code,
        basicTariff.code,
        basicTariff.id,
        contactName,
        phone,
        email,
        phone,
        email,
        startAt,
        endAt,
        basicTariff.max_users,
        basicTariff.max_items,
        basicTariff.max_locations,
        JSON.stringify(Array.isArray(basicTariff.enabled_modules) ? basicTariff.enabled_modules : []),
      ]
    );

    const tenant = tenantInsert.rows[0];

    const passwordHash = await bcrypt.hash(password, 10);

    const userInsert = await client.query(
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
        VALUES ($1,$2,$3,'client',$4,$5,$6,TRUE,FALSE)
        RETURNING id, username, full_name, role, tenant_id, email, phone, is_active, is_blocked, created_at, updated_at
      `,
      [
        username,
        passwordHash,
        fullName,
        tenant.id,
        email,
        phone,
      ]
    );

    const user = userInsert.rows[0];

    const roleResult = await client.query(
      `
        SELECT id
        FROM saas.roles
        WHERE code = 'tenant_owner'
          AND is_active = TRUE
        LIMIT 1
      `
    );

    if (!roleResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(500).json({
        ok: false,
        error: 'tenant_owner_role_not_found',
        message: 'Не найдена роль tenant_owner',
      });
    }

    await client.query(
      `
        INSERT INTO saas.user_roles (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, role_id) DO NOTHING
      `,
      [user.id, roleResult.rows[0].id]
    );

    await client.query(
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
        tenant.id,
        user.id,
        'self_registration.create',
        'tenant',
        String(tenant.id),
        tenant.name,
        JSON.stringify({
          tenant_id: tenant.id,
          username: user.username,
          subscription_status: tenant.subscription_status,
          subscription_start_at: tenant.subscription_start_at,
          subscription_end_at: tenant.subscription_end_at,
        }),
        req.ip || null,
        req.headers['user-agent'] || null,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      message: 'Регистрация выполнена',
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        subscription_status: tenant.subscription_status,
        subscription_start_at: tenant.subscription_start_at,
        subscription_end_at: tenant.subscription_end_at,
        max_users: tenant.max_users,
        max_sku: tenant.max_sku,
        max_locations: tenant.max_locations,
      },
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        tenant_id: user.tenant_id,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[self-registration.POST /] error:', error);

    if (String(error.message || '').includes('duplicate key')) {
      return res.status(409).json({
        ok: false,
        error: 'duplicate_key',
        message: 'Пользователь или клиент с такими данными уже существует',
      });
    }

    return res.status(500).json({
      ok: false,
      error: 'self_registration_failed',
      message: 'Не удалось выполнить регистрацию',
    });
  } finally {
    client.release();
  }
});

module.exports = router;