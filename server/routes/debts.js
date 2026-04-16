const express = require("express");
const pool = require("../db");
const {
  authRequired,
  requireRole,
  getEffectiveTenantId,
} = require("../middleware/auth");

const router = express.Router();

/**
 * Список долгов
 */
router.get("/", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        d.id,
        d.tenant_id,
        d.counterparty_id,
        c.name AS client_name,
        d.sale_id,
        d.initial_amount,
        d.paid_amount,
        d.balance_amount,
        d.status,
        d.comment,
        d.created_at,
        sale_loc.name AS location_name,
        sale_loc.code AS location_code,
        COALESCE(sale_items_info.total_qty, 0) AS qty,
        COALESCE(sale_items_info.item_name, '') AS item_name
      FROM core.debts d
      LEFT JOIN core.counterparties c
        ON c.id = d.counterparty_id
       AND c.tenant_id = d.tenant_id
      LEFT JOIN core.sales s
        ON s.id = d.sale_id
       AND s.tenant_id = d.tenant_id
      LEFT JOIN core.locations sale_loc
        ON sale_loc.id = s.location_id
       AND sale_loc.tenant_id = d.tenant_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(product_rows.total_qty_per_item), 0) AS total_qty,
          string_agg(
            product_rows.product_text,
            ' | '
            ORDER BY product_rows.product_text
          ) AS item_name
        FROM (
          SELECT
            i.id AS item_id,
            COALESCE(SUM(si.qty), 0) AS total_qty_per_item,
            trim(
              concat_ws(
                ', ',
                NULLIF(i.sku, ''),
                NULLIF(i.name, '')
              )
            ) ||
            CASE
              WHEN COALESCE(SUM(si.qty), 0) > 0
                THEN ' × ' || trim(to_char(COALESCE(SUM(si.qty), 0), 'FM999999990.####'))
              ELSE ''
            END AS product_text
          FROM core.sale_items si
          LEFT JOIN core.items i
            ON i.id = si.item_id
           AND i.tenant_id = si.tenant_id
          WHERE si.sale_id = d.sale_id
            AND si.tenant_id = d.tenant_id
          GROUP BY i.id, i.sku, i.name
        ) AS product_rows
      ) AS sale_items_info ON TRUE
      WHERE d.tenant_id = $1
      ORDER BY d.id DESC
      `,
      [tenantId]
    );

    return res.json({
      ok: true,
      debts: rows,
    });
  } catch (e) {
    console.error("[GET /debts] error:", e);
    return res.status(500).json({
      ok: false,
      error: "debts_list_failed",
      details: e.message,
    });
  }
});

/**
 * Оплата долга
 */
router.post(
  "/:id/pay",
  authRequired,
  requireRole("owner", "admin", "client_owner", "client_manager", "client"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const tenantId = getEffectiveTenantId(req);
      const userId = req.user.id;
      const debtId = Number(req.params.id);

      const { amount, payment_method, comment } = req.body;

      if (!tenantId) {
        return res.status(400).json({ ok: false, error: "tenant_not_defined" });
      }

      await client.query("BEGIN");

      const debtResult = await client.query(
        `
        SELECT *
        FROM core.debts
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE
        `,
        [debtId, tenantId]
      );

      if (!debtResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "debt_not_found" });
      }

      const debt = debtResult.rows[0];

      const total = Number(debt.initial_amount);
      const paid = Number(debt.paid_amount);
      const balance = Number(debt.balance_amount);
      const payAmount = Number(amount);

      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "invalid_amount",
        });
      }

      if (payAmount > balance) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "amount_exceeds_balance",
        });
      }

      const newPaid = paid + payAmount;
      const newBalance = total - newPaid;

      let newStatus = "partial";
      if (newBalance === 0) newStatus = "paid";

      await client.query(
        `
        UPDATE core.debts
        SET
          paid_amount = $1,
          balance_amount = $2,
          status = $3
        WHERE id = $4
        `,
        [newPaid, newBalance, newStatus, debtId]
      );

      await client.query(
        `
        INSERT INTO core.debt_payments
        (
          tenant_id,
          debt_id,
          amount,
          payment_method,
          comment,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [tenantId, debtId, payAmount, payment_method, comment || null, userId]
      );

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
          payAmount,
          payment_method,
          debt.counterparty_id,
          comment || "Оплата долга",
          userId,
        ]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        new_balance: newBalance,
        status: newStatus,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[POST /debts/pay] error:", e);
      return res.status(500).json({
        ok: false,
        error: "debt_payment_failed",
        details: e.message,
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
