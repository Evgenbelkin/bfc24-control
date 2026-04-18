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

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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
    const unitCost = Number(batch.unit_cost || 0);
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
  };
}

router.post(
  "/",
  authRequired,
  requireRole("owner", "admin", "client_owner", "client_manager", "client"),
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

      const itemId = toNumber(req.body.item_id);
      const locationId = toNumber(req.body.location_id);
      const writeoffQty = toNumber(req.body.qty);
      const comment = String(req.body.comment || "").trim();

      if (!itemId || !locationId || !writeoffQty || Number(writeoffQty) <= 0) {
        return res.status(400).json({
          ok: false,
          error: "item_id_location_id_qty_required",
        });
      }

      if (!comment) {
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
        [tenantId, itemId, locationId]
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

      if (currentQty < writeoffQty) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "not_enough_stock",
          available: currentQty,
        });
      }

      const fifoResult = await deductFromBatchesFIFO(
        client,
        tenantId,
        itemId,
        writeoffQty
      );

      const newQty = currentQty - writeoffQty;

      await client.query(
        `
        UPDATE core.stock
        SET qty = $1,
            updated_at = NOW()
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
        [tenantId, itemId, locationId, writeoffQty, comment, userId]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        new_qty: newQty,
        movement_id: movement.rows[0].id,
        batch_deductions: fifoResult.deductions,
        total_cost: fifoResult.totalCost,
      });
    } catch (e) {
      await client.query("ROLLBACK");

      if (e.code === "batches_insufficient") {
        return res.status(409).json({
          ok: false,
          error: "batches_insufficient",
          remaining: e.remaining,
        });
      }

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
