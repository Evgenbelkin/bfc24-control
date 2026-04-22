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

function normalizeQtyMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "units") return "units";
  if (raw === "boxes") return "boxes";
  return "boxes";
}

function formatQtyLabel(row) {
  const qtyMode = normalizeQtyMode(row.qty_mode);
  const qtyInput = Number(row.qty_input || 0);
  const qty = Number(row.qty || 0);
  const boxQtySnapshot = Number(row.box_qty_snapshot || 0);

  if (qtyMode === "boxes") {
    const boxWord = qtyInput === 1 ? "коробка" : "коробки";
    const left = `${qtyInput} ${boxWord}`;
    const right = `${qty} шт`;
    if (boxQtySnapshot > 0) {
      return `${left} / ${right}`;
    }
    return `${left} / ${right}`;
  }

  return `${qtyInput || qty} шт`;
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
          t.qty_mode,
          t.qty_input,
          t.box_qty_snapshot,
          t.comment,
          t.created_by,
          t.created_at,

          i.name AS item_name,
          i.sku,
          i.barcode,
          i.box_qty,

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

      const transfers = rows.map((row) => ({
        ...row,
        qty_display: formatQtyLabel(row)
      }));

      return res.json({
        ok: true,
        transfers
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
      const qtyInput = toNumber(req.body.qty_input ?? req.body.qty);
      const qtyMode = normalizeQtyMode(req.body.qty_mode);
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

      if (!qtyInput || qtyInput <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_qty"
        });
      }

      await client.query("BEGIN");

      const { rows: itemRows } = await client.query(
        `
          SELECT
            id,
            is_active,
            box_qty
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

      const item = itemRows[0];

      if (item.is_active === false) {
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

      const itemBoxQty = toNumber(item.box_qty);
      let boxQtySnapshot = null;
      let finalQty = qtyInput;

      if (qtyMode === "boxes") {
        if (!itemBoxQty || itemBoxQty <= 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: "invalid_box_qty_for_item"
          });
        }

        boxQtySnapshot = itemBoxQty;
        finalQty = qtyInput * itemBoxQty;
      }

      if (!finalQty || finalQty <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "invalid_final_qty"
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

      if (sourceQty < finalQty) {
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
            qty_mode,
            qty_input,
            box_qty_snapshot,
            comment,
            created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *
        `,
        [
          tenantId,
          itemId,
          fromLocationId,
          toLocationId,
          finalQty,
          qtyMode,
          qtyInput,
          boxQtySnapshot,
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
        [tenantId, itemId, fromLocationId, finalQty]
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
        [tenantId, itemId, toLocationId, finalQty]
      );

      const targetStock = targetUpdateRows[0];

      const movementCommentBase = comment ? `${comment} | ` : "";
      const qtyDisplay = formatQtyLabel({
        qty_mode: qtyMode,
        qty_input: qtyInput,
        qty: finalQty,
        box_qty_snapshot: boxQtySnapshot
      });

      const movementComment = `${movementCommentBase}${qtyDisplay}`;

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
          finalQty,
          transfer.id,
          movementComment,
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
          finalQty,
          transfer.id,
          movementComment,
          userId
        ]
      );

      const movementIn = movementInRows[0];

      await client.query("COMMIT");

      return res.json({
        ok: true,
        transfer: {
          ...transfer,
          qty_display: qtyDisplay
        },
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