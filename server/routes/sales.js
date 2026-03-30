const express = require("express");
const pool = require("../db");
const {
  authRequired,
  requireRole,
  getEffectiveTenantId,
} = require("../middleware/auth");

const router = express.Router();

router.post(
  "/sell",
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

      const {
        item_id,
        location_id,
        qty,
        amount,
        payment_method,
        counterparty_id,
        comment,
      } = req.body;

      if (!item_id || !location_id || !qty || Number(qty) <= 0) {
        return res.status(400).json({
          ok: false,
          error: "item_id_location_id_qty_required",
        });
      }

      if (amount === undefined || amount === null || Number(amount) < 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_amount",
        });
      }

      if (!payment_method) {
        return res.status(400).json({
          ok: false,
          error: "payment_method_required",
        });
      }

      if (payment_method === "consignment" && !counterparty_id) {
        return res.status(400).json({
          ok: false,
          error: "counterparty_required_for_consignment",
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
      const sellQty = Number(qty);

      if (currentQty < sellQty) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "not_enough_stock",
          available: currentQty,
        });
      }

      const newQty = currentQty - sellQty;

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
        VALUES ($1, $2, $3, 'sale', $4, $5, $6)
        RETURNING id
        `,
        [
          tenantId,
          item_id,
          location_id,
          sellQty,
          comment || (payment_method === "consignment" ? "Продажа под реализацию" : "Продажа товара"),
          userId,
        ]
      );

      const movementId = movement.rows[0].id;
      let debtId = null;

      if (payment_method === "consignment") {
        const debt = await client.query(
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
            comment
          )
          VALUES ($1, $2, NULL, $3, 0, $3, 'open', $4)
          RETURNING id
          `,
          [
            tenantId,
            counterparty_id,
            Number(amount),
            comment || "Продажа под реализацию",
          ]
        );

        debtId = debt.rows[0].id;
      } else {
        await client.query(
          `
          INSERT INTO core.cash_transactions
          (
            tenant_id,
            transaction_type,
            amount,
            payment_method,
            counterparty_id,
            comment,
            created_by
          )
          VALUES ($1, 'income', $2, $3, $4, $5, $6)
          `,
          [
            tenantId,
            Number(amount),
            payment_method,
            counterparty_id || null,
            comment || "Продажа товара",
            userId,
          ]
        );
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        new_qty: newQty,
        movement_id: movementId,
        debt_id: debtId,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[POST /sales/sell] error:", e);

      return res.status(500).json({
        ok: false,
        error: "sale_failed",
        details: e.message,
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;