const express = require("express");
const pool = require("../db");
const {
  authRequired,
  requireRole,
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

router.get("/batches", authRequired, async (req, res) => {
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
});

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
      const purchasePrice = toNumber(req.body.purchase_price);
      const batchDate = normalizeText(req.body.batch_date);
      const comment = normalizeText(req.body.comment);

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

      if (purchasePrice === null || purchasePrice < 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_purchase_price",
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
            unit_cost
          )
          VALUES ($1, $2, $3, $4::date, $5, $5, $6)
          RETURNING *
        `,
        [tenantId, itemId, receipt.id, effectiveBatchDate, qty, purchasePrice]
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