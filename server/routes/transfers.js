const express = require("express");
const router = express.Router();
const pool = require("../db");

const {
  authRequired,
  getEffectiveTenantId
} = require("../middleware/auth");

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

router.post(
  "/transfer",
  authRequired,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const tenantId = getEffectiveTenantId(req);
      const userId = Number(req.user.id);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined"
        });
      }

      const itemId = toNumber(req.body.item_id);
      const fromLocationId = toNumber(req.body.from_location_id);
      const toLocationId = toNumber(req.body.to_location_id);
      const qty = toNumber(req.body.qty);
      const comment = normalizeText(req.body.comment);

      if (!itemId || itemId <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_item_id" });
      }

      if (!fromLocationId || fromLocationId <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_from_location" });
      }

      if (!toLocationId || toLocationId <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_to_location" });
      }

      if (fromLocationId === toLocationId) {
        return res.status(400).json({ ok: false, error: "same_location" });
      }

      if (!qty || qty <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_qty" });
      }

      await client.query("BEGIN");

      // Проверка остатка
      const { rows: stockRows } = await client.query(
        `
        SELECT qty
        FROM core.stock
        WHERE tenant_id = $1
          AND item_id = $2
          AND location_id = $3
        LIMIT 1
        `,
        [tenantId, itemId, fromLocationId]
      );

      if (!stockRows.length || Number(stockRows[0].qty) < qty) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "not_enough_stock"
        });
      }

      // Списание
      await client.query(
        `
        UPDATE core.stock
        SET qty = qty - $4,
            updated_at = NOW()
        WHERE tenant_id = $1
          AND item_id = $2
          AND location_id = $3
        `,
        [tenantId, itemId, fromLocationId, qty]
      );

      // Приход
      await client.query(
        `
        INSERT INTO core.stock (tenant_id, item_id, location_id, qty)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT ON CONSTRAINT stock_tenant_item_location_uk
        DO UPDATE SET
          qty = core.stock.qty + EXCLUDED.qty,
          updated_at = NOW()
        `,
        [tenantId, itemId, toLocationId, qty]
      );

      // Запись transfer
      const { rows: transferRows } = await client.query(
        `
        INSERT INTO core.transfers
        (
          tenant_id,
          item_id,
          from_location_id,
          to_location_id,
          qty,
          comment,
          created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
        `,
        [
          tenantId,
          itemId,
          fromLocationId,
          toLocationId,
          qty,
          comment,
          userId
        ]
      );

      const transfer = transferRows[0];

      // Движение OUT
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
        VALUES ($1,$2,$3,'transfer_out',$4,'transfer',$5,$6,$7)
        `,
        [
          tenantId,
          itemId,
          fromLocationId,
          qty,
          transfer.id,
          comment,
          userId
        ]
      );

      // Движение IN
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
        VALUES ($1,$2,$3,'transfer_in',$4,'transfer',$5,$6,$7)
        `,
        [
          tenantId,
          itemId,
          toLocationId,
          qty,
          transfer.id,
          comment,
          userId
        ]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        transfer
      });

    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[POST /stock/transfer] error:", e);

      return res.status(500).json({
        ok: false,
        error: "transfer_failed"
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;