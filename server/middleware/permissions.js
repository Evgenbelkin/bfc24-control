const pool = require('../db');

async function getUserRoles(userId) {
  if (!userId) return [];

  const { rows } = await pool.query(
    `
      SELECT r.code
      FROM saas.user_roles ur
      JOIN saas.roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
        AND r.is_active = TRUE
      ORDER BY r.code
    `,
    [userId]
  );

  return rows.map((row) => row.code);
}

async function getUserPermissions(userId) {
  if (!userId) return [];

  const { rows } = await pool.query(
    `
      SELECT DISTINCT p.code
      FROM saas.user_roles ur
      JOIN saas.roles r
        ON r.id = ur.role_id
      JOIN saas.role_permissions rp
        ON rp.role_id = r.id
      JOIN saas.permissions p
        ON p.id = rp.permission_id
      WHERE ur.user_id = $1
        AND r.is_active = TRUE
      ORDER BY p.code
    `,
    [userId]
  );

  return rows.map((row) => row.code);
}

async function enrichUserAccess(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next();
    }

    const [roles, permissions] = await Promise.all([
      getUserRoles(req.user.id),
      getUserPermissions(req.user.id),
    ]);

    req.user.rbac_roles = roles;
    req.user.permissions = permissions;
    req.user.hasPermission = (permissionCode) => permissions.includes(permissionCode);
    req.user.hasAnyPermission = (permissionCodes = []) =>
      permissionCodes.some((code) => permissions.includes(code));
    req.user.hasRoleCode = (roleCode) => roles.includes(roleCode);

    return next();
  } catch (error) {
    console.error('[permissions.enrichUserAccess] error:', error);
    return res.status(500).json({
      ok: false,
      error: 'permissions_load_failed',
      message: 'Не удалось загрузить права пользователя',
    });
  }
}

function requirePermission(permissionCode) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          ok: false,
          error: 'auth_required',
          message: 'Требуется авторизация',
        });
      }

      // legacy owner bypass
      if (req.user.role === 'owner') {
        return next();
      }

      if (!req.user.permissions) {
        const permissions = await getUserPermissions(req.user.id);
        req.user.permissions = permissions;
      }

      if (req.user.permissions.includes(permissionCode)) {
        return next();
      }

      return res.status(403).json({
        ok: false,
        error: 'permission_denied',
        message: 'Недостаточно прав',
        required_permission: permissionCode,
      });
    } catch (error) {
      console.error('[permissions.requirePermission] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'permission_check_failed',
        message: 'Не удалось проверить права доступа',
      });
    }
  };
}

function requireAnyPermission(permissionCodes = []) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          ok: false,
          error: 'auth_required',
          message: 'Требуется авторизация',
        });
      }

      // legacy owner bypass
      if (req.user.role === 'owner') {
        return next();
      }

      if (!Array.isArray(permissionCodes) || permissionCodes.length === 0) {
        return res.status(500).json({
          ok: false,
          error: 'permission_config_invalid',
          message: 'Некорректная конфигурация проверки прав',
        });
      }

      if (!req.user.permissions) {
        const permissions = await getUserPermissions(req.user.id);
        req.user.permissions = permissions;
      }

      const allowed = permissionCodes.some((code) =>
        req.user.permissions.includes(code)
      );

      if (allowed) {
        return next();
      }

      return res.status(403).json({
        ok: false,
        error: 'permission_denied',
        message: 'Недостаточно прав',
        required_any_of: permissionCodes,
      });
    } catch (error) {
      console.error('[permissions.requireAnyPermission] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'permission_check_failed',
        message: 'Не удалось проверить права доступа',
      });
    }
  };
}

async function getTenantLimits(tenantId) {
  if (!tenantId) return null;

  const { rows } = await pool.query(
    `
      SELECT
        t.id,
        t.name,
        t.max_users,
        t.max_sku,
        t.max_locations,
        t.enabled_modules,
        t.subscription_status,
        t.subscription_start_at,
        t.subscription_end_at,
        t.tariff_id,
        tr.code AS tariff_code,
        tr.name AS tariff_name,
        tr.max_users AS tariff_max_users,
        tr.max_items AS tariff_max_items,
        tr.max_locations AS tariff_max_locations,
        tr.enabled_modules AS tariff_enabled_modules
      FROM saas.tenants t
      LEFT JOIN saas.tariffs tr
        ON tr.id = t.tariff_id
      WHERE t.id = $1
      LIMIT 1
    `,
    [tenantId]
  );

  return rows[0] || null;
}

function requireModuleEnabled(moduleCode) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          ok: false,
          error: 'auth_required',
          message: 'Требуется авторизация',
        });
      }

      if (req.user.role === 'owner') {
        return next();
      }

      const tenantId = req.user.tenant_id;
      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: 'tenant_id_required',
          message: 'Не удалось определить tenant',
        });
      }

      const limits = await getTenantLimits(tenantId);
      if (!limits) {
        return res.status(404).json({
          ok: false,
          error: 'tenant_not_found',
          message: 'Tenant не найден',
        });
      }

      const tenantModules = Array.isArray(limits.enabled_modules)
        ? limits.enabled_modules
        : [];

      const tariffModules = Array.isArray(limits.tariff_enabled_modules)
        ? limits.tariff_enabled_modules
        : [];

      const effectiveModules =
        tenantModules.length > 0 ? tenantModules : tariffModules;

      if (effectiveModules.includes(moduleCode)) {
        req.tenantLimits = limits;
        return next();
      }

      return res.status(403).json({
        ok: false,
        error: 'module_disabled',
        message: 'Модуль недоступен по тарифу',
        module: moduleCode,
      });
    } catch (error) {
      console.error('[permissions.requireModuleEnabled] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'module_check_failed',
        message: 'Не удалось проверить доступность модуля',
      });
    }
  };
}

function requireActiveWriteSubscription() {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          ok: false,
          error: 'auth_required',
          message: 'Требуется авторизация',
        });
      }

      if (req.user.role === 'owner') {
        return next();
      }

      const method = String(req.method || 'GET').toUpperCase();
      const readMethods = ['GET', 'HEAD', 'OPTIONS'];

      if (readMethods.includes(method)) {
        return next();
      }

      const tenantId = req.user.tenant_id;
      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: 'tenant_id_required',
          message: 'Не удалось определить tenant',
        });
      }

      const limits = await getTenantLimits(tenantId);
      if (!limits) {
        return res.status(404).json({
          ok: false,
          error: 'tenant_not_found',
          message: 'Tenant не найден',
        });
      }

      const subscriptionStatus = limits.subscription_status;
      const subscriptionEndAt = limits.subscription_end_at
        ? new Date(limits.subscription_end_at)
        : null;

      if (subscriptionStatus === 'active') {
        req.tenantLimits = limits;
        return next();
      }

      if (subscriptionStatus === 'trial') {
        if (!subscriptionEndAt || subscriptionEndAt >= new Date()) {
          req.tenantLimits = limits;
          return next();
        }

        return res.status(403).json({
          ok: false,
          error: 'trial_expired_write_blocked',
          message: 'Пробный период истёк. Запись данных запрещена до продления подписки',
        });
      }

      return res.status(403).json({
        ok: false,
        error: 'subscription_inactive',
        message: 'Подписка не позволяет изменять данные',
        subscription_status: subscriptionStatus,
      });
    } catch (error) {
      console.error('[permissions.requireActiveWriteSubscription] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'subscription_check_failed',
        message: 'Не удалось проверить статус подписки',
      });
    }
  };
}

async function checkTenantUserLimit(tenantId) {
  const limits = await getTenantLimits(tenantId);
  if (!limits) {
    return {
      ok: false,
      error: 'tenant_not_found',
      message: 'Tenant не найден',
    };
  }

  const maxUsers =
    Number.isInteger(limits.max_users) && limits.max_users >= 0
      ? limits.max_users
      : Number.isInteger(limits.tariff_max_users)
      ? limits.tariff_max_users
      : 0;

  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM saas.users
      WHERE tenant_id = $1
        AND is_active = TRUE
    `,
    [tenantId]
  );

  const currentUsers = countResult.rows[0]?.total || 0;

  if (currentUsers >= maxUsers) {
    return {
      ok: false,
      error: 'users_limit_exceeded',
      message: 'Достигнут лимит пользователей по тарифу',
      current: currentUsers,
      limit: maxUsers,
    };
  }

  return {
    ok: true,
    current: currentUsers,
    limit: maxUsers,
    tenant: limits,
  };
}

async function checkTenantItemLimit(tenantId) {
  const limits = await getTenantLimits(tenantId);
  if (!limits) {
    return {
      ok: false,
      error: 'tenant_not_found',
      message: 'Tenant не найден',
    };
  }

  const maxItems =
    Number.isInteger(limits.max_sku) && limits.max_sku >= 0
      ? limits.max_sku
      : Number.isInteger(limits.tariff_max_items)
      ? limits.tariff_max_items
      : 0;

  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM core.items
      WHERE tenant_id = $1
        AND COALESCE(is_active, TRUE) = TRUE
    `,
    [tenantId]
  );

  const currentItems = countResult.rows[0]?.total || 0;

  if (currentItems >= maxItems) {
    return {
      ok: false,
      error: 'items_limit_exceeded',
      message: 'Достигнут лимит товаров по тарифу',
      current: currentItems,
      limit: maxItems,
    };
  }

  return {
    ok: true,
    current: currentItems,
    limit: maxItems,
    tenant: limits,
  };
}

async function checkTenantLocationLimit(tenantId) {
  const limits = await getTenantLimits(tenantId);
  if (!limits) {
    return {
      ok: false,
      error: 'tenant_not_found',
      message: 'Tenant не найден',
    };
  }

  const maxLocations =
    Number.isInteger(limits.max_locations) && limits.max_locations >= 0
      ? limits.max_locations
      : Number.isInteger(limits.tariff_max_locations)
      ? limits.tariff_max_locations
      : 0;

  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM core.locations
      WHERE tenant_id = $1
        AND COALESCE(is_active, TRUE) = TRUE
    `,
    [tenantId]
  );

  const currentLocations = countResult.rows[0]?.total || 0;

  if (currentLocations >= maxLocations) {
    return {
      ok: false,
      error: 'locations_limit_exceeded',
      message: 'Достигнут лимит мест хранения по тарифу',
      current: currentLocations,
      limit: maxLocations,
    };
  }

  return {
    ok: true,
    current: currentLocations,
    limit: maxLocations,
    tenant: limits,
  };
}

module.exports = {
  getUserRoles,
  getUserPermissions,
  enrichUserAccess,
  requirePermission,
  requireAnyPermission,
  getTenantLimits,
  requireModuleEnabled,
  requireActiveWriteSubscription,
  checkTenantUserLimit,
  checkTenantItemLimit,
  checkTenantLocationLimit,
};