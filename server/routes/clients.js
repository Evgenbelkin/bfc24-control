const express = require("express");
const pool = require("../db");
const {
  authRequired,
  requireRole,
  getEffectiveTenantId,
} = require("../middleware/auth");

const router = express.Router();

function normalizeOptionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function normalizeBoolean(value, defaultValue = true) {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;

  const raw = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;

  return defaultValue;
}

async function checkClientDuplicate({ tenantId, name, phone, excludeId = null }) {
  if (!name) {
    return { ok: true };
  }

  const params = [tenantId, name.toLowerCase()];
  let sql = `
    SELECT
      id,
      name,
      phone
    FROM core.counterparties
    WHERE tenant_id = $1
      AND LOWER(name) = $2
  `;

  if (phone) {
    params.push(phone);
    sql += ` AND COALESCE(phone, '') = $3`;
  } else {
    sql += ` AND (phone IS NULL OR phone = '')`;
  }

  if (excludeId) {
    params.push(excludeId);
    sql += ` AND id <> $${params.length}`;
  }

  sql += ` LIMIT 1`;

  const { rows } = await pool.query(sql, params);

  if (rows.length) {
    return {
      ok: false,
      error: "client_already_exists",
    };
  }

  return { ok: true };
}

router.get("/", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const search = String(req.query.search || "").trim();

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    const params = [tenantId];
    let whereSql = `WHERE c.tenant_id = $1`;

    if (search) {
      params.push(`%${search}%`);
      whereSql += ` AND (
        c.name ILIKE $${params.length}
        OR COALESCE(c.phone, '') ILIKE $${params.length}
      )`;
    }

    const sql = `
      SELECT
        c.id,
        c.tenant_id,
        c.name,
        c.phone,
        c.comment,
        c.is_active,
        c.created_at,
        c.updated_at
      FROM core.counterparties c
      ${whereSql}
      ORDER BY c.id DESC
    `;

    const { rows } = await pool.query(sql, params);

    return res.json({
      ok: true,
      clients: rows,
    });
  } catch (e) {
    console.error("[GET /clients] error:", e);
    return res.status(500).json({
      ok: false,
      error: "clients_list_failed",
      details: e.message,
    });
  }
});

router.get("/:id", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const clientId = Number(req.params.id);

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "invalid_client_id",
      });
    }

    const sql = `
      SELECT
        c.id,
        c.tenant_id,
        c.name,
        c.phone,
        c.comment,
        c.is_active,
        c.created_at,
        c.updated_at
      FROM core.counterparties c
      WHERE c.id = $1
        AND c.tenant_id = $2
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [clientId, tenantId]);

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        error: "client_not_found",
      });
    }

    return res.json({
      ok: true,
      client: rows[0],
    });
  } catch (e) {
    console.error("[GET /clients/:id] error:", e);
    return res.status(500).json({
      ok: false,
      error: "client_read_failed",
      details: e.message,
    });
  }
});

router.post(
  "/",
  authRequired,
  requireRole("owner", "admin", "client_owner", "client_manager"),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      const name = String(req.body.name || "").trim();
      const phone = normalizeOptionalText(req.body.phone);
      const comment = normalizeOptionalText(req.body.comment);
      const isActive = normalizeBoolean(req.body.is_active, true);

      if (!name) {
        return res.status(400).json({
          ok: false,
          error: "name_required",
        });
      }

      const duplicateCheck = await checkClientDuplicate({
        tenantId,
        name,
        phone,
      });

      if (!duplicateCheck.ok) {
        return res.status(409).json({
          ok: false,
          error: duplicateCheck.error,
        });
      }

      const sql = `
        INSERT INTO core.counterparties
        (
          tenant_id,
          name,
          phone,
          comment,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          tenant_id,
          name,
          phone,
          comment,
          is_active,
          created_at,
          updated_at
      `;

      const { rows } = await pool.query(sql, [
        tenantId,
        name,
        phone,
        comment,
        isActive,
      ]);

      return res.status(201).json({
        ok: true,
        client: rows[0],
      });
    } catch (e) {
      console.error("[POST /clients] error:", e);
      return res.status(500).json({
        ok: false,
        error: "client_create_failed",
        details: e.message,
      });
    }
  }
);

router.put(
  "/:id",
  authRequired,
  requireRole("owner", "admin", "client_owner", "client_manager"),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);
      const clientId = Number(req.params.id);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      if (!Number.isFinite(clientId) || clientId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_client_id",
        });
      }

      const existsSql = `
        SELECT id
        FROM core.counterparties
        WHERE id = $1
          AND tenant_id = $2
        LIMIT 1
      `;
      const existsResult = await pool.query(existsSql, [clientId, tenantId]);

      if (!existsResult.rows.length) {
        return res.status(404).json({
          ok: false,
          error: "client_not_found",
        });
      }

      const name = String(req.body.name || "").trim();
      const phone = normalizeOptionalText(req.body.phone);
      const comment = normalizeOptionalText(req.body.comment);
      const isActive = normalizeBoolean(req.body.is_active, true);

      if (!name) {
        return res.status(400).json({
          ok: false,
          error: "name_required",
        });
      }

      const duplicateCheck = await checkClientDuplicate({
        tenantId,
        name,
        phone,
        excludeId: clientId,
      });

      if (!duplicateCheck.ok) {
        return res.status(409).json({
          ok: false,
          error: duplicateCheck.error,
        });
      }

      const sql = `
        UPDATE core.counterparties
        SET
          name = $1,
          phone = $2,
          comment = $3,
          is_active = $4,
          updated_at = NOW()
        WHERE id = $5
          AND tenant_id = $6
        RETURNING
          id,
          tenant_id,
          name,
          phone,
          comment,
          is_active,
          created_at,
          updated_at
      `;

      const { rows } = await pool.query(sql, [
        name,
        phone,
        comment,
        isActive,
        clientId,
        tenantId,
      ]);

      return res.json({
        ok: true,
        client: rows[0],
      });
    } catch (e) {
      console.error("[PUT /clients/:id] error:", e);
      return res.status(500).json({
        ok: false,
        error: "client_update_failed",
        details: e.message,
      });
    }
  }
);

router.patch(
  "/:id/toggle",
  authRequired,
  requireRole("owner", "admin", "client_owner", "client_manager", "client"),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);
      const clientId = Number(req.params.id);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      if (!Number.isFinite(clientId) || clientId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_client_id",
        });
      }

      const sql = `
        UPDATE core.counterparties
        SET
          is_active = NOT is_active,
          updated_at = NOW()
        WHERE id = $1
          AND tenant_id = $2
        RETURNING
          id,
          tenant_id,
          name,
          phone,
          comment,
          is_active,
          created_at,
          updated_at
      `;

      const { rows } = await pool.query(sql, [clientId, tenantId]);

      if (!rows.length) {
        return res.status(404).json({
          ok: false,
          error: "client_not_found",
        });
      }

      return res.json({
        ok: true,
        client: rows[0],
      });
    } catch (e) {
      console.error("[PATCH /clients/:id/toggle] error:", e);
      return res.status(500).json({
        ok: false,
        error: "client_toggle_failed",
        details: e.message,
      });
    }
  }
);

module.exports = router;