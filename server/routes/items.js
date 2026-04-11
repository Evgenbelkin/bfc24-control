const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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
const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_IMAGE_MIME_TYPES = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

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

function sanitizeFilenameBase(filename) {
  const raw = String(filename || "image").trim();
  const withoutExt = raw.replace(/\.[^.]+$/, "");
  const safe = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return safe || "image";
}

function getImageExtensionByMimeType(mimeType) {
  return ALLOWED_IMAGE_MIME_TYPES[String(mimeType || "").toLowerCase()] || null;
}

function normalizeImageUrl(value) {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  return text.startsWith("/uploads/") ? text : null;
}

async function deleteUploadedFileByUrl(imageUrl) {
  if (!imageUrl || !String(imageUrl).startsWith("/uploads/")) return;

  const filename = path.basename(imageUrl);
  const fullPath = path.join(UPLOADS_DIR, filename);

  try {
    await fs.promises.unlink(fullPath);
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      console.error("[items] failed to delete uploaded file:", err);
    }
  }
}

async function saveBase64ImageToUploads({ originalName, mimeType, base64Data }) {
  const extension = getImageExtensionByMimeType(mimeType);

  if (!extension) {
    throw new Error("unsupported_image_type");
  }

  const cleanedBase64 = String(base64Data || "")
    .replace(/^data:[^;]+;base64,/, "")
    .trim();

  if (!cleanedBase64) {
    throw new Error("image_data_required");
  }

  let buffer;
  try {
    buffer = Buffer.from(cleanedBase64, "base64");
  } catch (err) {
    throw new Error("invalid_image_data");
  }

  if (!buffer || !buffer.length) {
    throw new Error("invalid_image_data");
  }

  const maxSizeBytes = 10 * 1024 * 1024;
  if (buffer.length > maxSizeBytes) {
    throw new Error("image_too_large");
  }

  const filename = `${Date.now()}-${sanitizeFilenameBase(originalName)}-${crypto.randomBytes(6).toString("hex")}${extension}`;
  const fullPath = path.join(UPLOADS_DIR, filename);

  await fs.promises.writeFile(fullPath, buffer);

  return `/uploads/${filename}`;
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
      i.image_url,
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

router.post(
  "/upload-image",
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

      const originalName = normalizeOptionalText(req.body.filename) || "image";
      const mimeType = normalizeOptionalText(req.body.mime_type);
      const base64Data = normalizeOptionalText(req.body.file_base64);

      if (!mimeType) {
        return res.status(400).json({
          ok: false,
          error: "image_type_required",
        });
      }

      if (!base64Data) {
        return res.status(400).json({
          ok: false,
          error: "image_data_required",
        });
      }

      const imageUrl = await saveBase64ImageToUploads({
        originalName,
        mimeType,
        base64Data,
      });

      return res.status(201).json({
        ok: true,
        image_url: imageUrl,
      });
    } catch (err) {
      console.error("[POST /items/upload-image] error:", err);
      return res.status(500).json({
        ok: false,
        error: err.message || "item_image_upload_failed",
      });
    }
  }
);

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
      const imageUrl = normalizeImageUrl(req.body.image_url);
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
          image_url,
          weight_grams,
          volume_ml,
          length_cm,
          width_cm,
          height_cm,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
          image_url,
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
        imageUrl,
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
        SELECT id, image_url
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

      const existingImageUrl = existsResult.rows[0].image_url || null;

      const name = String(req.body.name || "").trim();
      const brand = normalizeOptionalText(req.body.brand);
      const category = normalizeOptionalText(req.body.category);
      const sku = normalizeOptionalText(req.body.sku);
      const barcode = normalizeOptionalText(req.body.barcode);
      const unit = normalizeOptionalText(req.body.unit) || "pcs";
      const purchasePrice = Number(req.body.purchase_price ?? 0);
      const salePrice = Number(req.body.sale_price ?? 0);
      const description = normalizeOptionalText(req.body.description);
      const imageUrl = req.body.image_url === undefined
        ? existingImageUrl
        : normalizeImageUrl(req.body.image_url);
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
          image_url = $10,
          weight_grams = $11,
          volume_ml = $12,
          length_cm = $13,
          width_cm = $14,
          height_cm = $15,
          is_active = $16,
          updated_at = NOW()
        WHERE id = $17
          AND tenant_id = $18
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
          image_url,
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
        imageUrl,
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

      if (existingImageUrl && existingImageUrl !== imageUrl) {
        await deleteUploadedFileByUrl(existingImageUrl);
      }

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
        RETURNING id, image_url
      `;

      const { rows } = await pool.query(sql, [id, tenantId]);

      if (!rows.length) {
        return res.status(404).json({
          ok: false,
          error: "item_not_found",
        });
      }

      await deleteUploadedFileByUrl(rows[0].image_url);

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
