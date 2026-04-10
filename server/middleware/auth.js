const jwt = require('jsonwebtoken');
const pool = require('../db');

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (!authHeader) return null;

  const parts = String(authHeader).split(' ');
  if (parts.length !== 2) return null;

  const [scheme, token] = parts;
  if (!/^Bearer$/i.test(scheme)) return null;

  return token || null;
}

async function loadUserAccess(userId) {
  if (!userId) {
    return {
      roles: [],
      permissions: [],
    };
  }

  const [rolesResult, permissionsResult] = await Promise.all([
    pool.query(
      `
        SELECT r.code
        FROM saas.user_roles ur
        JOIN saas.roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND r.is_active = TRUE
        ORDER BY r.code
      `,
      [userId]
    ),
    pool.query(
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
    ),
  ]);

  return {
    roles: rolesResult.rows.map((row) => row.code),
    permissions: permissionsResult.rows.map((row) => row.code),
  };
}

async function loadUserForAuth(userId) {
  const { rows } = await pool.query(
    `
      SELECT
        u.id,
        u.username,
        u.full_name,
        u.role,
        u.tenant_id,
        u.is_active,
        u.is_blocked,
        u.last_login_at,
        u.email,
        u.phone,
        t.name AS tenant_name,
        t.is_active AS tenant_is_active,
        t.is_blocked AS tenant_is_blocked,
        t.subscription_status,
        t.subscription_start_at,
        t.subscription_end_at
      FROM saas.users u
      LEFT JOIN saas.tenants t
        ON t.id = u.tenant_id
      WHERE u.id = $1
      LIMIT 1
    `,
    [userId]
  );

  return rows[0] || null;
}

function getEffectiveTenantId(req) {
  if (!req || !req.user) return null;

  // client / tenant user
  if (req.user.tenant_id) {
    return Number(req.user.tenant_id);
  }

  // owner mode
  const fromQuery = req.query?.tenant_id;
  const fromBody = req.body?.tenant_id;
  const fromParams = req.params?.tenant_id;

  const candidate = fromQuery ?? fromBody ?? fromParams;

  if (candidate !== undefined && candidate !== null && candidate !== '') {
    const parsed = Number(candidate);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // legacy fallback for owner compatibility
  return 1;
}

function buildAuthError(res, status, error, message, extra = {}) {
  return res.status(status).json({
    ok: false,
    error,
    message,
    ...extra,
  });
}

function authRequired(req, res, next) {
  (async () => {
    try {
      const token = getTokenFromRequest(req);
      if (!token) {
        return buildAuthError(res, 401, 'auth_required', 'Требуется авторизация');
      }

      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        return buildAuthError(
          res,
          500,
          'jwt_secret_missing',
          'Не настроен JWT_SECRET'
        );
      }

      let payload;
      try {
        payload = jwt.verify(token, jwtSecret);
      } catch (error) {
        return buildAuthError(res, 401, 'invalid_token', 'Недействительный токен');
      }

      const userId = payload.id;
      if (!userId) {
        return buildAuthError(res, 401, 'invalid_token_payload', 'Некорректный токен');
      }

      const user = await loadUserForAuth(userId);
      if (!user) {
        return buildAuthError(res, 401, 'user_not_found', 'Пользователь не найден');
      }

      if (!user.is_active) {
        return buildAuthError(
          res,
          403,
          'user_is_inactive',
          'Пользователь отключён'
        );
      }

      if (user.is_blocked) {
        return buildAuthError(
          res,
          403,
          'user_is_blocked',
          'Пользователь заблокирован'
        );
      }

      // tenant checks apply only to tenant users
      if (user.tenant_id) {
        if (user.tenant_is_active === false) {
          return buildAuthError(
            res,
            403,
            'tenant_is_inactive',
            'Клиент отключён'
          );
        }

        if (user.tenant_is_blocked === true) {
          return buildAuthError(
            res,
            403,
            'tenant_is_blocked',
            'Клиент заблокирован'
          );
        }

        if (user.subscription_status === 'blocked') {
          return buildAuthError(
            res,
            403,
            'subscription_blocked',
            'Подписка заблокирована'
          );
        }

        if (user.subscription_status === 'expired') {
          return buildAuthError(
            res,
            403,
            'subscription_expired',
            'Срок подписки истёк'
          );
        }

        if (
          user.subscription_end_at &&
          new Date(user.subscription_end_at) < new Date() &&
          user.subscription_status !== 'trial'
        ) {
          return buildAuthError(
            res,
            403,
            'subscription_expired_by_date',
            'Срок подписки истёк'
          );
        }
      }

      const access = await loadUserAccess(user.id);

      req.user = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role, // legacy compatibility
        tenant_id: user.tenant_id,
        tenant_name: user.tenant_name || null,
        is_active: user.is_active,
        is_blocked: user.is_blocked,
        last_login_at: user.last_login_at,
        email: user.email || null,
        phone: user.phone || null,
        subscription_status: user.subscription_status || null,
        subscription_start_at: user.subscription_start_at || null,
        subscription_end_at: user.subscription_end_at || null,
        rbac_roles: access.roles,
        permissions: access.permissions,
        token_payload: payload,
      };

      req.user.hasRoleCode = (roleCode) =>
        Array.isArray(req.user.rbac_roles) && req.user.rbac_roles.includes(roleCode);

      req.user.hasPermission = (permissionCode) =>
        Array.isArray(req.user.permissions) &&
        req.user.permissions.includes(permissionCode);

      req.user.hasAnyPermission = (permissionCodes = []) =>
        Array.isArray(permissionCodes) &&
        permissionCodes.some((code) => req.user.permissions.includes(code));

      return next();
    } catch (error) {
      console.error('[authRequired] error:', error);
      return buildAuthError(
        res,
        500,
        'auth_middleware_failed',
        'Ошибка проверки авторизации'
      );
    }
  })();
}

function normalizeAllowedRoles(args) {
  const flat = args.flatMap((item) => {
    if (Array.isArray(item)) return item;
    return [item];
  });

  return flat
    .map((role) => String(role || '').trim())
    .filter(Boolean);
}

function requireRole(...allowedRoles) {
  const roles = normalizeAllowedRoles(allowedRoles);

  return (req, res, next) => {
    if (!req.user) {
      return buildAuthError(res, 401, 'auth_required', 'Требуется авторизация');
    }

    if (!roles.length) {
      return buildAuthError(
        res,
        500,
        'roles_not_configured',
        'Не настроен список допустимых ролей'
      );
    }

    const legacyRole = req.user.role;
    const rbacRoles = Array.isArray(req.user.rbac_roles) ? req.user.rbac_roles : [];

    const allowed = roles.some(
      (roleCode) => legacyRole === roleCode || rbacRoles.includes(roleCode)
    );

    if (!allowed) {
      return buildAuthError(
        res,
        403,
        'role_denied',
        'Недостаточно прав по роли',
        {
          required_roles: roles,
          current_role: legacyRole,
          current_rbac_roles: rbacRoles,
        }
      );
    }

    return next();
  };
}

module.exports = {
  authRequired,
  requireRole,
  getEffectiveTenantId,
};