"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const {
  authRequired,
  requireRole,
  getEffectiveTenantId,
} = require("../middleware/auth");
const {
  requirePermission,
  requireActiveWriteSubscription,
  checkTenantUserLimit,
} = require("../middleware/permissions");

const router = express.Router();

/* ──────────────────────────────────────────────────────────────────────────
   UTILITY HELPERS
   (повторяют стиль owner-admin.js и items.js)
────────────────────────────────────────────────────────────────────────── */

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function normalizeNullableText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const v = String(value).trim();
  return v === "" ? null : v;
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function parseIntOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* ──────────────────────────────────────────────────────────────────────────
   QUERY HELPER: загружает пользователя только внутри tenant
────────────────────────────────────────────────────────────────────────── */

async function getUserInTenant(userId, tenantId) {
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
        u.updated_at
      FROM saas.users u
      WHERE u.id = $1
        AND u.tenant_id = $2
      LIMIT 1
    `,
    [userId, tenantId]
  );

  return rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────────────────
   AUDIT LOG (опциональный, не ломает работу при ошибке)
────────────────────────────────────────────────────────────────────────── */

async function logAction({ req, actionCode, entityId, entityLabel, details, tenantId }) {
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
        tenantId || null,
        req.user?.id || null,
        actionCode,
        "user",
        entityId ? String(entityId) : null,
        entityLabel || null,
        JSON.stringify(details || {}),
        req.ip || null,
        req.headers["user-agent"] || null,
      ]
    );
  } catch (err) {
    console.error("[users.logAction] error:", err);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   GET /users
   Список пользователей текущего tenant.
   Поиск по username / full_name.
   RBAC: users.read
══════════════════════════════════════════════════════════════════════════ */

router.get(
  "/",
  authRequired,
  requirePermission("users.read"),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
          message: "Не удалось определить tenant",
        });
      }

      const search = normalizeText(req.query.search);

      const params = [tenantId];
      let whereSql = `WHERE u.tenant_id = $1`;

      if (search) {
        params.push(`%${search}%`);
        whereSql += ` AND (
          u.username ILIKE $${params.length}
          OR u.full_name ILIKE $${params.length}
        )`;
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
          u.updated_at
        FROM saas.users u
        ${whereSql}
        ORDER BY u.id ASC
      `;

      const { rows } = await pool.query(sql, params);

      return res.json({
        ok: true,
        users: rows,
      });
    } catch (err) {
      console.error("[GET /users] error:", err);
      return res.status(500).json({
        ok: false,
        error: "users_list_failed",
        message: "Не удалось загрузить список пользователей",
      });
    }
  }
);

/* ══════════════════════════════════════════════════════════════════════════
   POST /users
   Создание нового пользователя внутри tenant.
   - Проверяет лимит тарифа через checkTenantUserLimit
   - Хэширует пароль через bcrypt
   - username уникален глобально (как в owner-admin.js)
   - role фиксирована в "client" — нельзя назначить owner
   - RBAC роль назначается tenant_member
   RBAC: users.create
══════════════════════════════════════════════════════════════════════════ */

router.post(
  "/",
  authRequired,
  requirePermission("users.create"),
  requireActiveWriteSubscription(),
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const tenantId = getEffectiveTenantId(req);

      if (!tenantId) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
          message: "Не удалось определить tenant",
        });
      }

      const username  = normalizeText(req.body.username);
      const password  = normalizeText(req.body.password);
      const fullName  = normalizeText(req.body.full_name);

      /* Обязательные поля */
      if (!username) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "username_required",
          message: "Логин обязателен",
        });
      }

      if (!password) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "password_required",
          message: "Пароль обязателен",
        });
      }

      if (!fullName) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "full_name_required",
          message: "Имя обязательно",
        });
      }

      /* Проверяем лимит пользователей по тарифу */
      const limitCheck = await checkTenantUserLimit(tenantId);
      if (!limitCheck.ok) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          ok: false,
          error: "limit_reached",
          message: limitCheck.message || "Достигнут лимит пользователей по тарифу",
          current: limitCheck.current,
          limit: limitCheck.limit,
        });
      }

      /* Уникальность username глобально (как в owner-admin.js) */
      const duplicate = await client.query(
        `SELECT 1 FROM saas.users WHERE username = $1 LIMIT 1`,
        [username]
      );

      if (duplicate.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error: "username_exists",
          message: "Пользователь с таким логином уже существует",
        });
      }

      /* Хэшируем пароль */
      const passwordHash = await bcrypt.hash(password, 10);

      /* Вставляем пользователя.
         role всегда "client" — клиент не может назначить owner */
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
          VALUES ($1,$2,$3,'client',$4,NULL,NULL,TRUE,FALSE)
          RETURNING
            id,
            username,
            full_name,
            role,
            tenant_id,
            email,
            phone,
            is_active,
            is_blocked,
            last_login_at,
            created_at,
            updated_at
        `,
        [username, passwordHash, fullName, tenantId]
      );

      const user = insertResult.rows[0];

      /* Назначаем RBAC-роль tenant_member (если такая роль существует) */
      const roleRow = await client.query(
        `SELECT id FROM saas.roles WHERE code = 'tenant_member' AND is_active = TRUE LIMIT 1`
      );

      if (roleRow.rows.length) {
        await client.query(
          `
            INSERT INTO saas.user_roles (user_id, role_id)
            VALUES ($1, $2)
            ON CONFLICT (user_id, role_id) DO NOTHING
          `,
          [user.id, roleRow.rows[0].id]
        );
      }

      await client.query("COMMIT");

      await logAction({
        req,
        actionCode: "users.create",
        entityId: user.id,
        entityLabel: user.username,
        tenantId,
        details: { role: user.role },
      });

      return res.status(201).json({
        ok: true,
        user,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[POST /users] error:", err);
      return res.status(500).json({
        ok: false,
        error: "user_create_failed",
        message: "Не удалось создать пользователя",
      });
    } finally {
      client.release();
    }
  }
);

/* ══════════════════════════════════════════════════════════════════════════
   PUT /users/:id
   Редактирование пользователя внутри tenant.
   - Можно изменить: full_name
   - Нельзя: сменить tenant, назначить owner, редактировать чужих
   RBAC: users.update
══════════════════════════════════════════════════════════════════════════ */

router.put(
  "/:id",
  authRequired,
  requirePermission("users.update"),
  requireActiveWriteSubscription(),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
          message: "Не удалось определить tenant",
        });
      }

      const userId = parseIntOrNull(req.params.id);

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: "user_id_invalid",
          message: "Некорректный user_id",
        });
      }

      /* Загружаем пользователя только внутри своего tenant */
      const current = await getUserInTenant(userId, tenantId);

      if (!current) {
        return res.status(404).json({
          ok: false,
          error: "user_not_found",
          message: "Пользователь не найден",
        });
      }

      /* Нельзя редактировать owner */
      if (current.role === "owner") {
        return res.status(403).json({
          ok: false,
          error: "cannot_edit_owner",
          message: "Нельзя редактировать пользователя с ролью owner",
        });
      }

      const fullName = normalizeText(req.body.full_name, current.full_name);

      if (!fullName) {
        return res.status(400).json({
          ok: false,
          error: "full_name_required",
          message: "Имя обязательно",
        });
      }

      const { rows } = await pool.query(
        `
          UPDATE saas.users
          SET
            full_name = $1,
            updated_at = NOW()
          WHERE id = $2
            AND tenant_id = $3
          RETURNING
            id,
            username,
            full_name,
            role,
            tenant_id,
            email,
            phone,
            is_active,
            is_blocked,
            last_login_at,
            created_at,
            updated_at
        `,
        [fullName, userId, tenantId]
      );

      const user = rows[0];

      await logAction({
        req,
        actionCode: "users.update",
        entityId: user.id,
        entityLabel: user.username,
        tenantId,
        details: {
          before_full_name: current.full_name,
          after_full_name: user.full_name,
        },
      });

      return res.json({
        ok: true,
        user,
      });
    } catch (err) {
      console.error("[PUT /users/:id] error:", err);
      return res.status(500).json({
        ok: false,
        error: "user_update_failed",
        message: "Не удалось обновить пользователя",
      });
    }
  }
);

/* ══════════════════════════════════════════════════════════════════════════
   PATCH /users/:id/toggle-active
   Вкл/выкл пользователя внутри tenant.
   - Нельзя отключить себя
   - Нельзя трогать owner
   RBAC: users.block (переиспользуем для вкл/выкл)
══════════════════════════════════════════════════════════════════════════ */

router.patch(
  "/:id/toggle-active",
  authRequired,
  requirePermission("users.block"),
  requireActiveWriteSubscription(),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
          message: "Не удалось определить tenant",
        });
      }

      const userId = parseIntOrNull(req.params.id);

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: "user_id_invalid",
          message: "Некорректный user_id",
        });
      }

      /* Нельзя отключить себя */
      if (req.user && String(req.user.id) === String(userId)) {
        return res.status(403).json({
          ok: false,
          error: "cannot_deactivate_self",
          message: "Нельзя отключить собственную учётную запись",
        });
      }

      const current = await getUserInTenant(userId, tenantId);

      if (!current) {
        return res.status(404).json({
          ok: false,
          error: "user_not_found",
          message: "Пользователь не найден",
        });
      }

      /* Нельзя трогать owner */
      if (current.role === "owner") {
        return res.status(403).json({
          ok: false,
          error: "cannot_modify_owner",
          message: "Нельзя изменять пользователя с ролью owner",
        });
      }

      const { rows } = await pool.query(
        `
          UPDATE saas.users
          SET
            is_active = NOT is_active,
            updated_at = NOW()
          WHERE id = $1
            AND tenant_id = $2
          RETURNING
            id,
            username,
            full_name,
            role,
            tenant_id,
            email,
            phone,
            is_active,
            is_blocked,
            last_login_at,
            created_at,
            updated_at
        `,
        [userId, tenantId]
      );

      const user = rows[0];

      await logAction({
        req,
        actionCode: "users.toggle_active",
        entityId: user.id,
        entityLabel: user.username,
        tenantId,
        details: {
          before_is_active: current.is_active,
          after_is_active: user.is_active,
        },
      });

      return res.json({
        ok: true,
        user,
      });
    } catch (err) {
      console.error("[PATCH /users/:id/toggle-active] error:", err);
      return res.status(500).json({
        ok: false,
        error: "user_toggle_active_failed",
        message: "Не удалось изменить активность пользователя",
      });
    }
  }
);

/* ══════════════════════════════════════════════════════════════════════════
   PATCH /users/:id/toggle-block
   Блокировка/разблокировка пользователя внутри tenant.
   - Нельзя заблокировать себя
   - Нельзя трогать owner
   RBAC: users.block
══════════════════════════════════════════════════════════════════════════ */

router.patch(
  "/:id/toggle-block",
  authRequired,
  requirePermission("users.block"),
  requireActiveWriteSubscription(),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
          message: "Не удалось определить tenant",
        });
      }

      const userId = parseIntOrNull(req.params.id);

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: "user_id_invalid",
          message: "Некорректный user_id",
        });
      }

      /* Нельзя заблокировать себя */
      if (req.user && String(req.user.id) === String(userId)) {
        return res.status(403).json({
          ok: false,
          error: "cannot_block_self",
          message: "Нельзя заблокировать собственную учётную запись",
        });
      }

      const current = await getUserInTenant(userId, tenantId);

      if (!current) {
        return res.status(404).json({
          ok: false,
          error: "user_not_found",
          message: "Пользователь не найден",
        });
      }

      /* Нельзя трогать owner */
      if (current.role === "owner") {
        return res.status(403).json({
          ok: false,
          error: "cannot_modify_owner",
          message: "Нельзя изменять пользователя с ролью owner",
        });
      }

      const { rows } = await pool.query(
        `
          UPDATE saas.users
          SET
            is_blocked = NOT is_blocked,
            updated_at = NOW()
          WHERE id = $1
            AND tenant_id = $2
          RETURNING
            id,
            username,
            full_name,
            role,
            tenant_id,
            email,
            phone,
            is_active,
            is_blocked,
            last_login_at,
            created_at,
            updated_at
        `,
        [userId, tenantId]
      );

      const user = rows[0];

      await logAction({
        req,
        actionCode: "users.toggle_block",
        entityId: user.id,
        entityLabel: user.username,
        tenantId,
        details: {
          before_is_blocked: current.is_blocked,
          after_is_blocked: user.is_blocked,
        },
      });

      return res.json({
        ok: true,
        user,
      });
    } catch (err) {
      console.error("[PATCH /users/:id/toggle-block] error:", err);
      return res.status(500).json({
        ok: false,
        error: "user_toggle_block_failed",
        message: "Не удалось изменить блокировку пользователя",
      });
    }
  }
);

/* ══════════════════════════════════════════════════════════════════════════
   POST /users/:id/reset-password
   Сброс пароля пользователя внутри tenant.
   - Хэшируем новый пароль через bcrypt
   - Нельзя трогать owner
   RBAC: users.reset_password
══════════════════════════════════════════════════════════════════════════ */

router.post(
  "/:id/reset-password",
  authRequired,
  requirePermission("users.reset_password"),
  requireActiveWriteSubscription(),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
          message: "Не удалось определить tenant",
        });
      }

      const userId = parseIntOrNull(req.params.id);

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: "user_id_invalid",
          message: "Некорректный user_id",
        });
      }

      const newPassword = normalizeText(req.body.password);

      if (!newPassword) {
        return res.status(400).json({
          ok: false,
          error: "password_required",
          message: "Новый пароль обязателен",
        });
      }

      const current = await getUserInTenant(userId, tenantId);

      if (!current) {
        return res.status(404).json({
          ok: false,
          error: "user_not_found",
          message: "Пользователь не найден",
        });
      }

      /* Нельзя менять пароль owner */
      if (current.role === "owner") {
        return res.status(403).json({
          ok: false,
          error: "cannot_modify_owner",
          message: "Нельзя изменять пароль пользователя с ролью owner",
        });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);

      await pool.query(
        `
          UPDATE saas.users
          SET
            password_hash = $1,
            updated_at = NOW()
          WHERE id = $2
            AND tenant_id = $3
        `,
        [passwordHash, userId, tenantId]
      );

      await logAction({
        req,
        actionCode: "users.reset_password",
        entityId: current.id,
        entityLabel: current.username,
        tenantId,
        details: {
          reset_by: req.user?.username || null,
        },
      });

      return res.json({
        ok: true,
        message: "Пароль обновлён",
      });
    } catch (err) {
      console.error("[POST /users/:id/reset-password] error:", err);
      return res.status(500).json({
        ok: false,
        error: "user_reset_password_failed",
        message: "Не удалось сбросить пароль",
      });
    }
  }
);

module.exports = router;
