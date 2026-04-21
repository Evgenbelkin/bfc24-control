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

router.get(
  "/transfers",
  authRequired,
  async (req, res) => {
    try {
      const tenantId = getEffectiveTenantId(req);

      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: "tenant_not_defined"
        });
      }

      const limitRaw = toNumber(req.query.limit);
      const limit = limitRaw && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;

      const sql = `
        SELECT
          t.id,
          t.tenant_id,
          t.item_id,
          t.from_location_id,
          t.to_location_id,
          t.qty,
          t.comment,
          t.created_by,
          t.created_at,

          i.name AS item_name,
          i.sku,
          i.barcode,

          lf.name AS from_location_name,
          lf.code AS from_location_code,

          lt.name AS to_location_name,
          lt.code AS to_location_code,

          u.username AS created_by_username,
          u.full_name AS created_by_full_name
        FROM core.transfers t
        JOIN core.items i
          ON i.id = t.item_id
         AND i.tenant_id = t.tenant_id
        JOIN core.locations lf
          ON lf.id = t.from_location_id
         AND lf.tenant_id = t.tenant_id
        JOIN core.locations lt
          ON lt.id = t.to_location_id
         AND lt.tenant_id = t.tenant_id
        LEFT JOIN saas.users u
          ON u.id = t.created_by
        WHERE t.tenant_id = $1
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $2
      `;

      const { rows } = await pool.query(sql, [tenantId, limit]);

      return res.json({
        ok: true,
        transfers: rows
      });
    } catch (e) {
      console.error("[GET /stock/transfers] error:", e);
      return res.status(500).json({
        ok: false,
        error: "transfers_list_failed"
      });
    }
  }
);

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
        return res.status(400).json({
          ok: false,
          error: "invalid_item_id"
        });
      }

      if (!fromLocationId || fromLocationId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_from_location"
        });
      }

      if (!toLocationId || toLocationId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_to_location"
        });
      }

      if (fromLocationId === toLocationId) {
        return res.status(400).json({
          ok: false,
          error: "same_location"
        });
      }

      if (!qty || qty <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_qty"
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
          error: "item_not_found"
        });
      }

      if (itemRows[0].is_active === false) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "item_inactive"
        });
      }

      const { rows: fromLocationRows } = await client.query(
        `
          SELECT id, is_active
          FROM core.locations
          WHERE tenant_id = $1
            AND id = $2
          LIMIT 1
        `,
        [tenantId, fromLocationId]
      );

      if (!fromLocationRows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "from_location_not_found"
        });
      }

      if (fromLocationRows[0].is_active === false) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "from_location_inactive"
        });
      }

      const { rows: toLocationRows } = await client.query(
        `
          SELECT id, is_active
          FROM core.locations
          WHERE tenant_id = $1
            AND id = $2
          LIMIT 1
        `,
        [tenantId, toLocationId]
      );

      if (!toLocationRows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "to_location_not_found"
        });
      }

      if (toLocationRows[0].is_active === false) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "to_location_inactive"
        });
      }

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

      if (!stockRows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "source_stock_not_found"
        });
      }

      const sourceQty = Number(stockRows[0].qty || 0);

      if (sourceQty < qty) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "not_enough_stock"
        });
      }

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
          VALUES ($1, $2, $3, $4, $5, $6, $7)
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

      const { rows: sourceUpdateRows } = await client.query(
        `
          UPDATE core.stock
          SET qty = qty - $4,
              updated_at = NOW()
          WHERE tenant_id = $1
            AND item_id = $2
            AND location_id = $3
          RETURNING *
        `,
        [tenantId, itemId, fromLocationId, qty]
      );

      const sourceStock = sourceUpdateRows[0];

      const { rows: targetUpdateRows } = await client.query(
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
        [tenantId, itemId, toLocationId, qty]
      );

      const targetStock = targetUpdateRows[0];

      const { rows: movementOutRows } = await client.query(
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
          VALUES ($1, $2, $3, 'transfer_out', $4, 'transfer', $5, $6, $7)
          RETURNING *
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

      const movementOut = movementOutRows[0];

      const { rows: movementInRows } = await client.query(
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
          VALUES ($1, $2, $3, 'transfer_in', $4, 'transfer', $5, $6, $7)
          RETURNING *
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

      const movementIn = movementInRows[0];

      await client.query("COMMIT");

      return res.json({
        ok: true,
        transfer,
        source_stock: sourceStock,
        target_stock: targetStock,
        movement_out: movementOut,
        movement_in: movementIn
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