const express = require("express");
const pool = require("../db");
const XLSX = require("xlsx");
const {
  authRequired,
  requireRole,
  requireModuleAccess,
  getEffectiveTenantId,
} = require("../middleware/auth");

const router = express.Router();

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function calcFinanceFilled(batch) {
  const unitCost = Number(batch.unit_cost || 0);
  const usdRate = Number(batch.usd_rate || 0);
  const cnyRate = Number(batch.cny_rate || 0);
  const deliveryCost = Number(batch.delivery_cost || 0);

  return unitCost > 0 && usdRate > 0 && cnyRate > 0 && deliveryCost > 0;
}

router.get("/", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    const sql = `
      SELECT
        i.id AS item_id,
        i.name AS item_name,
        i.sku,
        i.unit,
        l.id AS location_id,
        l.name AS location_name,
        COALESCE(s.qty, 0) AS qty
      FROM core.items i
      LEFT JOIN core.stock s
        ON s.item_id = i.id
       AND s.tenant_id = i.tenant_id
      LEFT JOIN core.locations l
        ON l.id = s.location_id
      WHERE i.tenant_id = $1
      ORDER BY i.name, l.name NULLS LAST
    `;

    const { rows } = await pool.query(sql, [tenantId]);

    return res.json({
      ok: true,
      stock: rows,
    });
  } catch (e) {
    console.error("[GET /stock] error:", e);
    return res.status(500).json({
      ok: false,
      error: "stock_list_failed",
    });
  }
});



router.post("/export-xlsx", authRequired, async (req, res) => {
  try {
    const rowsInput = Array.isArray(req.body.rows) ? req.body.rows : [];

    if (!rowsInput.length) {
      return res.status(400).json({
        ok: false,
        error: "rows_required",
      });
    }

    const rows = rowsInput.map((row) => ({
      item_name: normalizeText(row.item_name) || "",
      category_name: normalizeText(row.category_name) || "",
      factory: normalizeText(row.factory) || "",
      factory_article: normalizeText(row.factory_article) || "",
      sku: normalizeText(row.sku) || "",
      barcode: normalizeText(row.barcode) || "",
      image_url: normalizeText(row.image_url) || "",
      location_display: normalizeText(row.location_display) || "",
      qty: Number(row.qty || 0),
    }));

    const workbook = XLSX.utils.book_new();
    const sheetRows = [
      [
        "Фото",
        "Товар",
        "Категория",
        "Фабрика",
        "Арт. фабрики",
        "Артикул / SKU",
        "Штрихкод",
        "Место хранения",
        "Количество",
      ],
      ...rows.map((row) => ([
        row.image_url,
        row.item_name,
        row.category_name,
        row.factory,
        row.factory_article,
        row.sku,
        row.barcode,
        row.location_display,
        row.qty,
      ])),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
    worksheet["!cols"] = [
      { wch: 40 },
      { wch: 30 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 28 },
      { wch: 12 },
    ];

    rows.forEach((row, index) => {
      if (!row.image_url) return;
      const cellAddress = XLSX.utils.encode_cell({ c: 0, r: index + 1 });
      if (!worksheet[cellAddress]) return;
      worksheet[cellAddress].l = { Target: row.image_url };
    });

    XLSX.utils.book_append_sheet(workbook, worksheet, "Остатки");

    const filename = `stock_export_${new Date().toISOString().slice(0,19).replace(/[T:]/g, "-")}.xlsx`;
    const fileBase64 = XLSX.write(workbook, {
      type: "base64",
      bookType: "xlsx",
    });

    return res.json({
      ok: true,
      filename,
      file_base64: fileBase64,
    });
  } catch (e) {
    console.error("[POST /stock/export-xlsx] error:", e);
    return res.status(500).json({
      ok: false,
      error: "stock_export_failed",
    });
  }
});

router.get(
  "/batches",
  authRequired,
  requireModuleAccess("batches"),
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      const sql = `
        SELECT
          b.id,
          b.tenant_id,
          b.item_id,
          b.receipt_id,
          b.batch_date,
          b.qty_total,
          b.qty_remaining,
          b.unit_cost,
          b.usd_rate,
          b.cny_rate,
          b.delivery_cost,
          b.is_finance_filled,
          (b.qty_remaining * b.unit_cost) AS total_sum,
          b.created_at,
          b.updated_at,
          i.name AS item_name,
          i.sku,
          i.barcode
        FROM core.item_batches b
        JOIN core.items i
          ON i.id = b.item_id
         AND i.tenant_id = b.tenant_id
        WHERE b.tenant_id = $1
        ORDER BY b.batch_date ASC, b.id ASC
      `;

      const { rows } = await pool.query(sql, [tenantId]);

      return res.json({
        ok: true,
        batches: rows,
      });
    } catch (e) {
      console.error("[GET /stock/batches] error:", e);
      return res.status(500).json({
        ok: false,
        error: "batches_failed",
      });
    }
  }
);

router.patch(
  "/batches/:id",
  authRequired,
  requireModuleAccess("batches"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const tenantId = getEffectiveTenantId(req);
      const batchId = toNumber(req.params.id);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      if (!batchId || batchId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_batch_id",
        });
      }

      const unitCost = toNumber(req.body.unit_cost);
      const usdRate = toNumber(req.body.usd_rate);
      const cnyRate = toNumber(req.body.cny_rate);
      const deliveryCost = toNumber(req.body.delivery_cost);
      const batchDate = normalizeText(req.body.batch_date);

      if (unitCost === null || unitCost < 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_unit_cost",
        });
      }

      if (usdRate === null || usdRate < 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_usd_rate",
        });
      }

      if (cnyRate === null || cnyRate < 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_cny_rate",
        });
      }

      if (deliveryCost === null || deliveryCost < 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_delivery_cost",
        });
      }

      if (batchDate && !/^\d{4}-\d{2}-\d{2}$/.test(batchDate)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_batch_date",
        });
      }

      await client.query("BEGIN");

      const { rows: currentRows } = await client.query(
        `
          SELECT *
          FROM core.item_batches
          WHERE tenant_id = $1
            AND id = $2
          LIMIT 1
        `,
        [tenantId, batchId]
      );

      if (!currentRows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "batch_not_found",
        });
      }

      const isFinanceFilled = calcFinanceFilled({
        unit_cost: unitCost,
        usd_rate: usdRate,
        cny_rate: cnyRate,
        delivery_cost: deliveryCost,
      });

      const { rows: updatedRows } = await client.query(
        `
          UPDATE core.item_batches
          SET
            batch_date = COALESCE($3::date, batch_date),
            unit_cost = $4,
            usd_rate = $5,
            cny_rate = $6,
            delivery_cost = $7,
            is_finance_filled = $8,
            updated_at = NOW()
          WHERE tenant_id = $1
            AND id = $2
          RETURNING *
        `,
        [
          tenantId,
          batchId,
          batchDate,
          unitCost,
          usdRate,
          cnyRate,
          deliveryCost,
          isFinanceFilled,
        ]
      );

      const updatedBatch = updatedRows[0];

      await client.query(
        `
          UPDATE core.receipt_items
          SET purchase_price = $4
          WHERE tenant_id = $1
            AND receipt_id = $2
            AND item_id = $3
        `,
        [
          tenantId,
          updatedBatch.receipt_id,
          updatedBatch.item_id,
          unitCost,
        ]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        batch: updatedBatch,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[PATCH /stock/batches/:id] error:", e);
      return res.status(500).json({
        ok: false,
        error: "batch_update_failed",
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/incoming",
  authRequired,
  requireRole("owner", "client"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const tenantId = getEffectiveTenantId(req);
      const userId = Number(req.user.id);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      const itemId = toNumber(req.body.item_id);
      const locationId = toNumber(req.body.location_id);
      const qty = toNumber(req.body.qty);
      const batchDate = normalizeText(req.body.batch_date);
      const comment = normalizeText(req.body.comment);

      const purchasePrice = 0;
      const usdRate = 0;
      const cnyRate = 0;
      const deliveryCost = 0;
      const isFinanceFilled = false;

      if (!itemId || itemId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_item_id",
        });
      }

      if (!locationId || locationId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_location_id",
        });
      }

      if (!qty || qty <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_qty",
        });
      }

      if (batchDate && !/^\d{4}-\d{2}-\d{2}$/.test(batchDate)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_batch_date",
        });
      }

      await client.query("BEGIN");

      const { rows: itemRows } = await client.query(
        `
          SELECT id, is_active
          FROM core.items
          WHERE tenant_id = $1
            AND id = $2
          LIMIT 1
        `,
        [tenantId, itemId]
      );

      if (!itemRows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "item_not_found",
        });
      }

      if (itemRows[0].is_active === false) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "item_inactive",
        });
      }

      const { rows: locationRows } = await client.query(
        `
          SELECT id, is_active
          FROM core.locations
          WHERE tenant_id = $1
            AND id = $2
          LIMIT 1
        `,
        [tenantId, locationId]
      );

      if (!locationRows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "location_not_found",
        });
      }

      if (locationRows[0].is_active === false) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "location_inactive",
        });
      }

      const { rows: receiptRows } = await client.query(
        `
          INSERT INTO core.receipts
          (
            tenant_id,
            location_id,
            comment,
            created_by
          )
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `,
        [tenantId, locationId, comment, userId]
      );

      const receipt = receiptRows[0];

      const { rows: receiptItemRows } = await client.query(
        `
          INSERT INTO core.receipt_items
          (
            tenant_id,
            receipt_id,
            item_id,
            qty,
            purchase_price
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `,
        [tenantId, receipt.id, itemId, qty, purchasePrice]
      );

      const receiptItem = receiptItemRows[0];

      const effectiveBatchDate = batchDate || new Date().toISOString().slice(0, 10);

      const { rows: batchRows } = await client.query(
        `
          INSERT INTO core.item_batches
          (
            tenant_id,
            item_id,
            receipt_id,
            batch_date,
            qty_total,
            qty_remaining,
            unit_cost,
            usd_rate,
            cny_rate,
            delivery_cost,
            is_finance_filled
          )
          VALUES ($1, $2, $3, $4::date, $5, $5, $6, $7, $8, $9, $10)
          RETURNING *
        `,
        [
          tenantId,
          itemId,
          receipt.id,
          effectiveBatchDate,
          qty,
          purchasePrice,
          usdRate,
          cnyRate,
          deliveryCost,
          isFinanceFilled,
        ]
      );

      const batch = batchRows[0];

      const { rows: stockRows } = await client.query(
        `
          INSERT INTO core.stock
          (
            tenant_id,
            item_id,
            location_id,
            qty
          )
          VALUES ($1, $2, $3, $4)
          ON CONFLICT ON CONSTRAINT stock_tenant_item_location_uk
          DO UPDATE SET
            qty = core.stock.qty + EXCLUDED.qty,
            updated_at = NOW()
          RETURNING *
        `,
        [tenantId, itemId, locationId, qty]
      );

      const stock = stockRows[0];

      const { rows: movementRows } = await client.query(
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
          VALUES ($1, $2, $3, 'receipt', $4, 'receipt', $5, $6, $7)
          RETURNING *
        `,
        [tenantId, itemId, locationId, qty, receipt.id, comment, userId]
      );

      const movement = movementRows[0];

      await client.query("COMMIT");

      return res.json({
        ok: true,
        receipt,
        receipt_item: receiptItem,
        batch,
        stock,
        movement,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[POST /stock/incoming] error:", e);
      return res.status(500).json({
        ok: false,
        error: "incoming_failed",
      });
    } finally {
      client.release();
    }
  }
);

router.get("/movements", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    const type = String(req.query.type || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    const params = [tenantId];
    let whereSql = `WHERE m.tenant_id = $1`;

    if (type) {
      params.push(type);
      whereSql += ` AND m.movement_type = $${params.length}`;
    }

    if (dateFrom) {
      params.push(dateFrom);
      whereSql += ` AND m.created_at >= $${params.length}::date`;
    }

    if (dateTo) {
      params.push(dateTo);
      whereSql += ` AND m.created_at < ($${params.length}::date + INTERVAL '1 day')`;
    }

    const sql = `
      SELECT
        m.id,
        m.movement_type,
        m.qty,
        m.ref_type,
        m.ref_id,
        m.comment,
        m.created_at,
        m.created_by,
        i.name AS item_name,
        i.sku,
        l.name AS location_name,
        u.username AS user_name
      FROM core.movements m
      JOIN core.items i ON i.id = m.item_id
      LEFT JOIN core.locations l ON l.id = m.location_id
      LEFT JOIN saas.users u ON u.id = m.created_by
      ${whereSql}
      ORDER BY m.id DESC
      LIMIT 500
    `;

    const { rows } = await pool.query(sql, params);

    return res.json({
      ok: true,
      movements: rows,
    });
  } catch (e) {
    console.error("[GET /stock/movements] error:", e);
    return res.status(500).json({
      ok: false,
      error: "movements_failed",
    });
  }
});

module.exports = router;
