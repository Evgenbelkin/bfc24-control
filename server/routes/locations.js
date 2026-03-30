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

async function checkLocationCodeDuplicate({
  tenantId,
  code,
  excludeId = null,
}) {
  if (!code) {
    return { ok: true };
  }

  const params = [tenantId, code.toLowerCase()];
  let sql = `
    SELECT id
    FROM core.locations
    WHERE tenant_id = $1
      AND LOWER(code) = $2
  `;

  if (excludeId) {
    params.push(excludeId);
    sql += ` AND id <> $3`;
  }

  sql += ` LIMIT 1`;

  const { rows } = await pool.query(sql, params);

  if (rows.length) {
    return {
      ok: false,
      error: "location_code_already_exists",
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
    let whereSql = `WHERE l.tenant_id = $1`;

    if (search) {
      params.push(`%${search}%`);
      whereSql += ` AND (
        l.name ILIKE $${params.length}
        OR COALESCE(l.code, '') ILIKE $${params.length}
        OR COALESCE(l.location_type, '') ILIKE $${params.length}
      )`;
    }

    const sql = `
      SELECT
        l.id,
        l.tenant_id,
        l.name,
        l.code,
        l.location_type,
        l.is_active,
        l.created_at,
        l.updated_at
      FROM core.locations l
      ${whereSql}
      ORDER BY l.id ASC
    `;

    const { rows } = await pool.query(sql, params);

    return res.json({
      ok: true,
      locations: rows,
    });
  } catch (e) {
    console.error("[GET /locations] error:", e);
    return res.status(500).json({
      ok: false,
      error: "locations_list_failed",
      details: e.message,
    });
  }
});

router.get("/:id", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const locationId = Number(req.params.id);

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    if (!Number.isFinite(locationId) || locationId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "invalid_location_id",
      });
    }

    const sql = `
      SELECT
        l.id,
        l.tenant_id,
        l.name,
        l.code,
        l.location_type,
        l.is_active,
        l.created_at,
        l.updated_at
      FROM core.locations l
      WHERE l.id = $1
        AND l.tenant_id = $2
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [locationId, tenantId]);

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        error: "location_not_found",
      });
    }

    return res.json({
      ok: true,
      location: rows[0],
    });
  } catch (e) {
    console.error("[GET /locations/:id] error:", e);
    return res.status(500).json({
      ok: false,
      error: "location_read_failed",
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
      const code = normalizeOptionalText(req.body.code);
      const locationType = normalizeOptionalText(req.body.location_type);
      const isActive = normalizeBoolean(req.body.is_active, true);

      if (!name) {
        return res.status(400).json({
          ok: false,
          error: "name_required",
        });
      }

      if (!code) {
        return res.status(400).json({
          ok: false,
          error: "code_required",
        });
      }

      if (!locationType) {
        return res.status(400).json({
          ok: false,
          error: "location_type_required",
        });
      }

      const duplicateCheck = await checkLocationCodeDuplicate({
        tenantId,
        code,
      });

      if (!duplicateCheck.ok) {
        return res.status(409).json({
          ok: false,
          error: duplicateCheck.error,
        });
      }

      const sql = `
        INSERT INTO core.locations
        (
          tenant_id,
          name,
          code,
          location_type,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          tenant_id,
          name,
          code,
          location_type,
          is_active,
          created_at,
          updated_at
      `;

      const { rows } = await pool.query(sql, [
        tenantId,
        name,
        code,
        locationType,
        isActive,
      ]);

      return res.status(201).json({
        ok: true,
        location: rows[0],
      });
    } catch (e) {
      console.error("[POST /locations] error:", e);
      return res.status(500).json({
        ok: false,
        error: "location_create_failed",
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
      const locationId = Number(req.params.id);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      if (!Number.isFinite(locationId) || locationId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_location_id",
        });
      }

      const existsSql = `
        SELECT id
        FROM core.locations
        WHERE id = $1
          AND tenant_id = $2
        LIMIT 1
      `;
      const existsResult = await pool.query(existsSql, [locationId, tenantId]);

      if (!existsResult.rows.length) {
        return res.status(404).json({
          ok: false,
          error: "location_not_found",
        });
      }

      const name = String(req.body.name || "").trim();
      const code = normalizeOptionalText(req.body.code);
      const locationType = normalizeOptionalText(req.body.location_type);
      const isActive = normalizeBoolean(req.body.is_active, true);

      if (!name) {
        return res.status(400).json({
          ok: false,
          error: "name_required",
        });
      }

      if (!code) {
        return res.status(400).json({
          ok: false,
          error: "code_required",
        });
      }

      if (!locationType) {
        return res.status(400).json({
          ok: false,
          error: "location_type_required",
        });
      }

      const duplicateCheck = await checkLocationCodeDuplicate({
        tenantId,
        code,
        excludeId: locationId,
      });

      if (!duplicateCheck.ok) {
        return res.status(409).json({
          ok: false,
          error: duplicateCheck.error,
        });
      }

      const sql = `
        UPDATE core.locations
        SET
          name = $1,
          code = $2,
          location_type = $3,
          is_active = $4,
          updated_at = NOW()
        WHERE id = $5
          AND tenant_id = $6
        RETURNING
          id,
          tenant_id,
          name,
          code,
          location_type,
          is_active,
          created_at,
          updated_at
      `;

      const { rows } = await pool.query(sql, [
        name,
        code,
        locationType,
        isActive,
        locationId,
        tenantId,
      ]);

      return res.json({
        ok: true,
        location: rows[0],
      });
    } catch (e) {
      console.error("[PUT /locations/:id] error:", e);
      return res.status(500).json({
        ok: false,
        error: "location_update_failed",
        details: e.message,
      });
    }
  }
);

router.patch(
  "/:id/toggle",
  authRequired,
  requireRole("owner", "admin", "client_owner", "client_manager"),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);
      const locationId = Number(req.params.id);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      if (!Number.isFinite(locationId) || locationId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_location_id",
        });
      }

      const sql = `
        UPDATE core.locations
        SET
          is_active = NOT is_active,
          updated_at = NOW()
        WHERE id = $1
          AND tenant_id = $2
        RETURNING
          id,
          tenant_id,
          name,
          code,
          location_type,
          is_active,
          created_at,
          updated_at
      `;

      const { rows } = await pool.query(sql, [locationId, tenantId]);

      if (!rows.length) {
        return res.status(404).json({
          ok: false,
          error: "location_not_found",
        });
      }

      return res.json({
        ok: true,
        location: rows[0],
      });
    } catch (e) {
      console.error("[PATCH /locations/:id/toggle] error:", e);
      return res.status(500).json({
        ok: false,
        error: "location_toggle_failed",
        details: e.message,
      });
    }
  }
);

module.exports = router;	