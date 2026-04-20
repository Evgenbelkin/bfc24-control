const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
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
const ITEMS_UPLOADS_DIR = path.join(UPLOADS_DIR, "items");
const IMPORT_CACHE_DIR = path.join(UPLOADS_DIR, "items-import-cache");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

if (!fs.existsSync(ITEMS_UPLOADS_DIR)) {
  fs.mkdirSync(ITEMS_UPLOADS_DIR, { recursive: true });
}

if (!fs.existsSync(IMPORT_CACHE_DIR)) {
  fs.mkdirSync(IMPORT_CACHE_DIR, { recursive: true });
}

const ALLOWED_IMAGE_MIME_TYPES = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const IMPORT_REQUIRED_COLUMNS = ["MARK"];
const IMPORT_PREVIEW_LIMIT = 500;
const IMPORT_ROWS_LIMIT = 1500;
const IMPORT_CACHE_TTL_MS = 1000 * 60 * 60;

function normalizeOptionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(",", "."));
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

  const relativePath = String(imageUrl).replace(/^\/uploads\//, "");
  const normalizedRelativePath = path.normalize(relativePath);

  if (!normalizedRelativePath || normalizedRelativePath.startsWith("..") || path.isAbsolute(normalizedRelativePath)) {
    return;
  }

  const fullPath = path.join(UPLOADS_DIR, normalizedRelativePath);

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

function normalizeHeaderName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase();
}


function getWorkbookBufferFromBase64(fileBase64) {
  const cleanedBase64 = String(fileBase64 || "")
    .replace(/^data:[^;]+;base64,/, "")
    .trim();

  if (!cleanedBase64) {
    throw new Error("file_data_required");
  }

  let buffer;
  try {
    buffer = Buffer.from(cleanedBase64, "base64");
  } catch (err) {
    throw new Error("invalid_file_data");
  }

  if (!buffer || !buffer.length) {
    throw new Error("invalid_file_data");
  }

  return buffer;
}

function getWorkbookFromBuffer(buffer) {
  try {
    return XLSX.read(buffer, { type: "buffer" });
  } catch (err) {
    throw new Error("invalid_excel_file");
  }
}

function getWorkbookFromBase64(fileBase64) {
  const buffer = getWorkbookBufferFromBase64(fileBase64);
  return getWorkbookFromBuffer(buffer);
}

function getExcelImageRowNumber(image) {
  const candidates = [
    image?.range?.tl?.nativeRow,
    image?.range?.tl?.row,
    image?.range?.br?.nativeRow,
    image?.range?.br?.row,
  ];

  for (const value of candidates) {
    if (Number.isInteger(value) && value >= 0) {
      return value + 1;
    }
  }

  return null;
}

function getExcelImageMedia(workbook, imageId) {
  const media = Array.isArray(workbook?.model?.media) ? workbook.model.media : [];
  return (
    media.find((item) => Number(item?.index) === Number(imageId)) ||
    media[Number(imageId)] ||
    media[Number(imageId) - 1] ||
    null
  );
}

async function extractImportImagesByRowFromBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw new Error("invalid_excel_file");
  }

  const worksheet = Array.isArray(workbook.worksheets) && workbook.worksheets.length
    ? workbook.worksheets[0]
    : null;

  if (!worksheet || typeof worksheet.getImages !== "function") {
    return new Map();
  }

  const imageMap = new Map();
  const worksheetImages = worksheet.getImages();

  for (const image of worksheetImages) {
    const rowNumber = getExcelImageRowNumber(image);
    if (!rowNumber || imageMap.has(rowNumber)) {
      continue;
    }

    const media = getExcelImageMedia(workbook, image.imageId);
    if (!media) {
      continue;
    }

    const extension = String(media.extension || "png").toLowerCase();
    let imageBuffer = media.buffer || null;

    if (!imageBuffer && media.base64) {
      imageBuffer = Buffer.from(String(media.base64).replace(/^data:[^;]+;base64,/, ""), "base64");
    }

    if (!imageBuffer || !imageBuffer.length) {
      continue;
    }

    imageMap.set(rowNumber, {
      buffer: Buffer.from(imageBuffer),
      extension: extension === "jpeg" ? "jpg" : extension,
    });
  }

  return imageMap;
}

function getImportCachePath(uploadId) {
  return path.join(IMPORT_CACHE_DIR, `${uploadId}.json`);
}

async function cleanupExpiredImportCaches() {
  try {
    const entries = await fs.promises.readdir(IMPORT_CACHE_DIR, { withFileTypes: true });
    const now = Date.now();

    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const fullPath = path.join(IMPORT_CACHE_DIR, entry.name);
          try {
            const stat = await fs.promises.stat(fullPath);
            if (now - stat.mtimeMs > IMPORT_CACHE_TTL_MS) {
              await fs.promises.unlink(fullPath);
            }
          } catch (err) {
            if (err && err.code !== "ENOENT") {
              console.error("[items/import] failed to cleanup cache file:", err);
            }
          }
        })
    );
  } catch (err) {
    console.error("[items/import] failed to scan cache dir:", err);
  }
}

async function saveImportCache(payload) {
  const uploadId = `${Date.now()}-${crypto.randomBytes(10).toString("hex")}`;
  const fullPath = getImportCachePath(uploadId);

  await fs.promises.writeFile(fullPath, JSON.stringify(payload), "utf8");

  return uploadId;
}

async function readImportCache(uploadId) {
  const normalizedUploadId = normalizeOptionalText(uploadId);
  if (!normalizedUploadId) {
    throw new Error("import_upload_id_required");
  }

  const fullPath = getImportCachePath(normalizedUploadId);

  let raw;
  try {
    raw = await fs.promises.readFile(fullPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error("import_preview_not_found");
    }
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error("import_preview_corrupted");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("import_preview_corrupted");
  }

  const createdAt = Number(parsed.created_at || 0);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    throw new Error("import_preview_corrupted");
  }

  if (Date.now() - createdAt > IMPORT_CACHE_TTL_MS) {
    try {
      await fs.promises.unlink(fullPath);
    } catch (err) {
      if (err && err.code !== "ENOENT") {
        console.error("[items/import] failed to delete expired cache:", err);
      }
    }
    throw new Error("import_preview_expired");
  }

  return {
    uploadId: normalizedUploadId,
    fullPath,
    payload: parsed,
  };
}

async function deleteImportCache(uploadId) {
  const normalizedUploadId = normalizeOptionalText(uploadId);
  if (!normalizedUploadId) return;

  const fullPath = getImportCachePath(normalizedUploadId);
  try {
    await fs.promises.unlink(fullPath);
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      console.error("[items/import] failed to delete cache:", err);
    }
  }
}

async function saveImportedItemImageBySku({ sku, buffer, extension }) {
  const safeSku = sanitizeFilenameBase(sku || "item");
  const safeExtension = String(extension || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const filename = `${safeSku}.${safeExtension}`;
  const fullPath = path.join(ITEMS_UPLOADS_DIR, filename);

  try {
    const existingFiles = await fs.promises.readdir(ITEMS_UPLOADS_DIR);
    await Promise.all(
      existingFiles
        .filter((fileName) => fileName.startsWith(`${safeSku}.`) && fileName !== filename)
        .map((fileName) => fs.promises.unlink(path.join(ITEMS_UPLOADS_DIR, fileName)).catch(() => null))
    );
  } catch (err) {
    console.error("[items/import] failed to cleanup old item images:", err);
  }

  await fs.promises.writeFile(fullPath, buffer);

  return `/uploads/items/${filename}`;
}

function parseImportRowsFromWorkbook(workbook) {
  const sheetName = workbook.SheetNames && workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("excel_sheet_not_found");
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });

  if (!Array.isArray(matrix) || !matrix.length) {
    throw new Error("excel_empty");
  }

  const headerRow = Array.isArray(matrix[0]) ? matrix[0] : [];
  const normalizedHeaders = headerRow.map(normalizeHeaderName);

  const missingRequired = IMPORT_REQUIRED_COLUMNS.filter((key) => !normalizedHeaders.includes(key));
  if (missingRequired.length) {
    const err = new Error("import_required_columns_missing");
    err.missingColumns = missingRequired;
    throw err;
  }

  const rows = [];

  for (let i = 1; i < matrix.length; i += 1) {
    const row = Array.isArray(matrix[i]) ? matrix[i] : [];
    const record = {};

    normalizedHeaders.forEach((header, index) => {
      if (!header) return;
      record[header] = row[index] === undefined ? "" : row[index];
    });

    rows.push({
      row_number: i + 1,
      raw: record,
    });
  }

  return {
    sheet_name: sheetName,
    headers: normalizedHeaders,
    rows,
  };
}

function mapImportRow(record) {
  const sku = normalizeOptionalText(record.MARK);
  const name = normalizeOptionalText(record.NAME) || normalizeOptionalText(record.DESCRIPTION);
  const categoryName = normalizeOptionalText(record.CATEGORY);
  const factory = normalizeOptionalText(record.FACTORY);
  const factoryArticle = normalizeOptionalText(record.FACTORY_ARTICLE);
  const barcode = normalizeOptionalText(record.BARCODE);
  const unit = normalizeOptionalText(record.UNIT) || "pcs";
  const salePriceRaw = normalizeOptionalNumber(record.SALE_PRICE);
  const boxQtyRaw = normalizeOptionalNumber(record.QTY);
  const weightKgRaw = normalizeOptionalNumber(record.WEIGHT_KG);
  const lengthCmRaw = normalizeOptionalNumber(record.LENGTH_CM);
  const widthCmRaw = normalizeOptionalNumber(record.WIDTH_CM);
  const heightCmRaw = normalizeOptionalNumber(record.HEIGHT_CM);
  const description = normalizeOptionalText(record.DESCRIPTION);

  return {
    sku,
    name: name || "",
    category_name: categoryName,
    factory,
    factory_article: factoryArticle,
    barcode,
    unit,
    sale_price: salePriceRaw === null || Number.isNaN(salePriceRaw) ? 0 : salePriceRaw,
    box_qty: boxQtyRaw === null || Number.isNaN(boxQtyRaw) || boxQtyRaw <= 0 ? 0 : boxQtyRaw,
    weight_kg: weightKgRaw === null || Number.isNaN(weightKgRaw) ? 0 : weightKgRaw,
    length_cm: lengthCmRaw === null || Number.isNaN(lengthCmRaw) ? 0 : lengthCmRaw,
    width_cm: widthCmRaw === null || Number.isNaN(widthCmRaw) ? 0 : widthCmRaw,
    height_cm: heightCmRaw === null || Number.isNaN(heightCmRaw) ? 0 : heightCmRaw,
    description: description || "",
  };
}

async function loadExistingImportKeysMap(tenantId) {
  const { rows } = await pool.query(
    `
      SELECT id, sku, barcode
      FROM core.items
      WHERE tenant_id = $1
    `,
    [tenantId]
  );

  const skuMap = new Map();
  const barcodeMap = new Map();

  for (const row of rows) {
    const sku = String(row.sku || "").trim().toLowerCase();
    const barcode = String(row.barcode || "").trim();

    if (sku) {
      skuMap.set(sku, Number(row.id));
    }

    if (barcode) {
      barcodeMap.set(barcode, Number(row.id));
    }
  }

  return { skuMap, barcodeMap };
}

function buildImportPreviewFromRows({ parsedRows, sheetName, headers, existingSkuMap }) {
  const fileSeenSkus = new Set();
  const previewRows = [];
  let newCount = 0;
  let skippedCount = 0;
  let duplicateSystemCount = 0;
  let duplicateFileCount = 0;
  let noSkuCount = 0;

  for (const row of parsedRows) {
    const mapped = mapImportRow(row.raw);
    let status = "new";
    let reason = null;

    const normalizedSku = String(mapped.sku || "").trim().toLowerCase();

    if (!normalizedSku) {
      status = "skip";
      reason = "no_sku";
      noSkuCount += 1;
      skippedCount += 1;
    } else if (fileSeenSkus.has(normalizedSku)) {
      status = "skip";
      reason = "duplicate_sku_in_file";
      duplicateFileCount += 1;
      skippedCount += 1;
    } else if (existingSkuMap.has(normalizedSku)) {
      status = "skip";
      reason = "duplicate_sku_in_system";
      duplicateSystemCount += 1;
      skippedCount += 1;
      fileSeenSkus.add(normalizedSku);
    } else {
      newCount += 1;
      fileSeenSkus.add(normalizedSku);
    }

    previewRows.push({
      row_number: row.row_number,
      sku: mapped.sku,
      name: mapped.name,
      category_name: mapped.category_name,
      factory: mapped.factory,
      factory_article: mapped.factory_article,
      barcode: mapped.barcode,
      unit: mapped.unit,
      box_qty: mapped.box_qty,
      sale_price: mapped.sale_price,
      weight_kg: mapped.weight_kg,
      length_cm: mapped.length_cm,
      width_cm: mapped.width_cm,
      height_cm: mapped.height_cm,
      description: mapped.description,
      status,
      reason,
    });
  }

  return {
    sheet_name: sheetName,
    headers,
    total_rows: parsedRows.length,
    new_count: newCount,
    skipped_count: skippedCount,
    duplicate_sku_in_system_count: duplicateSystemCount,
    duplicate_sku_in_file_count: duplicateFileCount,
    no_sku_count: noSkuCount,
    preview_rows: previewRows.slice(0, IMPORT_PREVIEW_LIMIT),
    rows: previewRows,
  };
}

async function parseImportWorkbookPayload(fileBase64) {
  const buffer = getWorkbookBufferFromBase64(fileBase64);
  const workbook = getWorkbookFromBuffer(buffer);
  const parsed = parseImportRowsFromWorkbook(workbook);

  if (parsed.rows.length > IMPORT_ROWS_LIMIT) {
    const err = new Error("import_rows_limit_exceeded");
    err.rowsLimit = IMPORT_ROWS_LIMIT;
    err.totalRows = parsed.rows.length;
    throw err;
  }

  const importImagesByRow = await extractImportImagesByRowFromBuffer(buffer);
  const serializedImages = [];

  for (const [rowNumber, image] of importImagesByRow.entries()) {
    if (!image || !image.buffer || !image.buffer.length) continue;
    serializedImages.push({
      row_number: rowNumber,
      extension: image.extension || "png",
      base64: Buffer.from(image.buffer).toString("base64"),
    });
  }

  return {
    sheet_name: parsed.sheet_name,
    headers: parsed.headers,
    parsed_rows: parsed.rows,
    images: serializedImages,
  };
}

async function buildImportPreviewAndCache({ tenantId, fileBase64 }) {
  await cleanupExpiredImportCaches();

  const parsedPayload = await parseImportWorkbookPayload(fileBase64);
  const existingKeys = await loadExistingImportKeysMap(tenantId);
  const preview = buildImportPreviewFromRows({
    parsedRows: parsedPayload.parsed_rows,
    sheetName: parsedPayload.sheet_name,
    headers: parsedPayload.headers,
    existingSkuMap: existingKeys.skuMap,
  });

  const uploadId = await saveImportCache({
    created_at: Date.now(),
    tenant_id: Number(tenantId),
    sheet_name: parsedPayload.sheet_name,
    headers: parsedPayload.headers,
    rows: preview.rows,
    images: parsedPayload.images,
  });

  return {
    upload_id: uploadId,
    ...preview,
  };
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

async function findOrCreateCategory({ tenantId, name }) {
  const categoryName = normalizeOptionalText(name);
  if (!categoryName) return null;

  const existing = await pool.query(
    `
      SELECT id, name
      FROM core.categories
      WHERE tenant_id = $1
        AND LOWER(name) = LOWER($2)
      LIMIT 1
    `,
    [tenantId, categoryName]
  );

  if (existing.rows.length) {
    return existing.rows[0];
  }

  try {
    const inserted = await pool.query(
      `
        INSERT INTO core.categories
        (
          tenant_id,
          name,
          is_active
        )
        VALUES ($1, $2, TRUE)
        RETURNING id, name
      `,
      [tenantId, categoryName]
    );

    return inserted.rows[0] || null;
  } catch (err) {
    const duplicate = err && (err.code === "23505" || /duplicate key/i.test(String(err.message || "")));
    if (!duplicate) throw err;

    const fallback = await pool.query(
      `
        SELECT id, name
        FROM core.categories
        WHERE tenant_id = $1
          AND LOWER(name) = LOWER($2)
        LIMIT 1
      `,
      [tenantId, categoryName]
    );

    return fallback.rows[0] || null;
  }
}

function getItemSelectSql(whereSql) {
  return `
    SELECT
      i.id,
      i.tenant_id,
      i.name,
      i.factory,
      i.factory_article,
      i.category_id,
      c.name AS category_name,
      i.sku,
      i.barcode,
      i.unit,
      i.box_qty,
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
    LEFT JOIN core.categories c
      ON c.id = i.category_id
     AND c.tenant_id = i.tenant_id
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
        OR COALESCE(i.factory, '') ILIKE $${params.length}
        OR COALESCE(i.factory_article, '') ILIKE $${params.length}
        OR COALESCE(c.name, '') ILIKE $${params.length}
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

router.get(
  "/categories",
  authRequired,
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      const { rows } = await pool.query(
        `
          SELECT
            id,
            tenant_id,
            name,
            is_active,
            created_at,
            updated_at
          FROM core.categories
          WHERE tenant_id = $1
            AND is_active = TRUE
          ORDER BY name ASC
        `,
        [tenantId]
      );

      return res.json({
        ok: true,
        categories: rows,
      });
    } catch (err) {
      console.error("[GET /items/categories] error:", err);
      return res.status(500).json({
        ok: false,
        error: "categories_list_failed",
        details: err.message,
      });
    }
  }
);

router.post(
  "/import/preview",
  authRequired,
  requireActiveWriteSubscription(),
  requireRole("owner", "admin", "client_owner", "client_manager", "client"),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ ok: false, error: "tenant_not_defined" });
      }

      const fileBase64 = normalizeOptionalText(req.body.file_base64);
      if (!fileBase64) {
        return res.status(400).json({ ok: false, error: "file_data_required" });
      }

      const preview = await buildImportPreviewAndCache({ tenantId, fileBase64 });

      return res.json({
        ok: true,
        ...preview,
      });
    } catch (err) {
      console.error("[POST /items/import/preview] error:", err);
      const statusCode = err.message === "import_rows_limit_exceeded" ? 400 : 500;

      return res.status(statusCode).json({
        ok: false,
        error: err.message || "items_import_preview_failed",
        message:
          err.message === "import_rows_limit_exceeded"
            ? `Максимум ${err.rowsLimit || IMPORT_ROWS_LIMIT} строк в одном Excel-файле`
            : undefined,
        rows_limit: err.rowsLimit || IMPORT_ROWS_LIMIT,
        total_rows: err.totalRows || null,
        missing_columns: err.missingColumns || [],
      });
    }
  }
);

router.post(
  "/import",
  authRequired,
  requireActiveWriteSubscription(),
  requireRole("owner", "admin", "client_owner", "client_manager", "client"),
  async (req, res) => {
    const client = await pool.connect();
    let createdImageUrls = [];

    try {
      const tenantId = getEffectiveTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ ok: false, error: "tenant_not_defined" });
      }

      const uploadId = normalizeOptionalText(req.body.upload_id);
      if (!uploadId) {
        return res.status(400).json({ ok: false, error: "import_upload_id_required" });
      }

      const cachedImport = await readImportCache(uploadId);
      const cachedPayload = cachedImport.payload || {};

      if (Number(cachedPayload.tenant_id) !== Number(tenantId)) {
        return res.status(403).json({ ok: false, error: "import_preview_tenant_mismatch" });
      }

      const preview = {
        sheet_name: cachedPayload.sheet_name || null,
        headers: Array.isArray(cachedPayload.headers) ? cachedPayload.headers : [],
        rows: Array.isArray(cachedPayload.rows) ? cachedPayload.rows : [],
      };

      preview.total_rows = preview.rows.length;
      preview.new_count = preview.rows.filter((row) => row.status === "new").length;
      preview.skipped_count = preview.rows.filter((row) => row.status !== "new").length;
      preview.duplicate_sku_in_system_count = preview.rows.filter((row) => row.reason === "duplicate_sku_in_system").length;
      preview.duplicate_sku_in_file_count = preview.rows.filter((row) => row.reason === "duplicate_sku_in_file").length;
      preview.no_sku_count = preview.rows.filter((row) => row.reason === "no_sku").length;

      if (preview.total_rows > IMPORT_ROWS_LIMIT) {
        return res.status(400).json({
          ok: false,
          error: "import_rows_limit_exceeded",
          message: `Максимум ${IMPORT_ROWS_LIMIT} строк в одном Excel-файле`,
          rows_limit: IMPORT_ROWS_LIMIT,
          total_rows: preview.total_rows,
        });
      }

      const rowsToCreate = preview.rows.filter((row) => row.status === "new");
      const imageRows = Array.isArray(cachedPayload.images) ? cachedPayload.images : [];
      const importImagesByRow = new Map();

      for (const imageRow of imageRows) {
        const rowNumber = Number(imageRow && imageRow.row_number);
        const base64 = normalizeOptionalText(imageRow && imageRow.base64);
        if (!Number.isInteger(rowNumber) || rowNumber <= 0 || !base64) continue;

        try {
          importImagesByRow.set(rowNumber, {
            extension: normalizeOptionalText(imageRow.extension) || "png",
            buffer: Buffer.from(base64, "base64"),
          });
        } catch (err) {
          console.error("[items/import] failed to restore cached image:", err);
        }
      }

      const limitCheck = await checkTenantItemLimit(tenantId);
      if (!limitCheck.ok) {
        return res.status(403).json(limitCheck);
      }

      const existingKeys = await loadExistingImportKeysMap(tenantId);
      const existingSkuMap = existingKeys.skuMap;
      const existingBarcodeMap = existingKeys.barcodeMap;
      const categoryCache = new Map();
      const created = [];
      const skipped = preview.rows.filter((row) => row.status !== "new").map((row) => ({ ...row }));
      createdImageUrls = [];

      await client.query("BEGIN");

      for (const row of rowsToCreate) {
        const normalizedSku = String(row.sku || "").trim().toLowerCase();
        const normalizedBarcode = String(row.barcode || "").trim();

        if (!normalizedSku) {
          skipped.push({
            row_number: row.row_number,
            sku: row.sku,
            name: row.name,
            reason: "no_sku",
          });
          continue;
        }

        if (existingSkuMap.has(normalizedSku)) {
          skipped.push({
            row_number: row.row_number,
            sku: row.sku,
            name: row.name,
            reason: "duplicate_sku_in_system",
          });
          continue;
        }

        if (normalizedBarcode && existingBarcodeMap.has(normalizedBarcode)) {
          skipped.push({
            row_number: row.row_number,
            sku: row.sku,
            name: row.name,
            reason: "barcode_already_exists",
          });
          continue;
        }

        const categoryName = normalizeOptionalText(row.category_name);
        let categoryId = null;

        if (categoryName) {
          const categoryCacheKey = categoryName.toLowerCase();
          if (!categoryCache.has(categoryCacheKey)) {
            const categoryRecord = await findOrCreateCategory({ tenantId, name: categoryName });
            categoryCache.set(categoryCacheKey, categoryRecord ? Number(categoryRecord.id) : null);
          }
          categoryId = categoryCache.get(categoryCacheKey);
        }

        const lengthCm = Number(row.length_cm) > 0 ? Number(row.length_cm) : null;
        const widthCm = Number(row.width_cm) > 0 ? Number(row.width_cm) : null;
        const heightCm = Number(row.height_cm) > 0 ? Number(row.height_cm) : null;
        const weightKg = Number(row.weight_kg) > 0 ? Number(row.weight_kg) : null;
        const volumeCm3 = computeVolumeCm3FromDimensions(lengthCm, widthCm, heightCm);
        const weightGrams = weightKg === null ? null : Number(weightKg) * 1000;
        const rowImage = importImagesByRow.get(Number(row.row_number)) || null;
        const imageUrl = rowImage
          ? await saveImportedItemImageBySku({
              sku: row.sku,
              buffer: rowImage.buffer,
              extension: rowImage.extension,
            })
          : null;

        if (imageUrl) {
          createdImageUrls.push(imageUrl);
        }

        try {
          const { rows: insertedRows } = await client.query(
            `
              INSERT INTO core.items (
                tenant_id,
                name,
                factory,
                factory_article,
                category_id,
                sku,
                barcode,
                unit,
                box_qty,
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
              VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9,
                $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
              )
              RETURNING id, sku, name
            `,
            [
              tenantId,
              row.name || row.sku,
              row.factory,
              row.factory_article,
              categoryId,
              row.sku,
              row.barcode,
              row.unit || "pcs",
              Number(row.box_qty) > 0 ? Number(row.box_qty) : 0,
              0,
              Number(row.sale_price) >= 0 ? Number(row.sale_price) : 0,
              row.description || null,
              imageUrl,
              weightGrams,
              volumeCm3,
              lengthCm,
              widthCm,
              heightCm,
              true,
            ]
          );

          existingSkuMap.set(normalizedSku, Number(insertedRows[0].id));
          if (normalizedBarcode) {
            existingBarcodeMap.set(normalizedBarcode, Number(insertedRows[0].id));
          }

          created.push({
            row_number: row.row_number,
            id: insertedRows[0].id,
            sku: insertedRows[0].sku,
            name: insertedRows[0].name,
          });
        } catch (err) {
          const duplicate = err && (err.code === "23505" || /duplicate key/i.test(String(err.message || "")));
          if (duplicate) {
            skipped.push({
              row_number: row.row_number,
              sku: row.sku,
              name: row.name,
              reason: normalizedBarcode ? "duplicate_sku_or_barcode_in_system" : "duplicate_sku_in_system",
            });
            if (imageUrl) {
              await deleteUploadedFileByUrl(imageUrl);
              createdImageUrls = createdImageUrls.filter((value) => value !== imageUrl);
            }
            continue;
          }
          throw err;
        }
      }

      await client.query("COMMIT");
      await deleteImportCache(uploadId);

      return res.json({
        ok: true,
        total_rows: preview.total_rows,
        created_count: created.length,
        skipped_count: skipped.length,
        duplicate_sku_in_system_count: skipped.filter((row) => row.reason === "duplicate_sku_in_system").length,
        duplicate_sku_in_file_count: skipped.filter((row) => row.reason === "duplicate_sku_in_file").length,
        no_sku_count: skipped.filter((row) => row.reason === "no_sku").length,
        created,
        skipped,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      if (typeof createdImageUrls !== "undefined" && Array.isArray(createdImageUrls)) {
        await Promise.all(createdImageUrls.map((imageUrl) => deleteUploadedFileByUrl(imageUrl)));
      }
      console.error("[POST /items/import] error:", err);
      const statusCode = err.message === "import_rows_limit_exceeded" ? 400 : 500;

      return res.status(statusCode).json({
        ok: false,
        error: err.message || "items_import_failed",
        message:
          err.message === "import_rows_limit_exceeded"
            ? `Максимум ${err.rowsLimit || IMPORT_ROWS_LIMIT} строк в одном Excel-файле`
            : undefined,
        rows_limit: err.rowsLimit || IMPORT_ROWS_LIMIT,
        total_rows: err.totalRows || null,
        missing_columns: err.missingColumns || [],
      });
    } finally {
      client.release();
    }
  }
);

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
      const factory = normalizeOptionalText(req.body.factory ?? req.body.category);
      const factoryArticle = normalizeOptionalText(req.body.factory_article ?? req.body.brand);
      const categoryName = normalizeOptionalText(req.body.category_name);
      const sku = normalizeOptionalText(req.body.sku);
      const barcode = normalizeOptionalText(req.body.barcode);
      const unit = normalizeOptionalText(req.body.unit) || "pcs";
      const boxQtyRaw = normalizeOptionalNumber(req.body.box_qty);
      const boxQty = boxQtyRaw === null ? 1 : boxQtyRaw;
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
        return res.status(400).json({ ok: false, error: "name_required" });
      }
      if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        return res.status(400).json({ ok: false, error: "invalid_purchase_price" });
      }
      if (!Number.isFinite(salePrice) || salePrice < 0) {
        return res.status(400).json({ ok: false, error: "invalid_sale_price" });
      }
      if (!Number.isFinite(boxQty) || boxQty <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_box_qty" });
      }

      for (const check of [
        validateNonNegativeOptionalNumber(weightKg, "invalid_weight_kg"),
        validateNonNegativeOptionalNumber(lengthCm, "invalid_length_cm"),
        validateNonNegativeOptionalNumber(widthCm, "invalid_width_cm"),
        validateNonNegativeOptionalNumber(heightCm, "invalid_height_cm"),
      ]) {
        if (!check.ok) {
          return res.status(400).json({ ok: false, error: check.error });
        }
      }

      const duplicateCheck = await checkItemDuplicates({ tenantId, sku, barcode });
      if (!duplicateCheck.ok) {
        return res.status(409).json({ ok: false, error: duplicateCheck.error });
      }

      const categoryRecord = categoryName ? await findOrCreateCategory({ tenantId, name: categoryName }) : null;
      const categoryId = categoryRecord ? Number(categoryRecord.id) : null;

      const sql = `
        INSERT INTO core.items (
          tenant_id,
          name,
          factory,
          factory_article,
          category_id,
          sku,
          barcode,
          unit,
          box_qty,
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
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        RETURNING
          id,
          tenant_id,
          name,
          factory,
          factory_article,
          category_id,
          sku,
          barcode,
          unit,
          box_qty,
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
        factory,
        factoryArticle,
        categoryId,
        sku,
        barcode,
        unit,
        boxQty,
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
      const item = rows[0] ? { ...rows[0], category_name: categoryRecord ? categoryRecord.name : null } : null;

      return res.status(201).json({ ok: true, item });
    } catch (err) {
      console.error("[POST /items] error:", err);
      return res.status(500).json({ ok: false, error: "item_create_failed", details: err.message });
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
        return res.status(400).json({ ok: false, error: "tenant_not_defined" });
      }
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
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
        return res.status(404).json({ ok: false, error: "item_not_found" });
      }

      const existingImageUrl = existsResult.rows[0].image_url || null;

      const name = String(req.body.name || "").trim();
      const factory = normalizeOptionalText(req.body.factory ?? req.body.category);
      const factoryArticle = normalizeOptionalText(req.body.factory_article ?? req.body.brand);
      const categoryName = normalizeOptionalText(req.body.category_name);
      const sku = normalizeOptionalText(req.body.sku);
      const barcode = normalizeOptionalText(req.body.barcode);
      const unit = normalizeOptionalText(req.body.unit) || "pcs";
      const boxQtyRaw = normalizeOptionalNumber(req.body.box_qty);
      const boxQty = boxQtyRaw === null ? 1 : boxQtyRaw;
      const purchasePrice = Number(req.body.purchase_price ?? 0);
      const salePrice = Number(req.body.sale_price ?? 0);
      const description = normalizeOptionalText(req.body.description);
      const imageUrl = req.body.image_url === undefined ? existingImageUrl : normalizeImageUrl(req.body.image_url);
      const weightKg = normalizeOptionalNumber(req.body.weight_kg);
      const lengthCm = normalizeOptionalNumber(req.body.length_cm);
      const widthCm = normalizeOptionalNumber(req.body.width_cm);
      const heightCm = normalizeOptionalNumber(req.body.height_cm);
      const volumeCm3 = computeVolumeCm3FromDimensions(lengthCm, widthCm, heightCm);
      const weightGrams = weightKg === null ? null : Number(weightKg) * 1000;
      const isActive = normalizeBoolean(req.body.is_active, true);

      if (!name) {
        return res.status(400).json({ ok: false, error: "name_required" });
      }
      if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        return res.status(400).json({ ok: false, error: "invalid_purchase_price" });
      }
      if (!Number.isFinite(salePrice) || salePrice < 0) {
        return res.status(400).json({ ok: false, error: "invalid_sale_price" });
      }
      if (!Number.isFinite(boxQty) || boxQty <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_box_qty" });
      }

      for (const check of [
        validateNonNegativeOptionalNumber(weightKg, "invalid_weight_kg"),
        validateNonNegativeOptionalNumber(lengthCm, "invalid_length_cm"),
        validateNonNegativeOptionalNumber(widthCm, "invalid_width_cm"),
        validateNonNegativeOptionalNumber(heightCm, "invalid_height_cm"),
      ]) {
        if (!check.ok) {
          return res.status(400).json({ ok: false, error: check.error });
        }
      }

      const duplicateCheck = await checkItemDuplicates({ tenantId, sku, barcode, excludeId: id });
      if (!duplicateCheck.ok) {
        return res.status(409).json({ ok: false, error: duplicateCheck.error });
      }

      const categoryRecord = categoryName ? await findOrCreateCategory({ tenantId, name: categoryName }) : null;
      const categoryId = categoryRecord ? Number(categoryRecord.id) : null;

      const sql = `
        UPDATE core.items
        SET
          name = $1,
          factory = $2,
          factory_article = $3,
          category_id = $4,
          sku = $5,
          barcode = $6,
          unit = $7,
          box_qty = $8,
          purchase_price = $9,
          sale_price = $10,
          description = $11,
          image_url = $12,
          weight_grams = $13,
          volume_ml = $14,
          length_cm = $15,
          width_cm = $16,
          height_cm = $17,
          is_active = $18,
          updated_at = NOW()
        WHERE id = $19
          AND tenant_id = $20
        RETURNING
          id,
          tenant_id,
          name,
          factory,
          factory_article,
          category_id,
          sku,
          barcode,
          unit,
          box_qty,
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
        factory,
        factoryArticle,
        categoryId,
        sku,
        barcode,
        unit,
        boxQty,
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
      const item = rows[0] ? { ...rows[0], category_name: categoryRecord ? categoryRecord.name : null } : null;

      if (existingImageUrl && existingImageUrl !== imageUrl) {
        await deleteUploadedFileByUrl(existingImageUrl);
      }

      return res.json({ ok: true, item });
    } catch (err) {
      console.error("[PUT /items/:id] error:", err);
      return res.status(500).json({ ok: false, error: "item_update_failed", details: err.message });
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
        return res.status(400).json({ ok: false, error: "tenant_not_defined" });
      }

      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }

      const sql = `
        DELETE FROM core.items
        WHERE id = $1
          AND tenant_id = $2
        RETURNING id, image_url
      `;

      const { rows } = await pool.query(sql, [id, tenantId]);

      if (!rows.length) {
        return res.status(404).json({ ok: false, error: "item_not_found" });
      }

      await deleteUploadedFileByUrl(rows[0].image_url);

      return res.json({ ok: true, deleted_id: id });
    } catch (err) {
      console.error("[DELETE /items/:id] error:", err);
      return res.status(500).json({ ok: false, error: "item_delete_failed", details: err.message });
    }
  }
);

module.exports = router;
