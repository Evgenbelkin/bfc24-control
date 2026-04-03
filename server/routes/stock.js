const express = require("express");
const pool = require("../db");
const {
  authRequired,
  requireRole,
  getEffectiveTenantId,
} = require("../middleware/auth");

const router = express.Router();

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
      details: e.message,
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

      const { item_id, location_id, qty, comment, purchase_price } = req.body;

      if (!item_id || !location_id || !qty || Number(qty) <= 0) {
        return res.status(400).json({
          ok: false,
          error: "item_id_location_id_qty_required",
        });
      }

      if (purchase_price === undefined || Number(purchase_price) < 0) {
        return res.status(400).json({
          ok: false,
          error: "purchase_price_required",
        });
      }

      await client.query("BEGIN");

      const stockResult = await client.query(
        `
        SELECT id, qty
        FROM core.stock
        WHERE tenant_id = $1
          AND item_id = $2
          AND location_id = $3
        FOR UPDATE
        `,
        [tenantId, item_id, location_id]
      );

      let newQty = 0;

      if (stockResult.rows.length > 0) {
        const stockId = stockResult.rows[0].id;
        const currentQty = Number(stockResult.rows[0].qty);
        newQty = currentQty + Number(qty);

        await client.query(
          `
          UPDATE core.stock
          SET qty = $1
          WHERE id = $2
          `,
          [newQty, stockId]
        );
      } else {
        newQty = Number(qty);

        await client.query(
          `
          INSERT INTO core.stock (tenant_id, item_id, location_id, qty)
          VALUES ($1, $2, $3, $4)
          `,
          [tenantId, item_id, location_id, newQty]
        );
      }

      // 🔥 СОЗДАНИЕ ПАРТИИ
      await client.query(
        `
        INSERT INTO core.item_batches
        (tenant_id, item_id, batch_date, qty_total, qty_remaining, unit_cost)
        VALUES ($1, $2, CURRENT_DATE, $3, $3, $4)
        `,
        [tenantId, item_id, qty, purchase_price]
      );

      const movement = await client.query(
        `
        INSERT INTO core.movements
        (
          tenant_id,
          item_id,
          location_id,
          movement_type,
          qty,
          comment,
          created_by
        )
        VALUES ($1, $2, $3, 'receipt', $4, $5, $6)
        RETURNING id
        `,
        [tenantId, item_id, location_id, qty, comment || null, userId]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        new_qty: newQty,
        movement_id: movement.rows[0].id,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[POST /stock/incoming] error:", e);
      return res.status(500).json({
        ok: false,
        error: "incoming_failed",
        details: e.message,
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;