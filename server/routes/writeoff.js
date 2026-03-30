const express = require("express");
const pool = require("../db");
const {
  authRequired,
  requireRole,
  getEffectiveTenantId,
} = require("../middleware/auth");

const router = express.Router();

router.post(
  "/",
  authRequired,
  requireRole("owner", "admin", "client_owner", "client_manager"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const tenantId = getEffectiveTenantId(req);
      const userId = req.user.id;

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined",
        });
      }

      const { item_id, location_id, qty, comment } = req.body;

      if (!item_id || !location_id || !qty || Number(qty) <= 0) {
        return res.status(400).json({
          ok: false,
          error: "item_id_location_id_qty_required",
        });
      }

      if (!comment || !String(comment).trim()) {
        return res.status(400).json({
          ok: false,
          error: "comment_required",
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

      if (stockResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "stock_not_found",
        });
      }

      const stockId = stockResult.rows[0].id;
      const currentQty = Number(stockResult.rows[0].qty);
      const writeoffQty = Number(qty);

      if (currentQty < writeoffQty) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "not_enough_stock",
          available: currentQty,
        });
      }

      const newQty = currentQty - writeoffQty;

      await client.query(
        `
        UPDATE core.stock
        SET qty = $1
        WHERE id = $2
        `,
        [newQty, stockId]
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
        VALUES ($1, $2, $3, 'writeoff', $4, $5, $6)
        RETURNING id
        `,
        [tenantId, item_id, location_id, writeoffQty, String(comment).trim(), userId]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        new_qty: newQty,
        movement_id: movement.rows[0].id,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[POST /writeoff] error:", e);
      return res.status(500).json({
        ok: false,
        error: "writeoff_failed",
        details: e.message,
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;