const express = require('express');
const router = express.Router();

const pool = require('../db');
const { authRequired, requireRole, getEffectiveTenantId } = require('../middleware/auth');

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isConsignmentPayment(paymentMethod, saleType, isConsignment) {
  return (
    String(paymentMethod || '').toLowerCase() === 'consignment' ||
    String(saleType || '').toLowerCase() === 'consignment' ||
    isConsignment === true
  );
}

async function getTableColumns(client, schema, table) {
  const { rows } = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
    `,
    [schema, table]
  );
  return new Set(rows.map((r) => r.column_name));
}

async function insertDynamic(client, schema, table, data) {
  const columnsSet = await getTableColumns(client, schema, table);

  const entries = Object.entries(data).filter(
    ([key, value]) => columnsSet.has(key) && value !== undefined
  );

  if (!entries.length) {
    throw new Error(`insert_dynamic_no_columns_${schema}.${table}`);
  }

  const columns = entries.map(([key]) => key);
  const values = entries.map(([, value]) => value);
  const placeholders = entries.map((_, idx) => `$${idx + 1}`);

  const sql = `
    INSERT INTO ${schema}.${table} (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
  `;

  const { rows } = await client.query(sql, values);
  return rows[0];
}

async function updateDynamicById(client, schema, table, id, patch) {
  const columnsSet = await getTableColumns(client, schema, table);

  const entries = Object.entries(patch).filter(
    ([key, value]) => columnsSet.has(key) && value !== undefined
  );

  if (!entries.length) {
    return null;
  }

  const setSql = entries
    .map(([key], idx) => `${key} = $${idx + 2}`)
    .join(', ');

  const values = [id, ...entries.map(([, value]) => value)];

  const sql = `
    UPDATE ${schema}.${table}
    SET ${setSql}
    WHERE id = $1
    RETURNING *
  `;

  const { rows } = await client.query(sql, values);
  return rows[0] || null;
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
      comment: normalizeText(line.comment)
    }));
  }

  return [
    {
      item_id: toNumber(body.item_id),
      location_id: toNumber(body.location_id),
      qty: toNumber(body.qty),
      price: toNumber(body.price),
      comment: normalizeText(body.comment)
    }
  ];
}

router.get(
  '/',
  authRequired,
  requireRole('owner', 'client'),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const tenantId = getEffectiveTenantId(req);

      const dateFrom = normalizeText(req.query.date_from);
      const dateTo = normalizeText(req.query.date_to);
      const limit = Math.min(Math.max(toNumber(req.query.limit) || 100, 1), 500);

      const params = [tenantId];
      const where = ['s.tenant_id = $1'];

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
          s.payment_method,
          s.comment,
          s.created_by,
          s.created_at,
          cp.name AS counterparty_name,
          COALESCE(si_agg.total_qty, 0) AS total_qty,
          COALESCE(si_agg.total_amount, 0) AS total_amount,
          si_agg.item_names
        FROM core.sales s
        LEFT JOIN core.counterparties cp
          ON cp.id = s.counterparty_id
         AND cp.tenant_id = s.tenant_id
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(si.qty), 0) AS total_qty,
            COALESCE(SUM(si.line_amount), 0) AS total_amount,
            string_agg(DISTINCT i.name, ', ' ORDER BY i.name) AS item_names
          FROM core.sale_items si
          LEFT JOIN core.items i
            ON i.id = si.item_id
           AND i.tenant_id = si.tenant_id
          WHERE si.sale_id = s.id
            AND si.tenant_id = s.tenant_id
        ) si_agg ON TRUE
        WHERE ${where.join(' AND ')}
        ORDER BY s.id DESC
        LIMIT $${params.length}
      `;

      const { rows } = await client.query(sql, params);

      return res.json({
        ok: true,
        sales: rows
      });
    } catch (error) {
      console.error('[GET /sales] error:', error);
      return res.status(500).json({
        ok: false,
        error: 'sales_list_failed'
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/sell',
  authRequired,
  requireRole('owner', 'client'),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const tenantId = getEffectiveTenantId(req);
      const createdBy = req.user?.id ? Number(req.user.id) : null;

      const counterpartyId = toNumber(req.body.counterparty_id);
      const paymentMethod = normalizeText(req.body.payment_method) || 'cash';
      const saleType = normalizeText(req.body.sale_type);
      const isConsignment = req.body.is_consignment === true || req.body.is_consignment === 'true';
      const dueDate = normalizeText(req.body.due_date);
      const commonComment = normalizeText(req.body.comment);
      const paidAmountInput = toNumber(req.body.paid_amount);
      const bodyAmount = toNumber(req.body.amount);

      const linesInput = normalizeLinesFromBody(req.body);

      if (!linesInput.length) {
        return res.status(400).json({ ok: false, error: 'sale_items_required' });
      }

      for (const line of linesInput) {
        if (!line.item_id) {
          return res.status(400).json({ ok: false, error: 'item_required' });
        }
        if (!line.location_id) {
          return res.status(400).json({ ok: false, error: 'location_required' });
        }
        if (!isPositiveNumber(line.qty)) {
          return res.status(400).json({ ok: false, error: 'invalid_qty' });
        }
      }

      await client.query('BEGIN');

      if (counterpartyId) {
        const counterparty = await getCounterpartyById(client, tenantId, counterpartyId);
        if (!counterparty) {
          await client.query('ROLLBACK');
          return res.status(404).json({ ok: false, error: 'counterparty_not_found' });
        }
        if (counterparty.is_active === false) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'counterparty_inactive' });
        }
      }

      const preparedLines = [];
      let totalAmount = 0;

      for (const srcLine of linesInput) {
        const item = await getItemById(client, tenantId, srcLine.item_id);
        if (!item) {
          await client.query('ROLLBACK');
          return res.status(404).json({ ok: false, error: 'item_not_found', item_id: srcLine.item_id });
        }

        if (item.is_active === false) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'item_inactive', item_id: srcLine.item_id });
        }

        const location = await getLocationById(client, tenantId, srcLine.location_id);
        if (!location) {
          await client.query('ROLLBACK');
          return res.status(404).json({ ok: false, error: 'location_not_found', location_id: srcLine.location_id });
        }

        if (location.is_active === false) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'location_inactive', location_id: srcLine.location_id });
        }

        const stockRow = await getStockRowForUpdate(
          client,
          tenantId,
          srcLine.item_id,
          srcLine.location_id
        );

        if (!stockRow) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            ok: false,
            error: 'stock_not_found',
            item_id: srcLine.item_id,
            location_id: srcLine.location_id
          });
        }

        const availableQty = toNumber(stockRow.qty) || 0;
        if (availableQty < srcLine.qty) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            ok: false,
            error: 'insufficient_stock',
            item_id: srcLine.item_id,
            location_id: srcLine.location_id,
            available_qty: availableQty,
            requested_qty: srcLine.qty
          });
        }

        let finalPrice = srcLine.price;
        if (!isPositiveNumber(finalPrice)) {
          finalPrice = toNumber(item.sale_price);
        }

        if (!isPositiveNumber(finalPrice)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            ok: false,
            error: 'sale_price_not_set',
            item_id: srcLine.item_id,
            item_name: item.name
          });
        }

        const lineAmount = round2(finalPrice * srcLine.qty);
        if (!(lineAmount > 0)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            ok: false,
            error: 'invalid_sale_amount',
            item_id: srcLine.item_id
          });
        }

        preparedLines.push({
          item_id: srcLine.item_id,
          location_id: srcLine.location_id,
          qty: srcLine.qty,
          price: finalPrice,
          line_amount: lineAmount,
          item_name: item.name,
          location_name: location.name,
          location_code: location.code,
          comment: srcLine.comment || commonComment || null
        });

        totalAmount = round2(totalAmount + lineAmount);
      }

      if (!(totalAmount > 0)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          ok: false,
          error: 'sale_total_must_be_positive'
        });
      }

      const consignment = isConsignmentPayment(paymentMethod, saleType, isConsignment);

      let paidAmount = consignment ? 0 : totalAmount;

      if (paidAmountInput !== null) {
        if (paidAmountInput < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'invalid_paid_amount' });
        }
        if (paidAmountInput > totalAmount) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'paid_amount_exceeds_total' });
        }
        paidAmount = round2(paidAmountInput);
      } else if (bodyAmount !== null) {
        if (bodyAmount < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'invalid_amount' });
        }
        if (bodyAmount > totalAmount) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'amount_exceeds_total' });
        }
        paidAmount = round2(bodyAmount);
      }

      const debtAmount = round2(totalAmount - paidAmount);

      const saleRow = await insertDynamic(client, 'core', 'sales', {
        tenant_id: tenantId,
        counterparty_id: counterpartyId,
        payment_method: paymentMethod,
        total_amount: totalAmount,
        amount: totalAmount,
        comment: commonComment,
        created_by: createdBy,
        created_at: new Date(),
        updated_at: new Date()
      });

      const saleId = saleRow.id;

      const insertedSaleItems = [];

      for (const line of preparedLines) {
        const saleItem = await insertDynamic(client, 'core', 'sale_items', {
          tenant_id: tenantId,
          sale_id: saleId,
          item_id: line.item_id,
          qty: line.qty,
          price: line.price,
          line_amount: line.line_amount
        });

        insertedSaleItems.push(saleItem);

        await client.query(
          `
            UPDATE core.stock
            SET qty = qty - $1
            WHERE tenant_id = $2
              AND item_id = $3
              AND location_id = $4
          `,
          [line.qty, tenantId, line.item_id, line.location_id]
        );

        await insertDynamic(client, 'core', 'movements', {
          tenant_id: tenantId,
          item_id: line.item_id,
          location_id: line.location_id,
          movement_type: 'sale',
          qty: line.qty,
          comment:
            line.comment ||
            `Продажа #${saleId}${counterpartyId ? ` клиенту ${counterpartyId}` : ''}`,
          created_by: createdBy,
          created_at: new Date()
        });
      }

      let cashRow = null;
      if (paidAmount > 0) {
        cashRow = await insertDynamic(client, 'core', 'cash_transactions', {
          tenant_id: tenantId,
          transaction_type: 'income',
          category: 'sale',
          payment_method: paymentMethod,
          amount: paidAmount,
          counterparty_id: counterpartyId,
          sale_id: saleId,
          comment: commonComment,
          created_by: createdBy,
          created_at: new Date()
        });
      }

      let debtRow = null;
      if (debtAmount > 0) {
        debtRow = await insertDynamic(client, 'core', 'debts', {
          tenant_id: tenantId,
          counterparty_id: counterpartyId,
          sale_id: saleId,
          amount: debtAmount,
          status: paidAmount > 0 ? 'partial' : 'open',
          due_date: dueDate,
          comment: commonComment,
          created_by: createdBy,
          created_at: new Date(),
          updated_at: new Date()
        });

        if (debtRow && paidAmount > 0) {
          await updateDynamicById(client, 'core', 'debts', debtRow.id, {
            paid_amount: paidAmount
          });
        }
      }

      await client.query('COMMIT');

      return res.json({
        ok: true,
        sale: saleRow,
        sale_items: insertedSaleItems,
        cash_transaction: cashRow,
        debt: debtRow,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        debt_amount: debtAmount
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[POST /sales/sell] error:', error);

      return res.status(500).json({
        ok: false,
        error: 'sale_create_failed',
        details: error.message
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;