const express = require("express");
const router = express.Router();

const pool = require("../db");
const { authRequired, requireRole, getEffectiveTenantId } = require("../middleware/auth");

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isConsignmentPayment(paymentMethod, saleType, isConsignment) {
  return (
    String(paymentMethod || "").toLowerCase() === "consignment" ||
    String(saleType || "").toLowerCase() === "consignment" ||
    isConsignment === true
  );
}

async function getItemById(client, tenantId, itemId) {
  const { rows } = await client.query(
    `
      SELECT
        i.id,
        i.tenant_id,
        i.name,
        i.sku,
        i.barcode,
        i.sale_price,
        i.purchase_price,
        i.is_active
      FROM core.items i
      WHERE i.tenant_id = $1
        AND i.id = $2
      LIMIT 1
    `,
    [tenantId, itemId]
  );
  return rows[0] || null;
}

async function getLocationById(client, tenantId, locationId) {
  const { rows } = await client.query(
    `
      SELECT
        l.id,
        l.tenant_id,
        l.name,
        l.code,
        l.is_active
      FROM core.locations l
      WHERE l.tenant_id = $1
        AND l.id = $2
      LIMIT 1
    `,
    [tenantId, locationId]
  );
  return rows[0] || null;
}

async function getCounterpartyById(client, tenantId, counterpartyId) {
  if (!counterpartyId) return null;

  const { rows } = await client.query(
    `
      SELECT
        c.id,
        c.tenant_id,
        c.name,
        c.is_active
      FROM core.counterparties c
      WHERE c.tenant_id = $1
        AND c.id = $2
      LIMIT 1
    `,
    [tenantId, counterpartyId]
  );
  return rows[0] || null;
}

async function getStockRowForUpdate(client, tenantId, itemId, locationId) {
  const { rows } = await client.query(
    `
      SELECT
        s.id,
        s.tenant_id,
        s.item_id,
        s.location_id,
        s.qty
      FROM core.stock s
      WHERE s.tenant_id = $1
        AND s.item_id = $2
        AND s.location_id = $3
      FOR UPDATE
    `,
    [tenantId, itemId, locationId]
  );
  return rows[0] || null;
}

function normalizeLinesFromBody(body) {
  if (Array.isArray(body.line_items) && body.line_items.length) {
    return body.line_items.map((line) => ({
      item_id: toNumber(line.item_id),
      location_id: toNumber(line.location_id),
      qty: toNumber(line.qty),
      price: toNumber(line.price),
      amount: toNumber(line.amount),
      discount_amount: toNumber(line.discount_amount) || 0,
      comment: normalizeText(line.comment),
    }));
  }

  return [
    {
      item_id: toNumber(body.item_id),
      location_id: toNumber(body.location_id),
      qty: toNumber(body.qty),
      price: toNumber(body.price),
      amount: toNumber(body.amount),
      discount_amount: toNumber(body.discount_amount) || 0,
      comment: normalizeText(body.comment),
    },
  ];
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
    const unitCost = Number(batch.unit_cost);
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
    avgCostPrice: qtyNeeded > 0 ? round4(totalCost / qtyNeeded) : 0,
  };
}

router.get(
  "/",
  authRequired,
  requireRole("owner", "client"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const tenantId = getEffectiveTenantId(req);

      const dateFrom = normalizeText(req.query.date_from);
      const dateTo = normalizeText(req.query.date_to);
      const limit = Math.min(Math.max(toNumber(req.query.limit) || 100, 1), 500);

      const params = [tenantId];
      const where = ["s.tenant_id = $1"];

      if (dateFrom) {
        params.push(dateFrom);
        where.push(`s.created_at >= $${params.length}::timestamptz`);
      }

      if (dateTo) {
        params.push(dateTo);
        where.push(`s.created_at < ($${params.length}::date + INTERVAL '1 day')`);
      }

      params.push(limit);

      const sql = `
        SELECT
          s.id,
          s.tenant_id,
          s.counterparty_id,
          s.location_id,
          s.sale_type,
          s.payment_status,
          s.payment_method,
          s.total_amount,
          s.paid_amount,
          s.debt_amount,
          s.comment,
          s.created_by,
          s.created_at,
          cp.name AS counterparty_name,
          COALESCE(si_agg.total_qty, 0) AS total_qty,
          COALESCE(si_agg.total_amount, 0) AS total_amount_items,
          COALESCE(si_agg.total_cost, 0) AS total_cost,
          COALESCE(si_agg.total_profit, 0) AS gross_profit,
          COALESCE(si_agg.total_discount, 0) AS total_discount,
          si_agg.item_names
        FROM core.sales s
        LEFT JOIN core.counterparties cp
          ON cp.id = s.counterparty_id
         AND cp.tenant_id = s.tenant_id
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(si.qty), 0) AS total_qty,
            COALESCE(SUM(si.line_amount), 0) AS total_amount,
            COALESCE(SUM(si.qty * si.cost_price), 0) AS total_cost,
            COALESCE(SUM(si.gross_profit), 0) AS total_profit,
            COALESCE(SUM(si.discount_amount), 0) AS total_discount,
            string_agg(DISTINCT i.name, ', ' ORDER BY i.name) AS item_names
          FROM core.sale_items si
          LEFT JOIN core.items i
            ON i.id = si.item_id
           AND i.tenant_id = si.tenant_id
          WHERE si.sale_id = s.id
            AND si.tenant_id = s.tenant_id
        ) si_agg ON TRUE
        WHERE ${where.join(" AND ")}
        ORDER BY s.id DESC
        LIMIT $${params.length}
      `;

      const { rows } = await client.query(sql, params);

      return res.json({
        ok: true,
        sales: rows,
      });
    } catch (error) {
      console.error("[GET /sales] error:", error);
      return res.status(500).json({
        ok: false,
        error: "sales_list_failed",
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/sell",
  authRequired,
  requireRole("owner", "client"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const tenantId = getEffectiveTenantId(req);
      const createdBy = req.user?.id ? Number(req.user.id) : null;

      const counterpartyId = toNumber(req.body.counterparty_id);
      const paymentMethodInput = normalizeText(req.body.payment_method) || "cash";
      const saleTypeInput = normalizeText(req.body.sale_type);
      const isConsignment = req.body.is_consignment === true || req.body.is_consignment === "true";
      const dueDate = normalizeText(req.body.due_date);
      const commonComment = normalizeText(req.body.comment);

      const linesInput = normalizeLinesFromBody(req.body);

      if (!linesInput.length) {
        return res.status(400).json({ ok: false, error: "sale_items_required" });
      }

      for (const line of linesInput) {
        if (!line.item_id) {
          return res.status(400).json({ ok: false, error: "item_required" });
        }
        if (!line.location_id) {
          return res.status(400).json({ ok: false, error: "location_required" });
        }
        if (!isPositiveNumber(line.qty)) {
          return res.status(400).json({ ok: false, error: "invalid_qty" });
        }
        if (line.discount_amount < 0) {
          return res.status(400).json({ ok: false, error: "invalid_discount_amount" });
        }
      }

      await client.query("BEGIN");

      if (counterpartyId) {
        const counterparty = await getCounterpartyById(client, tenantId, counterpartyId);
        if (!counterparty) {
          await client.query("ROLLBACK");
          return res.status(404).json({ ok: false, error: "counterparty_not_found" });
        }
        if (counterparty.is_active === false) {
          await client.query("ROLLBACK");
          return res.status(400).json({ ok: false, error: "counterparty_inactive" });
        }
      }

      const consignment = isConsignmentPayment(paymentMethodInput, saleTypeInput, isConsignment);

      const preparedLines = [];
      let totalAmount = 0;
      let totalCost = 0;
      let totalDiscount = 0;
      let saleLocationId = null;

      for (const srcLine of linesInput) {
        const item = await getItemById(client, tenantId, srcLine.item_id);
        if (!item) {
          await client.query("ROLLBACK");
          return res.status(404).json({ ok: false, error: "item_not_found", item_id: srcLine.item_id });
        }

        if (item.is_active === false) {
          await client.query("ROLLBACK");
          return res.status(400).json({ ok: false, error: "item_inactive", item_id: srcLine.item_id });
        }

        const location = await getLocationById(client, tenantId, srcLine.location_id);
        if (!location) {
          await client.query("ROLLBACK");
          return res.status(404).json({ ok: false, error: "location_not_found", location_id: srcLine.location_id });
        }

        if (location.is_active === false) {
          await client.query("ROLLBACK");
          return res.status(400).json({ ok: false, error: "location_inactive", location_id: srcLine.location_id });
        }

        const stockRow = await getStockRowForUpdate(
          client,
          tenantId,
          srcLine.item_id,
          srcLine.location_id
        );

        if (!stockRow) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: "stock_not_found",
            item_id: srcLine.item_id,
            location_id: srcLine.location_id,
          });
        }

        const availableQty = Number(stockRow.qty) || 0;
        if (availableQty < srcLine.qty) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: "insufficient_stock",
            item_id: srcLine.item_id,
            location_id: srcLine.location_id,
            available_qty: availableQty,
            requested_qty: srcLine.qty,
          });
        }

        let unitPrice = srcLine.price;
        if (!isPositiveNumber(unitPrice)) {
          unitPrice = toNumber(item.sale_price);
        }

        if (!isPositiveNumber(unitPrice)) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: "sale_price_not_set",
            item_id: srcLine.item_id,
            item_name: item.name,
          });
        }

        let grossLineAmount = srcLine.amount;
        if (!isPositiveNumber(grossLineAmount)) {
          grossLineAmount = round2(unitPrice * srcLine.qty);
        }

        const discountAmount = round2(srcLine.discount_amount || 0);
        const lineAmount = round2(grossLineAmount - discountAmount);

        if (!(lineAmount >= 0)) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: "discount_exceeds_amount",
            item_id: srcLine.item_id,
          });
        }

        const fifoResult = await deductFromBatchesFIFO(
          client,
          tenantId,
          srcLine.item_id,
          Number(srcLine.qty)
        );

        const newQty = round4(availableQty - srcLine.qty);

        await client.query(
          `
            UPDATE core.stock
            SET qty = $1,
                updated_at = NOW()
            WHERE id = $2
          `,
          [newQty, stockRow.id]
        );

        const grossProfit = round2(lineAmount - fifoResult.totalCost);

        preparedLines.push({
          item_id: srcLine.item_id,
          location_id: srcLine.location_id,
          qty: Number(srcLine.qty),
          price: round2(unitPrice),
          line_amount: lineAmount,
          discount_amount: discountAmount,
          cost_price: fifoResult.avgCostPrice,
          total_cost: fifoResult.totalCost,
          gross_profit: grossProfit,
          batch_deductions: fifoResult.deductions,
          item_name: item.name,
          location_name: location.name,
          location_code: location.code,
          comment: srcLine.comment || commonComment || null,
          new_qty: newQty,
        });

        totalAmount = round2(totalAmount + lineAmount);
        totalCost = round2(totalCost + fifoResult.totalCost);
        totalDiscount = round2(totalDiscount + discountAmount);

        if (!saleLocationId) {
          saleLocationId = srcLine.location_id;
        }
      }

      if (!(totalAmount >= 0)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "sale_total_invalid",
        });
      }

      const paymentMethodForSales = consignment ? "transfer" : paymentMethodInput;
      const saleType = consignment ? "consignment" : (saleTypeInput || "retail");

      if (!["cash", "card", "transfer", "mixed"].includes(paymentMethodForSales)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "invalid_payment_method" });
      }

      if (!["retail", "wholesale", "consignment"].includes(saleType)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "invalid_sale_type" });
      }

      let paidAmount = consignment ? 0 : totalAmount;
      let paymentStatus = consignment ? "unpaid" : "paid";

      if (!consignment) {
        const paidAmountInput = toNumber(req.body.paid_amount);
        if (paidAmountInput !== null) {
          if (paidAmountInput < 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "invalid_paid_amount" });
          }
          if (paidAmountInput > totalAmount) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "paid_amount_exceeds_total" });
          }
          paidAmount = round2(paidAmountInput);
        }

        if (paidAmount === 0) paymentStatus = "unpaid";
        else if (paidAmount < totalAmount) paymentStatus = "partial";
        else paymentStatus = "paid";
      }

      const debtAmount = round2(totalAmount - paidAmount);

      const { rows: saleInsertRows } = await client.query(
        `
          INSERT INTO core.sales
          (
            tenant_id,
            counterparty_id,
            location_id,
            sale_type,
            payment_status,
            payment_method,
            total_amount,
            paid_amount,
            debt_amount,
            comment,
            created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `,
        [
          tenantId,
          counterpartyId,
          saleLocationId,
          saleType,
          paymentStatus,
          paymentMethodForSales,
          totalAmount,
          paidAmount,
          debtAmount,
          commonComment,
          createdBy,
        ]
      );

      const saleRow = saleInsertRows[0];
      const saleId = saleRow.id;

      const insertedSaleItems = [];

      for (const line of preparedLines) {
        const { rows: saleItemRows } = await client.query(
          `
            INSERT INTO core.sale_items
            (
              tenant_id,
              sale_id,
              item_id,
              qty,
              price,
              line_amount,
              cost_price,
              discount_amount,
              gross_profit,
              batch_deductions
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
          `,
          [
            tenantId,
            saleId,
            line.item_id,
            line.qty,
            line.price,
            line.line_amount,
            line.cost_price,
            line.discount_amount,
            line.gross_profit,
            JSON.stringify(line.batch_deductions),
          ]
        );

        insertedSaleItems.push(saleItemRows[0]);

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
            VALUES ($1, $2, $3, 'sale', $4, 'sale', $5, $6, $7)
          `,
          [
            tenantId,
            line.item_id,
            line.location_id,
            line.qty,
            saleId,
            line.comment || `Продажа #${saleId}`,
            createdBy,
          ]
        );
      }

      let cashRow = null;
      if (paidAmount > 0) {
        const { rows: cashRows } = await client.query(
          `
            INSERT INTO core.cash_transactions
            (
              tenant_id,
              transaction_type,
              category,
              payment_method,
              amount,
              counterparty_id,
              sale_id,
              comment,
              created_by
            )
            VALUES ($1, 'income', 'sale', $2, $3, $4, $5, $6, $7)
            RETURNING *
          `,
          [
            tenantId,
            paymentMethodForSales,
            paidAmount,
            counterpartyId,
            saleId,
            commonComment,
            createdBy,
          ]
        );

        cashRow = cashRows[0];
      }

      let debtRow = null;
      if (debtAmount > 0) {
        if (!counterpartyId) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: "counterparty_required_for_debt",
          });
        }

        const debtStatus =
          debtAmount === 0 ? "paid" :
          paidAmount > 0 ? "partial" :
          "open";

        const { rows: debtRows } = await client.query(
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
              due_date,
              comment
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
          `,
          [
            tenantId,
            counterpartyId,
            saleId,
            totalAmount,
            paidAmount,
            debtAmount,
            debtStatus,
            dueDate,
            commonComment,
          ]
        );

        debtRow = debtRows[0];
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        sale: saleRow,
        sale_items: insertedSaleItems,
        cash_transaction: cashRow,
        debt: debtRow,
        totals: {
          total_amount: totalAmount,
          paid_amount: paidAmount,
          debt_amount: debtAmount,
          total_cost: totalCost,
          gross_profit: round2(totalAmount - totalCost),
          total_discount: totalDiscount,
        },
        lines: preparedLines.map((line) => ({
          item_id: line.item_id,
          item_name: line.item_name,
          location_id: line.location_id,
          location_name: line.location_name,
          qty: line.qty,
          price: line.price,
          line_amount: line.line_amount,
          discount_amount: line.discount_amount,
          cost_price: line.cost_price,
          total_cost: line.total_cost,
          gross_profit: line.gross_profit,
          new_qty: line.new_qty,
          batch_deductions: line.batch_deductions,
        })),
      });
    } catch (error) {
      await client.query("ROLLBACK");

      if (error.code === "batches_insufficient") {
        return res.status(409).json({
          ok: false,
          error: "batches_insufficient",
          remaining: error.remaining,
        });
      }

      console.error("[POST /sales/sell] error:", error);

      return res.status(500).json({
        ok: false,
        error: "sale_create_failed",
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;