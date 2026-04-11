const express = require("express");
const pool = require("../db");
const {
  authRequired,
  requireRole,
  getEffectiveTenantId,
} = require("../middleware/auth");
const {
  requireActiveWriteSubscription,
  checkTenantItemLimit,
} = require("../middleware/permissions");

const router = express.Router();

function normalizeOptionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function normalizeBoolean(value, defaultValue = true) {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;

  const raw = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;

  return defaultValue;
}

function validateNonNegativeOptionalNumber(value, errorCode) {
  if (value === null) return { ok: true };
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, error: errorCode };
  }
  return { ok: true };
}

function computeVolumeCm3FromDimensions(lengthCm, widthCm, heightCm) {
  if (
    lengthCm === null || widthCm === null || heightCm === null ||
    !Number.isFinite(Number(lengthCm)) || !Number.isFinite(Number(widthCm)) || !Number.isFinite(Number(heightCm)) ||
    Number(lengthCm) <= 0 || Number(widthCm) <= 0 || Number(heightCm) <= 0
  ) {
    return null;
  }

  return Number(lengthCm) * Number(widthCm) * Number(heightCm);
}

async function checkItemDuplicates({ tenantId, sku, barcode, excludeId = null }) {
  if (sku) {
    const skuParams = [tenantId, sku];
    let skuSql = `
      SELECT id
      FROM core.items
      WHERE tenant_id = $1
        AND LOWER(sku) = LOWER($2)
    `;

    if (excludeId) {
      skuParams.push(excludeId);
      skuSql += ` AND id <> $3`;
    }

    skuSql += ` LIMIT 1`;

    const skuCheck = await pool.query(skuSql, skuParams);

    if (skuCheck.rows.length) {
      return {
        ok: false,
        error: "sku_already_exists",
      };
    }
  }

  if (barcode) {
    const barcodeParams = [tenantId, barcode];
    let barcodeSql = `
      SELECT id
      FROM core.items
      WHERE tenant_id = $1
        AND barcode = $2
    `;

    if (excludeId) {
      barcodeParams.push(excludeId);
      barcodeSql += ` AND id <> $3`;
    }

    barcodeSql += ` LIMIT 1`;

    const barcodeCheck = await pool.query(barcodeSql, barcodeParams);

    if (barcodeCheck.rows.length) {
      return {
        ok: false,
        error: "barcode_already_exists",
      };
    }
  }

  return { ok: true };
}

function getItemSelectSql(whereSql) {
  return `
    SELECT
      i.id,
      i.tenant_id,
      i.name,
      i.brand,
      i.category,
      i.sku,
      i.barcode,
      i.unit,
      i.purchase_price,
      i.sale_price,
      i.description,
      i.weight_grams,
      ROUND((i.weight_grams / 1000.0)::numeric, 3) AS weight_kg,
      i.volume_ml,
      i.volume_ml AS volume_cm3,
      i.length_cm,
      i.width_cm,
      i.height_cm,
      i.is_active,
      i.created_at,
      i.updated_at
    FROM core.items i
    ${whereSql}
  `;
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
    let whereSql = `WHERE i.tenant_id = $1`;

    if (search) {
      params.push(`%${search}%`);
      whereSql += ` AND (
        i.name ILIKE $${params.length}
        OR COALESCE(i.brand, '') ILIKE $${params.length}
        OR COALESCE(i.category, '') ILIKE $${params.length}
        OR COALESCE(i.sku, '') ILIKE $${params.length}
        OR COALESCE(i.barcode, '') ILIKE $${params.length}
        OR COALESCE(i.description, '') ILIKE $${params.length}
      )`;
    }

    const sql = `
      ${getItemSelectSql(whereSql)}
      ORDER BY i.id DESC
    `;

    const { rows } = await pool.query(sql, params);

    return res.json({
      ok: true,
      items: rows,
    });
  } catch (err) {
    console.error("[GET /items] error:", err);
    return res.status(500).json({
      ok: false,
      error: "items_list_failed",
      details: err.message,
    });
  }
});

router.get("/:id", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const id = Number(req.params.id);

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        error: "invalid_id",
      });
    }

    const sql = `
      ${getItemSelectSql("WHERE i.id = $1 AND i.tenant_id = $2")}
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [id, tenantId]);

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        error: "item_not_found",
      });
    }

    return res.json({
      ok: true,
      item: rows[0],
    });
  } catch (err) {
    console.error("[GET /items/:id] error:", err);
    return res.status(500).json({
      ok: false,
      error: "item_read_failed",
      details: err.message,
    });
  }
});

router.post(
  "/",
  authRequired,
  requireActiveWriteSubscription(),
  requireRole("owner", "admin", "client_owner", "client_manager", "client"),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      const limitCheck = await checkTenantItemLimit(tenantId);
      if (!limitCheck.ok) {
        return res.status(403).json(limitCheck);
      }

      const name = String(req.body.name || "").trim();
      const brand = normalizeOptionalText(req.body.brand);
      const category = normalizeOptionalText(req.body.category);
      const sku = normalizeOptionalText(req.body.sku);
      const barcode = normalizeOptionalText(req.body.barcode);
      const unit = normalizeOptionalText(req.body.unit) || "pcs";
      const purchasePrice = Number(req.body.purchase_price ?? 0);
      const salePrice = Number(req.body.sale_price ?? 0);
      const description = normalizeOptionalText(req.body.description);
      const weightKg = normalizeOptionalNumber(req.body.weight_kg);
      const lengthCm = normalizeOptionalNumber(req.body.length_cm);
      const widthCm = normalizeOptionalNumber(req.body.width_cm);
      const heightCm = normalizeOptionalNumber(req.body.height_cm);
      const volumeCm3 = computeVolumeCm3FromDimensions(lengthCm, widthCm, heightCm);
      const weightGrams = weightKg === null ? null : Number(weightKg) * 1000;
      const isActive = normalizeBoolean(req.body.is_active, true);

      if (!name) {
        return res.status(400).json({
          ok: false,
          error: "name_required",
        });
      }

      if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_purchase_price",
        });
      }

      if (!Number.isFinite(salePrice) || salePrice < 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_sale_price",
        });
      }

      for (const check of [
        validateNonNegativeOptionalNumber(weightKg, "invalid_weight_kg"),
        validateNonNegativeOptionalNumber(lengthCm, "invalid_length_cm"),
        validateNonNegativeOptionalNumber(widthCm, "invalid_width_cm"),
        validateNonNegativeOptionalNumber(heightCm, "invalid_height_cm"),
      ]) {
        if (!check.ok) {
          return res.status(400).json({
            ok: false,
            error: check.error,
          });
        }
      }

      const duplicateCheck = await checkItemDuplicates({
        tenantId,
        sku,
        barcode,
      });

      if (!duplicateCheck.ok) {
        return res.status(409).json({
          ok: false,
          error: duplicateCheck.error,
        });
      }

      const sql = `
        INSERT INTO core.items (
          tenant_id,
          name,
          brand,
          category,
          sku,
          barcode,
          unit,
          purchase_price,
          sale_price,
          description,
          weight_grams,
          volume_ml,
          length_cm,
          width_cm,
          height_cm,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING
          id,
          tenant_id,
          name,
          brand,
          category,
          sku,
          barcode,
          unit,
          purchase_price,
          sale_price,
          description,
          weight_grams,
          ROUND((weight_grams / 1000.0)::numeric, 3) AS weight_kg,
          volume_ml,
          volume_ml AS volume_cm3,
          length_cm,
          width_cm,
          height_cm,
          is_active,
          created_at,
          updated_at
      `;

      const params = [
        tenantId,
        name,
        brand,
        category,
        sku,
        barcode,
        unit,
        purchasePrice,
        salePrice,
        description,
        weightGrams,
        volumeCm3,
        lengthCm,
        widthCm,
        heightCm,
        isActive,
      ];

      const { rows } = await pool.query(sql, params);

      return res.status(201).json({
        ok: true,
        item: rows[0],
      });
    } catch (err) {
      console.error("[POST /items] error:", err);
      return res.status(500).json({
        ok: false,
        error: "item_create_failed",
        details: err.message,
      });
    }
  }
);

router.put(
  "/:id",
  authRequired,
  requireActiveWriteSubscription(),
  requireRole("owner", "admin", "client_owner", "client_manager", "client"),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);
      const id = Number(req.params.id);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_id",
        });
      }

      const existsSql = `
        SELECT id
        FROM core.items
        WHERE id = $1
          AND tenant_id = $2
        LIMIT 1
      `;
      const existsResult = await pool.query(existsSql, [id, tenantId]);

      if (!existsResult.rows.length) {
        return res.status(404).json({
          ok: false,
          error: "item_not_found",
        });
      }

      const name = String(req.body.name || "").trim();
      const brand = normalizeOptionalText(req.body.brand);
      const category = normalizeOptionalText(req.body.category);
      const sku = normalizeOptionalText(req.body.sku);
      const barcode = normalizeOptionalText(req.body.barcode);
      const unit = normalizeOptionalText(req.body.unit) || "pcs";
      const purchasePrice = Number(req.body.purchase_price ?? 0);
      const salePrice = Number(req.body.sale_price ?? 0);
      const description = normalizeOptionalText(req.body.description);
      const weightKg = normalizeOptionalNumber(req.body.weight_kg);
      const lengthCm = normalizeOptionalNumber(req.body.length_cm);
      const widthCm = normalizeOptionalNumber(req.body.width_cm);
      const heightCm = normalizeOptionalNumber(req.body.height_cm);
      const volumeCm3 = computeVolumeCm3FromDimensions(lengthCm, widthCm, heightCm);
      const weightGrams = weightKg === null ? null : Number(weightKg) * 1000;
      const isActive = normalizeBoolean(req.body.is_active, true);

      if (!name) {
        return res.status(400).json({
          ok: false,
          error: "name_required",
        });
      }

      if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_purchase_price",
        });
      }

      if (!Number.isFinite(salePrice) || salePrice < 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_sale_price",
        });
      }

      for (const check of [
        validateNonNegativeOptionalNumber(weightKg, "invalid_weight_kg"),
        validateNonNegativeOptionalNumber(lengthCm, "invalid_length_cm"),
        validateNonNegativeOptionalNumber(widthCm, "invalid_width_cm"),
        validateNonNegativeOptionalNumber(heightCm, "invalid_height_cm"),
      ]) {
        if (!check.ok) {
          return res.status(400).json({
            ok: false,
            error: check.error,
          });
        }
      }

      const duplicateCheck = await checkItemDuplicates({
        tenantId,
        sku,
        barcode,
        excludeId: id,
      });

      if (!duplicateCheck.ok) {
        return res.status(409).json({
          ok: false,
          error: duplicateCheck.error,
        });
      }

      const sql = `
        UPDATE core.items
        SET
          name = $1,
          brand = $2,
          category = $3,
          sku = $4,
          barcode = $5,
          unit = $6,
          purchase_price = $7,
          sale_price = $8,
          description = $9,
          weight_grams = $10,
          volume_ml = $11,
          length_cm = $12,
          width_cm = $13,
          height_cm = $14,
          is_active = $15,
          updated_at = NOW()
        WHERE id = $16
          AND tenant_id = $17
        RETURNING
          id,
          tenant_id,
          name,
          brand,
          category,
          sku,
          barcode,
          unit,
          purchase_price,
          sale_price,
          description,
          weight_grams,
          ROUND((weight_grams / 1000.0)::numeric, 3) AS weight_kg,
          volume_ml,
          volume_ml AS volume_cm3,
          length_cm,
          width_cm,
          height_cm,
          is_active,
          created_at,
          updated_at
      `;

      const params = [
        name,
        brand,
        category,
        sku,
        barcode,
        unit,
        purchasePrice,
        salePrice,
        description,
        weightGrams,
        volumeCm3,
        lengthCm,
        widthCm,
        heightCm,
        isActive,
        id,
        tenantId,
      ];

      const { rows } = await pool.query(sql, params);

      return res.json({
        ok: true,
        item: rows[0],
      });
    } catch (err) {
      console.error("[PUT /items/:id] error:", err);
      return res.status(500).json({
        ok: false,
        error: "item_update_failed",
        details: err.message,
      });
    }
  }
);

router.delete(
  "/:id",
  authRequired,
  requireActiveWriteSubscription(),
  requireRole("owner", "admin", "client_owner"),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);
      const id = Number(req.params.id);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_id",
        });
      }

      const sql = `
        DELETE FROM core.items
        WHERE id = $1
          AND tenant_id = $2
        RETURNING id
      `;

      const { rows } = await pool.query(sql, [id, tenantId]);

      if (!rows.length) {
        return res.status(404).json({
          ok: false,
          error: "item_not_found",
        });
      }

      return res.json({
        ok: true,
        deleted_id: id,
      });
    } catch (err) {
      console.error("[DELETE /items/:id] error:", err);
      return res.status(500).json({
        ok: false,
        error: "item_delete_failed",
        details: err.message,
      });
    }
  }
);

module.exports = router;
