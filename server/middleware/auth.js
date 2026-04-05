const jwt = require("jsonwebtoken");
const pool = require("../db");

if (!process.env.JWT_SECRET || !String(process.env.JWT_SECRET).trim()) {
  throw new Error("JWT_SECRET is required");
}

const JWT_SECRET = process.env.JWT_SECRET;

function extractToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}

function normalizeRolesInput(rolesInput) {
  if (rolesInput.length === 1 && Array.isArray(rolesInput[0])) {
    return rolesInput[0].map(String);
  }
  return rolesInput.map(String);
}

async function loadUserWithTenant(userId) {
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.tenant_id,
      u.full_name,
      u.username,
      u.role,
      u.is_active AS user_is_active,
      u.is_blocked AS user_is_blocked,
      t.name AS tenant_name,
      t.is_active AS tenant_is_active,
      t.is_blocked AS tenant_is_blocked,
      t.subscription_status,
      t.subscription_end_at
    FROM saas.users u
    LEFT JOIN saas.tenants t ON t.id = u.tenant_id
    WHERE u.id = $1
    LIMIT 1
    `,
    [userId]
  );

  return rows[0] || null;
}

function isSubscriptionExpired(subscriptionEndAt) {
  if (!subscriptionEndAt) return false;
  const end = new Date(subscriptionEndAt);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < Date.now();
}

/**
 * Возвращает tenant_id, с которым должен работать запрос.
 *
 * Логика:
 * 1. client -> всегда свой tenant_id
 * 2. owner -> только явный tenant_id из query/body/params
 * 3. никакого fallback = 1
 */
function getEffectiveTenantId(req) {
  if (!req || !req.user) return null;

  if (req.user.role === "client") {
    return req.user.tenant_id ? Number(req.user.tenant_id) : null;
  }

  const candidates = [
    req.query?.tenant_id,
    req.body?.tenant_id,
    req.params?.tenant_id,
  ];

  for (const value of candidates) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return null;
}

async function authRequired(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ ok: false, error: "invalid_token" });
    }

    const dbUser = await loadUserWithTenant(decoded.id);
    if (!dbUser) {
      return res.status(401).json({ ok: false, error: "user_not_found" });
    }

    if (!dbUser.user_is_active) {
      return res.status(403).json({ ok: false, error: "user_inactive" });
    }

    if (dbUser.user_is_blocked) {
      return res.status(403).json({ ok: false, error: "user_blocked" });
    }

    if (dbUser.role !== "owner") {
      if (!dbUser.tenant_id) {
        return res.status(403).json({ ok: false, error: "tenant_required" });
      }

      if (!dbUser.tenant_name) {
        return res.status(403).json({ ok: false, error: "tenant_not_found" });
      }

      if (!dbUser.tenant_is_active) {
        return res.status(403).json({ ok: false, error: "tenant_inactive" });
      }

      if (dbUser.tenant_is_blocked) {
        return res.status(403).json({ ok: false, error: "tenant_blocked" });
      }

      if (dbUser.subscription_status === "blocked") {
        return res.status(403).json({ ok: false, error: "subscription_blocked" });
      }

      if (dbUser.subscription_status === "expired") {
        return res.status(403).json({ ok: false, error: "subscription_expired" });
      }

      if (isSubscriptionExpired(dbUser.subscription_end_at)) {
        return res.status(403).json({ ok: false, error: "subscription_expired" });
      }
    }

    req.user = {
      id: String(dbUser.id),
      tenant_id: dbUser.tenant_id != null ? String(dbUser.tenant_id) : null,
      full_name: dbUser.full_name,
      username: dbUser.username,
      role: dbUser.role,
      company_name: dbUser.tenant_name || null,
    };

    req.tenant = dbUser.tenant_id
      ? {
          id: String(dbUser.tenant_id),
          name: dbUser.tenant_name,
          subscription_status: dbUser.subscription_status,
          subscription_end_at: dbUser.subscription_end_at,
        }
      : null;

    next();
  } catch (error) {
    console.error("[authRequired] error:", error);
    return res.status(500).json({ ok: false, error: "internal_server_error" });
  }
}

function requireRole(...rolesInput) {
  const roles = normalizeRolesInput(rolesInput);

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    next();
  };
}

module.exports = {
  authRequired,
  requireRole,
  getEffectiveTenantId,
};