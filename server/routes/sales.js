const express = require("express");
const router = express.Router();

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const pool = require("../db");
const { authRequired, requireRole, getEffectiveTenantId } = require("../middleware/auth");

const PROJECT_ROOT_DIR = path.join(__dirname, "..", "..");
const UPLOADS_DIR = path.join(PROJECT_ROOT_DIR, "uploads");

function formatDateTimeRu(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("ru-RU");
}

function getPaymentStatusLabel(value) {
  if (value === "paid") return "Оплачен";
  if (value === "partial") return "Частично оплачен";
  return "Не оплачен";
}

function getPaymentMethodLabel(value) {
  if (value === "cash") return "Наличные";
  if (value === "card") return "Карта";
  if (value === "transfer") return "Перевод";
  if (value === "mixed") return "Смешанная";
  if (value === "consignment") return "Под реализацию";
  return value || "—";
}

function getExcelImageExtension(imageUrl) {
  const lower = String(imageUrl || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpeg";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".gif")) return "gif";
  return null;
}

async function getImageBufferByImageUrl(imageUrl) {
  const normalized = String(imageUrl || "").trim();
  if (!normalized || !normalized.startsWith("/uploads/")) {
    return null;
  }

  const fileName = path.basename(normalized);
  const candidatePaths = [
    path.join(UPLOADS_DIR, fileName),
    path.join(PROJECT_ROOT_DIR, normalized.replace(/^\//, "")),
  ];

  for (const fullPath of candidatePaths) {
    try {
      await fs.promises.access(fullPath, fs.constants.R_OK);
      return await fs.promises.readFile(fullPath);
    } catch (_) {}
  }

  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isConsignmentPayment(paymentMethod, saleType, isConsignment) {
  return (
    String(paymentMethod || "").toLowerCase() === "consignment" ||
    String(saleType || "").toLowerCase() === "consignment" ||
    isConsignment === true
  );
}

function formatDateForFilename(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "unknown-date";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function getItemById(client, tenantId, itemId) {
  const { rows } = await client.query(
    `
      SELECT
        i.id,
        i.tenant_id,
        i.name,
        i.sku,
        i.barcode,
        i.image_url,
        i.sale_price,
        i.purchase_price,
        i.box_qty,
        i.weight_grams,
        i.volume_ml,
        i.is_active
      FROM core.items i
      WHERE i.tenant_id = $1
        AND i.id = $2
      LIMIT 1
    `,
    [tenantId, itemId]
  );
  return rows[0] || null;
}

async function getLocationById(client, tenantId, locationId) {
  const { rows } = await client.query(
    `
      SELECT
        l.id,
        l.tenant_id,
        l.name,
        l.code,
        l.is_active
      FROM core.locations l
      WHERE l.tenant_id = $1
        AND l.id = $2
      LIMIT 1
    `,
    [tenantId, locationId]
  );
  return rows[0] || null;
}

async function getCounterpartyById(client, tenantId, counterpartyId) {
  if (!counterpartyId) return null;

  const { rows } = await client.query(
    `
      SELECT
        c.id,
        c.tenant_id,
        c.name,
        c.is_active
      FROM core.counterparties c
      WHERE c.tenant_id = $1
        AND c.id = $2
      LIMIT 1
    `,
    [tenantId, counterpartyId]
  );
  return rows[0] || null;
}

async function getStockRowForUpdate(client, tenantId, itemId, locationId) {
  const { rows } = await client.query(
    `
      SELECT
        s.id,
        s.tenant_id,
        s.item_id,
        s.location_id,
        s.qty
      FROM core.stock s
      WHERE s.tenant_id = $1
        AND s.item_id = $2
        AND s.location_id = $3
      FOR UPDATE
    `,
    [tenantId, itemId, locationId]
  );
  return rows[0] || null;
}

function normalizeLinesFromBody(body) {
  if (Array.isArray(body.line_items) && body.line_items.length) {
    return body.line_items.map((line) => ({
      item_id: toNumber(line.item_id),
      location_id: toNumber(line.location_id),
      qty: toNumber(line.qty),
      price: toNumber(line.price),
      amount: toNumber(line.amount),
      discount_amount: toNumber(line.discount_amount) || 0,
      comment: normalizeText(line.comment),
    }));
  }

  return [
    {
      item_id: toNumber(body.item_id),
      location_id: toNumber(body.location_id),
      qty: toNumber(body.qty),
      price: toNumber(body.price),
      amount: toNumber(body.amount),
      discount_amount: toNumber(body.discount_amount) || 0,
      comment: normalizeText(body.comment),
    },
  ];
}

async function deductFromBatchesFIFO(client, tenantId, itemId, qtyNeeded) {
  const { rows: batches } = await client.query(
    `
      SELECT
        id,
        qty_remaining,
        unit_cost,
        batch_date
      FROM core.item_batches
      WHERE tenant_id = $1
        AND item_id = $2
        AND qty_remaining > 0
      ORDER BY batch_date ASC, id ASC
      FOR UPDATE
    `,
    [tenantId, itemId]
  );

  let remaining = Number(qtyNeeded);
  let totalCost = 0;
  const deductions = [];

  for (const batch of batches) {
    if (remaining <= 0) break;

    const available = Number(batch.qty_remaining);
    const unitCost = Number(batch.unit_cost);
    const taken = Math.min(available, remaining);

    if (taken > 0) {
      await client.query(
        `
          UPDATE core.item_batches
          SET qty_remaining = qty_remaining - $1,
              updated_at = NOW()
          WHERE id = $2
            AND tenant_id = $3
        `,
        [taken, batch.id, tenantId]
      );

      deductions.push({
        batch_id: Number(batch.id),
        batch_date: batch.batch_date,
        qty_taken: Number(taken),
        unit_cost: Number(unitCost),
        line_cost: round2(taken * unitCost),
      });

      totalCost += taken * unitCost;
      remaining -= taken;
    }
  }

  if (remaining > 0) {
    const err = new Error("batches_insufficient");
    err.code = "batches_insufficient";
    err.remaining = remaining;
    throw err;
  }

  return {
    deductions,
    totalCost: round2(totalCost),
    avgCostPrice: qtyNeeded > 0 ? round4(totalCost / qtyNeeded) : 0,
  };
}

function computeLineWeightKg(qty, boxQty, weightGrams) {
  const q = Number(qty || 0);
  const bq = Number(boxQty || 0);
  const wg = Number(weightGrams || 0);

  if (!Number.isFinite(q) || q <= 0) return 0;
  if (!Number.isFinite(bq) || bq <= 0) return 0;
  if (!Number.isFinite(wg) || wg <= 0) return 0;

  return round4((q / bq) * (wg / 1000));
}

function computeLineVolumeM3(qty, boxQty, volumeCm3) {
  const q = Number(qty || 0);
  const bq = Number(boxQty || 0);
  const v = Number(volumeCm3 || 0);

  if (!Number.isFinite(q) || q <= 0) return 0;
  if (!Number.isFinite(bq) || bq <= 0) return 0;
  if (!Number.isFinite(v) || v <= 0) return 0;

  return round4((q / bq) * (v / 1000000));
}

async function getSaleDetails(client, tenantId, saleId) {
  const saleQuery = await client.query(
    `
      SELECT
        s.id,
        s.tenant_id,
        s.counterparty_id,
        s.location_id,
        s.sale_type,
        s.payment_status,
        s.payment_method,
        s.total_amount,
        s.paid_amount,
        s.debt_amount,
        s.comment,
        s.created_by,
        s.created_at,
        cp.name AS counterparty_name
      FROM core.sales s
      LEFT JOIN core.counterparties cp
        ON cp.id = s.counterparty_id
       AND cp.tenant_id = s.tenant_id
      WHERE s.tenant_id = $1
        AND s.id = $2
      LIMIT 1
    `,
    [tenantId, saleId]
  );

  const sale = saleQuery.rows[0] || null;
  if (!sale) return null;

  const linesQuery = await client.query(
    `
      SELECT
        si.id,
        si.sale_id,
        si.item_id,
        si.qty,
        si.price,
        si.line_amount,
        si.cost_price,
        si.discount_amount,
        si.gross_profit,
        si.batch_deductions,
        i.name AS item_name,
        i.sku AS item_sku,
        i.barcode AS item_barcode,
        i.image_url,
        i.box_qty,
        i.weight_grams,
        i.volume_ml,
        m.location_id,
        l.name AS location_name,
        l.code AS location_code,
        m.comment AS line_comment
      FROM core.sale_items si
      LEFT JOIN core.items i
        ON i.id = si.item_id
       AND i.tenant_id = si.tenant_id
      LEFT JOIN LATERAL (
        SELECT
          mm.location_id,
          mm.comment
        FROM core.movements mm
        WHERE mm.tenant_id = si.tenant_id
          AND mm.ref_type = 'sale'
          AND mm.ref_id = si.sale_id
          AND mm.item_id = si.item_id
          AND mm.movement_type = 'sale'
        ORDER BY mm.id ASC
        LIMIT 1
      ) m ON TRUE
      LEFT JOIN core.locations l
        ON l.id = m.location_id
       AND l.tenant_id = si.tenant_id
      WHERE si.tenant_id = $1
        AND si.sale_id = $2
      ORDER BY si.id ASC
    `,
    [tenantId, saleId]
  );

  const lines = linesQuery.rows.map((line) => {
    const lineWeightKg = computeLineWeightKg(line.qty, line.box_qty, line.weight_grams);
    const lineVolumeM3 = computeLineVolumeM3(line.qty, line.box_qty, line.volume_ml);
    const totalCost = round2(Number(line.qty || 0) * Number(line.cost_price || 0));

    return {
      id: line.id,
      item_id: line.item_id,
      item_name: line.item_name,
      item_sku: line.item_sku,
      item_barcode: line.item_barcode,
      image_url: line.image_url,
      location_id: line.location_id,
      location_name: line.location_name,
      location_code: line.location_code,
      qty: Number(line.qty || 0),
      price: Number(line.price || 0),
      line_amount: Number(line.line_amount || 0),
      cost_price: Number(line.cost_price || 0),
      total_cost: totalCost,
      discount_amount: Number(line.discount_amount || 0),
      gross_profit: Number(line.gross_profit || 0),
      batch_deductions: line.batch_deductions,
      comment: line.line_comment || null,
      box_qty: Number(line.box_qty || 0),
      weight_grams: Number(line.weight_grams || 0),
      volume_ml: Number(line.volume_ml || 0),
      line_weight_kg: lineWeightKg,
      line_volume_m3: lineVolumeM3,
    };
  });

  const totals = {
    total_amount: round2(lines.reduce((sum, line) => sum + Number(line.line_amount || 0), 0)),
    total_cost: round2(lines.reduce((sum, line) => sum + Number(line.total_cost || 0), 0)),
    gross_profit: round2(lines.reduce((sum, line) => sum + Number(line.gross_profit || 0), 0)),
    total_qty: round4(lines.reduce((sum, line) => sum + Number(line.qty || 0), 0)),
    total_weight_kg: round4(lines.reduce((sum, line) => sum + Number(line.line_weight_kg || 0), 0)),
    total_volume_m3: round4(lines.reduce((sum, line) => sum + Number(line.line_volume_m3 || 0), 0)),
  };

  return { sale, lines, totals };
}

router.get(
  "/",
  authRequired,
  requireRole("owner", "client"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const tenantId = getEffectiveTenantId(req);

      const dateFrom = normalizeText(req.query.date_from);
      const dateTo = normalizeText(req.query.date_to);
      const limit = Math.min(Math.max(toNumber(req.query.limit) || 100, 1), 500);

      const params = [tenantId];
      const where = ["s.tenant_id = $1"];

      if (dateFrom) {
        params.push(dateFrom);
        where.push(`s.created_at >= $${params.length}::timestamptz`);
      }

      if (dateTo) {
        params.push(dateTo);
        where.push(`s.created_at < ($${params.length}::date + INTERVAL '1 day')`);
      }

      params.push(limit);

      const sql = `
        SELECT
          s.id,
          s.tenant_id,
          s.counterparty_id,
          s.location_id,
          s.sale_type,
          s.payment_status,
          s.payment_method,
          s.total_amount,
          s.paid_amount,
          s.debt_amount,
          s.comment,
          s.created_by,
          s.created_at,
          cp.name AS counterparty_name,
          COALESCE(si_agg.total_qty, 0) AS total_qty,
          COALESCE(si_agg.total_amount, 0) AS total_amount_items,
          COALESCE(si_agg.total_cost, 0) AS total_cost,
          COALESCE(si_agg.total_profit, 0) AS gross_profit,
          COALESCE(si_agg.total_discount, 0) AS total_discount,
          si_agg.item_names
        FROM core.sales s
        LEFT JOIN core.counterparties cp
          ON cp.id = s.counterparty_id
         AND cp.tenant_id = s.tenant_id
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(si.qty), 0) AS total_qty,
            COALESCE(SUM(si.line_amount), 0) AS total_amount,
            COALESCE(SUM(si.qty * si.cost_price), 0) AS total_cost,
            COALESCE(SUM(si.gross_profit), 0) AS total_profit,
            COALESCE(SUM(si.discount_amount), 0) AS total_discount,
            string_agg(DISTINCT i.name, ', ' ORDER BY i.name) AS item_names
          FROM core.sale_items si
          LEFT JOIN core.items i
            ON i.id = si.item_id
           AND i.tenant_id = si.tenant_id
          WHERE si.sale_id = s.id
            AND si.tenant_id = s.tenant_id
        ) si_agg ON TRUE
        WHERE ${where.join(" AND ")}
        ORDER BY s.id DESC
        LIMIT $${params.length}
      `;

      const { rows } = await client.query(sql, params);

      return res.json({
        ok: true,
        sales: rows,
      });
    } catch (error) {
      console.error("[GET /sales] error:", error);
      return res.status(500).json({
        ok: false,
        error: "sales_list_failed",
      });
    } finally {
      client.release();
    }
  }
);

router.get(
  "/:id/export",
  authRequired,
  requireRole("owner", "client"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const tenantId = getEffectiveTenantId(req);
      const saleId = Number(req.params.id);

      if (!Number.isFinite(saleId) || saleId <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_sale_id" });
      }

      const details = await getSaleDetails(client, tenantId, saleId);

      if (!details) {
        return res.status(404).json({ ok: false, error: "sale_not_found" });
      }

      const { sale, lines, totals } = details;

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "BFC24 CONTROL";
      workbook.company = "BFC24";
      workbook.created = new Date();

      const sheet = workbook.addWorksheet("Продажа", {
        views: [{ state: "frozen", ySplit: 8 }]
      });

      sheet.properties.defaultRowHeight = 22;
      sheet.pageSetup = {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: {
          left: 0.3,
          right: 0.3,
          top: 0.5,
          bottom: 0.5,
          header: 0.2,
          footer: 0.2,
        },
      };

      sheet.columns = [
        { header: "№", key: "n", width: 6 },
        { header: "Фото", key: "photo", width: 14 },
        { header: "Товар", key: "item_name", width: 28 },
        { header: "SKU", key: "item_sku", width: 18 },
        { header: "МХ", key: "location_name", width: 20 },
        { header: "Кол-во", key: "qty", width: 12 },
        { header: "Цена", key: "price", width: 14 },
        { header: "Сумма", key: "line_amount", width: 16 },
        { header: "Вес, кг", key: "line_weight_kg", width: 12 },
        { header: "Объём, м³", key: "line_volume_m3", width: 12 },
        { header: "Комментарий", key: "comment", width: 26 },
      ];

      function setBorder(cell, color = "FFE5E7EB") {
        cell.border = {
          top: { style: "thin", color: { argb: color } },
          bottom: { style: "thin", color: { argb: color } },
          left: { style: "thin", color: { argb: color } },
          right: { style: "thin", color: { argb: color } },
        };
      }

      function fillCell(cellAddress, fillColor = "FFF9FAFB") {
        const cell = sheet.getCell(cellAddress);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: fillColor },
        };
        setBorder(cell);
      }

      function fillCells(cellAddresses, fillColor = "FFF9FAFB") {
        for (const cellAddress of cellAddresses) {
          fillCell(cellAddress, fillColor);
        }
      }

      sheet.mergeCells("A1:K1");
      const titleCell = sheet.getCell("A1");
      titleCell.value = `Документ продажи #${sale.id}`;
      titleCell.font = { bold: true, size: 18, color: { argb: "FF111827" } };
      titleCell.alignment = { vertical: "middle", horizontal: "left" };
      sheet.getRow(1).height = 30;

      sheet.getCell("A3").value = "Дата";
      sheet.getCell("B3").value = formatDateTimeRu(sale.created_at);
      sheet.mergeCells("B3:D3");

      sheet.getCell("A4").value = "Клиент";
      sheet.getCell("B4").value = sale.counterparty_name || "—";
      sheet.mergeCells("B4:D4");

      sheet.getCell("A5").value = "Статус оплаты";
      sheet.getCell("B5").value = getPaymentStatusLabel(sale.payment_status);
      sheet.getCell("C5").value = "Способ оплаты";
      sheet.getCell("D5").value = getPaymentMethodLabel(sale.payment_method);

      sheet.getCell("A6").value = "Комментарий";
      sheet.getCell("B6").value = sale.comment || "—";
      sheet.mergeCells("B6:D6");

      sheet.getCell("F3").value = "Сумма";
      sheet.getCell("G3").value = Number(totals.total_amount || 0);
      sheet.mergeCells("G3:H3");

      sheet.getCell("F4").value = "Всего штук";
      sheet.getCell("G4").value = Number(totals.total_qty || 0);
      sheet.mergeCells("G4:H4");

      sheet.getCell("I3").value = "Вес, кг";
      sheet.getCell("J3").value = Number(totals.total_weight_kg || 0);
      sheet.mergeCells("J3:K3");

      sheet.getCell("I4").value = "Объём, м³";
      sheet.getCell("J4").value = Number(totals.total_volume_m3 || 0);
      sheet.mergeCells("J4:K4");

      for (const cellAddress of ["A3", "A4", "A5", "A6", "C5", "F3", "F4", "I3", "I4"]) {
        const cell = sheet.getCell(cellAddress);
        cell.font = { bold: true, color: { argb: "FF374151" } };
        cell.alignment = { vertical: "middle", horizontal: "left" };
      }

      fillCells(
        ["B3", "C3", "D3", "B4", "C4", "D4", "B5", "D5", "B6", "C6", "D6", "G3", "H3", "G4", "H4", "J3", "K3", "J4", "K4"],
        "FFF9FAFB"
      );

      for (const cellAddress of ["B3", "B4", "B5", "D5", "B6", "G3", "G4", "J3", "J4"]) {
        const cell = sheet.getCell(cellAddress);
        cell.alignment = { vertical: "middle", horizontal: "left" };
      }

      sheet.getCell("B5").font = {
        bold: true,
        color: { argb: sale.payment_status === "paid" ? "FF166534" : sale.payment_status === "partial" ? "FF1D4ED8" : "FF92400E" },
      };

      const headerRowIndex = 8;
      const headerRow = sheet.getRow(headerRowIndex);
      headerRow.values = sheet.columns.map((column) => column.header);
      headerRow.height = 26;
      headerRow.font = { bold: true, color: { argb: "FF111827" } };
      headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5E7EB" },
      };
      headerRow.eachCell((cell) => {
        setBorder(cell, "FFD1D5DB");
      });

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const rowIndex = headerRowIndex + 1 + index;

        const row = sheet.getRow(rowIndex);
        row.values = {
          n: index + 1,
          photo: "",
          item_name: line.item_name || "",
          item_sku: line.item_sku || "",
          location_name: line.location_name || "",
          qty: Number(line.qty || 0),
          price: Number(line.price || 0),
          line_amount: Number(line.line_amount || 0),
          line_weight_kg: Number(line.line_weight_kg || 0),
          line_volume_m3: Number(line.line_volume_m3 || 0),
          comment: line.comment || sale.comment || "",
        };
        row.height = 72;

        row.eachCell((cell) => {
          cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
          setBorder(cell, "FFE5E7EB");
        });

        row.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
        row.getCell(6).alignment = { vertical: "middle", horizontal: "right" };
        row.getCell(7).alignment = { vertical: "middle", horizontal: "right" };
        row.getCell(8).alignment = { vertical: "middle", horizontal: "right" };
        row.getCell(9).alignment = { vertical: "middle", horizontal: "right" };
        row.getCell(10).alignment = { vertical: "middle", horizontal: "right" };

        const imageExtension = getExcelImageExtension(line.image_url);
        if (imageExtension) {
          const imageBuffer = await getImageBufferByImageUrl(line.image_url);
          if (imageBuffer) {
            const imageId = workbook.addImage({
              buffer: imageBuffer,
              extension: imageExtension,
            });

            sheet.addImage(imageId, {
              tl: { col: 1 + 0.2, row: (rowIndex - 1) + 0.15 },
              ext: { width: 80, height: 80 },
              editAs: "oneCell",
            });
          } else {
            row.getCell(2).value = "Нет фото";
            row.getCell(2).alignment = { vertical: "middle", horizontal: "center" };
            row.getCell(2).font = { color: { argb: "FF94A3B8" }, italic: true };
          }
        } else {
          row.getCell(2).value = "Нет фото";
          row.getCell(2).alignment = { vertical: "middle", horizontal: "center" };
          row.getCell(2).font = { color: { argb: "FF94A3B8" }, italic: true };
        }
      }

      const totalRowIndex = sheet.rowCount + 2;
      sheet.mergeCells(`A${totalRowIndex}:E${totalRowIndex}`);
      sheet.getCell(`A${totalRowIndex}`).value = "ИТОГО";
      sheet.getCell(`A${totalRowIndex}`).font = { bold: true, size: 12, color: { argb: "FF111827" } };
      sheet.getCell(`A${totalRowIndex}`).alignment = { vertical: "middle", horizontal: "left" };

      sheet.getCell(`F${totalRowIndex}`).value = Number(totals.total_qty || 0);
      sheet.getCell(`G${totalRowIndex}`).value = Number(totals.total_amount || 0);
      sheet.getCell(`I${totalRowIndex}`).value = Number(totals.total_weight_kg || 0);
      sheet.getCell(`J${totalRowIndex}`).value = Number(totals.total_volume_m3 || 0);

      fillCells(
        [
          `A${totalRowIndex}`, `B${totalRowIndex}`, `C${totalRowIndex}`, `D${totalRowIndex}`, `E${totalRowIndex}`,
          `F${totalRowIndex}`, `G${totalRowIndex}`, `I${totalRowIndex}`, `J${totalRowIndex}`
        ],
        "FFF3F4F6"
      );

      sheet.getCell(`F${totalRowIndex}`).font = { bold: true };
      sheet.getCell(`G${totalRowIndex}`).font = { bold: true };
      sheet.getCell(`I${totalRowIndex}`).font = { bold: true };
      sheet.getCell(`J${totalRowIndex}`).font = { bold: true };

      sheet.getColumn("F").numFmt = '#,##0.####';
      sheet.getColumn("G").numFmt = '#,##0.00" ₽"';
      sheet.getColumn("H").numFmt = '#,##0.00" ₽"';
      sheet.getColumn("I").numFmt = '#,##0.###';
      sheet.getColumn("J").numFmt = '#,##0.####';

      sheet.getCell("G3").numFmt = '#,##0.00" ₽"';
      sheet.getCell("G4").numFmt = '#,##0.####';
      sheet.getCell("J3").numFmt = '#,##0.###';
      sheet.getCell("J4").numFmt = '#,##0.####';

      for (let index = 0; index < lines.length; index += 1) {
        const rowIndex = headerRowIndex + 1 + index;
        sheet.getCell(`F${rowIndex}`).numFmt = '#,##0.####';
        sheet.getCell(`G${rowIndex}`).numFmt = '#,##0.00" ₽"';
        sheet.getCell(`H${rowIndex}`).numFmt = '#,##0.00" ₽"';
        sheet.getCell(`I${rowIndex}`).numFmt = '#,##0.###';
        sheet.getCell(`J${rowIndex}`).numFmt = '#,##0.####';
      }

      sheet.getCell(`F${totalRowIndex}`).numFmt = '#,##0.####';
      sheet.getCell(`G${totalRowIndex}`).numFmt = '#,##0.00" ₽"';
      sheet.getCell(`I${totalRowIndex}`).numFmt = '#,##0.###';
      sheet.getCell(`J${totalRowIndex}`).numFmt = '#,##0.####';

      const fileDate = formatDateForFilename(sale.created_at);
      const fileName = `sale-${sale.id}-${fileDate}.xlsx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

      await workbook.xlsx.write(res);
      return res.end();
    } catch (error) {
      console.error("[GET /sales/:id/export] error:", error);
      return res.status(500).json({
        ok: false,
        error: "sale_export_failed",
      });
    } finally {
      client.release();
    }
  }
);

router.get(
  "/:id",
  authRequired,
  requireRole("owner", "client"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const tenantId = getEffectiveTenantId(req);
      const saleId = Number(req.params.id);

      if (!Number.isFinite(saleId) || saleId <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_sale_id" });
      }

      const details = await getSaleDetails(client, tenantId, saleId);

      if (!details) {
        return res.status(404).json({ ok: false, error: "sale_not_found" });
      }

      return res.json({
        ok: true,
        sale: details.sale,
        lines: details.lines,
        totals: details.totals,
      });
    } catch (error) {
      console.error("[GET /sales/:id] error:", error);
      return res.status(500).json({
        ok: false,
        error: "sale_details_failed",
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/sell",
  authRequired,
  requireRole("owner", "client"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const tenantId = getEffectiveTenantId(req);
      const createdBy = req.user?.id ? Number(req.user.id) : null;

      const counterpartyId = toNumber(req.body.counterparty_id);
      const paymentMethodInput = normalizeText(req.body.payment_method) || "cash";
      const saleTypeInput = normalizeText(req.body.sale_type);
      const isConsignment = req.body.is_consignment === true || req.body.is_consignment === "true";
      const dueDate = normalizeText(req.body.due_date);
      const commonComment = normalizeText(req.body.comment);

      const linesInput = normalizeLinesFromBody(req.body);

      if (!linesInput.length) {
        return res.status(400).json({ ok: false, error: "sale_items_required" });
      }

      for (const line of linesInput) {
        if (!line.item_id) {
          return res.status(400).json({ ok: false, error: "item_required" });
        }
        if (!line.location_id) {
          return res.status(400).json({ ok: false, error: "location_required" });
        }
        if (!isPositiveNumber(line.qty)) {
          return res.status(400).json({ ok: false, error: "invalid_qty" });
        }
        if (line.discount_amount < 0) {
          return res.status(400).json({ ok: false, error: "invalid_discount_amount" });
        }
      }

      await client.query("BEGIN");

      if (counterpartyId) {
        const counterparty = await getCounterpartyById(client, tenantId, counterpartyId);
        if (!counterparty) {
          await client.query("ROLLBACK");
          return res.status(404).json({ ok: false, error: "counterparty_not_found" });
        }
        if (counterparty.is_active === false) {
          await client.query("ROLLBACK");
          return res.status(400).json({ ok: false, error: "counterparty_inactive" });
        }
      }

      const consignment = isConsignmentPayment(paymentMethodInput, saleTypeInput, isConsignment);

      const preparedLines = [];
      let totalAmount = 0;
      let totalCost = 0;
      let totalDiscount = 0;
      let saleLocationId = null;

      for (const srcLine of linesInput) {
        const item = await getItemById(client, tenantId, srcLine.item_id);
        if (!item) {
          await client.query("ROLLBACK");
          return res.status(404).json({ ok: false, error: "item_not_found", item_id: srcLine.item_id });
        }

        if (item.is_active === false) {
          await client.query("ROLLBACK");
          return res.status(400).json({ ok: false, error: "item_inactive", item_id: srcLine.item_id });
        }

        const location = await getLocationById(client, tenantId, srcLine.location_id);
        if (!location) {
          await client.query("ROLLBACK");
          return res.status(404).json({ ok: false, error: "location_not_found", location_id: srcLine.location_id });
        }

        if (location.is_active === false) {
          await client.query("ROLLBACK");
          return res.status(400).json({ ok: false, error: "location_inactive", location_id: srcLine.location_id });
        }

        const stockRow = await getStockRowForUpdate(
          client,
          tenantId,
          srcLine.item_id,
          srcLine.location_id
        );

        if (!stockRow) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: "stock_not_found",
            item_id: srcLine.item_id,
            location_id: srcLine.location_id,
          });
        }

        const availableQty = Number(stockRow.qty) || 0;
        if (availableQty < srcLine.qty) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: "insufficient_stock",
            item_id: srcLine.item_id,
            location_id: srcLine.location_id,
            available_qty: availableQty,
            requested_qty: srcLine.qty,
          });
        }

        let unitPrice = srcLine.price;
        if (!isPositiveNumber(unitPrice)) {
          unitPrice = toNumber(item.sale_price);
        }

        if (!isPositiveNumber(unitPrice)) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: "sale_price_not_set",
            item_id: srcLine.item_id,
            item_name: item.name,
          });
        }

        let grossLineAmount = srcLine.amount;
        if (!isPositiveNumber(grossLineAmount)) {
          grossLineAmount = round2(unitPrice * srcLine.qty);
        }

        const discountAmount = round2(srcLine.discount_amount || 0);
        const lineAmount = round2(grossLineAmount - discountAmount);

        if (!(lineAmount >= 0)) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: "discount_exceeds_amount",
            item_id: srcLine.item_id,
          });
        }

        const fifoResult = await deductFromBatchesFIFO(
          client,
          tenantId,
          srcLine.item_id,
          Number(srcLine.qty)
        );

        const newQty = round4(availableQty - srcLine.qty);

        await client.query(
          `
            UPDATE core.stock
            SET qty = $1,
                updated_at = NOW()
            WHERE id = $2
          `,
          [newQty, stockRow.id]
        );

        const grossProfit = round2(lineAmount - fifoResult.totalCost);

        preparedLines.push({
          item_id: srcLine.item_id,
          location_id: srcLine.location_id,
          qty: Number(srcLine.qty),
          price: round2(unitPrice),
          line_amount: lineAmount,
          discount_amount: discountAmount,
          cost_price: fifoResult.avgCostPrice,
          total_cost: fifoResult.totalCost,
          gross_profit: grossProfit,
          batch_deductions: fifoResult.deductions,
          item_name: item.name,
          item_sku: item.sku,
          item_barcode: item.barcode,
          image_url: item.image_url || null,
          box_qty: Number(item.box_qty || 0),
          weight_grams: Number(item.weight_grams || 0),
          volume_ml: Number(item.volume_ml || 0),
          location_name: location.name,
          location_code: location.code,
          comment: srcLine.comment || commonComment || null,
          new_qty: newQty,
        });

        totalAmount = round2(totalAmount + lineAmount);
        totalCost = round2(totalCost + fifoResult.totalCost);
        totalDiscount = round2(totalDiscount + discountAmount);

        if (!saleLocationId) {
          saleLocationId = srcLine.location_id;
        }
      }

      if (!(totalAmount >= 0)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "sale_total_invalid",
        });
      }

      const paymentMethodForSales = consignment ? "transfer" : paymentMethodInput;
      const saleType = consignment ? "consignment" : (saleTypeInput || "retail");

      if (!["cash", "card", "transfer", "mixed"].includes(paymentMethodForSales)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "invalid_payment_method" });
      }

      if (!["retail", "wholesale", "consignment"].includes(saleType)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "invalid_sale_type" });
      }

      let paidAmount = consignment ? 0 : totalAmount;
      let paymentStatus = consignment ? "unpaid" : "paid";

      if (!consignment) {
        const paidAmountInput = toNumber(req.body.paid_amount);
        if (paidAmountInput !== null) {
          if (paidAmountInput < 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "invalid_paid_amount" });
          }
          if (paidAmountInput > totalAmount) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "paid_amount_exceeds_total" });
          }
          paidAmount = round2(paidAmountInput);
        }

        if (paidAmount === 0) paymentStatus = "unpaid";
        else if (paidAmount < totalAmount) paymentStatus = "partial";
        else paymentStatus = "paid";
      }

      const debtAmount = round2(totalAmount - paidAmount);

      const { rows: saleInsertRows } = await client.query(
        `
          INSERT INTO core.sales
          (
            tenant_id,
            counterparty_id,
            location_id,
            sale_type,
            payment_status,
            payment_method,
            total_amount,
            paid_amount,
            debt_amount,
            comment,
            created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `,
        [
          tenantId,
          counterpartyId,
          saleLocationId,
          saleType,
          paymentStatus,
          paymentMethodForSales,
          totalAmount,
          paidAmount,
          debtAmount,
          commonComment,
          createdBy,
        ]
      );

      const saleRow = saleInsertRows[0];
      const saleId = saleRow.id;

      const insertedSaleItems = [];

      for (const line of preparedLines) {
        const { rows: saleItemRows } = await client.query(
          `
            INSERT INTO core.sale_items
            (
              tenant_id,
              sale_id,
              item_id,
              qty,
              price,
              line_amount,
              cost_price,
              discount_amount,
              gross_profit,
              batch_deductions
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
          `,
          [
            tenantId,
            saleId,
            line.item_id,
            line.qty,
            line.price,
            line.line_amount,
            line.cost_price,
            line.discount_amount,
            line.gross_profit,
            JSON.stringify(line.batch_deductions),
          ]
        );

        insertedSaleItems.push(saleItemRows[0]);

        await client.query(
          `
            INSERT INTO core.movements
            (
              tenant_id,
              item_id,
              location_id,
              movement_type,
              qty,
              ref_type,
              ref_id,
              comment,
              created_by
            )
            VALUES ($1, $2, $3, 'sale', $4, 'sale', $5, $6, $7)
          `,
          [
            tenantId,
            line.item_id,
            line.location_id,
            line.qty,
            saleId,
            line.comment || `Продажа #${saleId}`,
            createdBy,
          ]
        );
      }

      let cashRow = null;
      if (paidAmount > 0) {
        const { rows: cashRows } = await client.query(
          `
            INSERT INTO core.cash_transactions
            (
              tenant_id,
              transaction_type,
              category,
              payment_method,
              amount,
              counterparty_id,
              sale_id,
              comment,
              created_by
            )
            VALUES ($1, 'income', 'sale', $2, $3, $4, $5, $6, $7)
            RETURNING *
          `,
          [
            tenantId,
            paymentMethodForSales,
            paidAmount,
            counterpartyId,
            saleId,
            commonComment,
            createdBy,
          ]
        );

        cashRow = cashRows[0];
      }

      let debtRow = null;
      if (debtAmount > 0) {
        if (!counterpartyId) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: "counterparty_required_for_debt",
          });
        }

        const debtStatus =
          debtAmount === 0 ? "paid" :
          paidAmount > 0 ? "partial" :
          "open";

        const { rows: debtRows } = await client.query(
          `
            INSERT INTO core.debts
            (
              tenant_id,
              counterparty_id,
              sale_id,
              initial_amount,
              paid_amount,
              balance_amount,
              status,
              due_date,
              comment
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
          `,
          [
            tenantId,
            counterpartyId,
            saleId,
            totalAmount,
            paidAmount,
            debtAmount,
            debtStatus,
            dueDate,
            commonComment,
          ]
        );

        debtRow = debtRows[0];
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        sale: saleRow,
        sale_items: insertedSaleItems,
        cash_transaction: cashRow,
        debt: debtRow,
        totals: {
          total_amount: totalAmount,
          paid_amount: paidAmount,
          debt_amount: debtAmount,
          total_cost: totalCost,
          gross_profit: round2(totalAmount - totalCost),
          total_discount: totalDiscount,
        },
        lines: preparedLines.map((line) => ({
          item_id: line.item_id,
          item_name: line.item_name,
          item_sku: line.item_sku,
          item_barcode: line.item_barcode,
          image_url: line.image_url,
          location_id: line.location_id,
          location_name: line.location_name,
          qty: line.qty,
          price: line.price,
          line_amount: line.line_amount,
          discount_amount: line.discount_amount,
          cost_price: line.cost_price,
          total_cost: line.total_cost,
          gross_profit: line.gross_profit,
          new_qty: line.new_qty,
          batch_deductions: line.batch_deductions,
          line_weight_kg: computeLineWeightKg(line.qty, line.box_qty, line.weight_grams),
          line_volume_m3: computeLineVolumeM3(line.qty, line.box_qty, line.volume_ml),
        })),
      });
    } catch (error) {
      await client.query("ROLLBACK");

      if (error.code === "batches_insufficient") {
        return res.status(409).json({
          ok: false,
          error: "batches_insufficient",
          remaining: error.remaining,
        });
      }

      console.error("[POST /sales/sell] error:", error);

      return res.status(500).json({
        ok: false,
        error: "sale_create_failed",
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
