const express = require('express');
const router = express.Router();

const pool = require('../db');
const { authRequired, getEffectiveTenantId } = require('../middleware/auth');

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function buildLikeSearch(search) {
    return `%${String(search || '').trim()}%`;
}

async function getTableColumns(client, schemaName, tableName) {
    const result = await client.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
        ORDER BY ordinal_position
        `,
        [schemaName, tableName]
    );

    return result.rows.map((row) => row.column_name);
}

function hasColumn(columns, name) {
    return columns.includes(name);
}

function buildDynamicInsert(schemaName, tableName, rowData) {
    const keys = Object.keys(rowData);
    const columnsSql = keys.map((key) => `"${key}"`).join(', ');
    const valuesSql = keys.map((_, idx) => `$${idx + 1}`).join(', ');
    const values = keys.map((key) => rowData[key]);

    return {
        sql: `INSERT INTO ${schemaName}.${tableName} (${columnsSql}) VALUES (${valuesSql}) RETURNING *`,
        values
    };
}


async function getAggregatedStockQty(client, tenantId, itemId, lockRows = false) {
    if (lockRows) {
        const rowsResult = await client.query(
            `
            SELECT COALESCE(qty, 0) AS qty
            FROM core.stock
            WHERE tenant_id = $1
              AND item_id = $2
            FOR UPDATE
            `,
            [tenantId, itemId]
        );

        return rowsResult.rows.reduce((sum, row) => sum + toNumber(row.qty), 0);
    }

    const result = await client.query(
        `
        SELECT COALESCE(SUM(qty), 0) AS qty
        FROM core.stock
        WHERE tenant_id = $1
          AND item_id = $2
        `,
        [tenantId, itemId]
    );

    return result.rows.length ? toNumber(result.rows[0].qty) : 0;
}

async function consumeStockByItem(client, tenantId, itemId, qtyToConsume) {
    let remaining = toNumber(qtyToConsume);

    if (remaining <= 0) {
        return;
    }

    const stockRowsResult = await client.query(
        `
        SELECT
            ctid::TEXT AS row_ctid,
            COALESCE(qty, 0) AS qty
        FROM core.stock
        WHERE tenant_id = $1
          AND item_id = $2
          AND COALESCE(qty, 0) > 0
        ORDER BY qty DESC
        FOR UPDATE
        `,
        [tenantId, itemId]
    );

    const totalQty = stockRowsResult.rows.reduce((sum, row) => sum + toNumber(row.qty), 0);

    if (remaining > totalQty) {
        const error = new Error('not_enough_stock_for_sale');
        error.code = 'not_enough_stock_for_sale';
        error.physical_qty = totalQty;
        error.picked_qty = remaining;
        error.item_id = itemId;
        throw error;
    }

    for (const row of stockRowsResult.rows) {
        if (remaining <= 0) {
            break;
        }

        const rowQty = toNumber(row.qty);
        const consumeQty = Math.min(rowQty, remaining);

        await client.query(
            `
            UPDATE core.stock
            SET
                qty = qty - $1,
                updated_at = CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'core'
                          AND table_name = 'stock'
                          AND column_name = 'updated_at'
                    )
                    THEN NOW()
                    ELSE updated_at
                END
            WHERE ctid = $2::tid
            `,
            [consumeQty, row.row_ctid]
        );

        remaining -= consumeQty;
    }
}

async function insertMovementIfPossible(client, tenantId, item, qty, saleId, order) {
    const columns = await getTableColumns(client, 'core', 'movements');
    const data = {};

    if (hasColumn(columns, 'tenant_id')) data.tenant_id = tenantId;
    if (hasColumn(columns, 'item_id')) data.item_id = item.item_id;
    if (hasColumn(columns, 'movement_type')) data.movement_type = 'sale';
    if (hasColumn(columns, 'type')) data.type = 'sale';
    if (hasColumn(columns, 'qty')) data.qty = -Math.abs(qty);
    if (hasColumn(columns, 'quantity')) data.quantity = -Math.abs(qty);
    if (hasColumn(columns, 'source_type')) data.source_type = 'showcase_order';
    if (hasColumn(columns, 'source_id')) data.source_id = order.id;
    if (hasColumn(columns, 'ref_type')) data.ref_type = 'showcase_order';
    if (hasColumn(columns, 'ref_id')) data.ref_id = order.id;
    if (hasColumn(columns, 'sale_id')) data.sale_id = saleId;
    if (hasColumn(columns, 'comment')) data.comment = `Продажа из витрины #${order.order_no}`;
    if (hasColumn(columns, 'created_at')) data.created_at = new Date().toISOString();
    if (hasColumn(columns, 'updated_at')) data.updated_at = new Date().toISOString();

    if (!Object.keys(data).length) {
        return;
    }

    const insert = buildDynamicInsert('core', 'movements', data);
    await client.query(insert.sql, insert.values);
}

async function insertCashTransactionIfPossible(client, tenantId, saleId, amount, order, userId) {
    const columns = await getTableColumns(client, 'core', 'cash_transactions');
    const data = {};

    if (hasColumn(columns, 'tenant_id')) data.tenant_id = tenantId;
    if (hasColumn(columns, 'sale_id')) data.sale_id = saleId;
    if (hasColumn(columns, 'amount')) data.amount = amount;
    if (hasColumn(columns, 'transaction_type')) data.transaction_type = 'income';
    if (hasColumn(columns, 'type')) data.type = 'income';
    if (hasColumn(columns, 'direction')) data.direction = 'income';
    if (hasColumn(columns, 'payment_method')) data.payment_method = 'cash';
    if (hasColumn(columns, 'source_type')) data.source_type = 'showcase_order';
    if (hasColumn(columns, 'source_id')) data.source_id = order.id;
    if (hasColumn(columns, 'comment')) data.comment = `Оплата продажи из витрины #${order.order_no}`;
    if (hasColumn(columns, 'created_by')) data.created_by = userId;
    if (hasColumn(columns, 'created_at')) data.created_at = new Date().toISOString();
    if (hasColumn(columns, 'updated_at')) data.updated_at = new Date().toISOString();

    if (!Object.keys(data).length) {
        return;
    }

    try {
        const insert = buildDynamicInsert('core', 'cash_transactions', data);
        await client.query(insert.sql, insert.values);
    } catch (e) {
        console.warn('[showcase-admin/create-sale] cash transaction skipped:', e.message);
    }
}

async function getOrderWithItems(client, tenantId, orderId) {
    const orderResult = await client.query(
        `
        SELECT
            o.id,
            o.tenant_id,
            o.buyer_id,
            o.order_no,
            o.status,
            o.comment,
            o.taken_by_user_id,
            o.taken_at,
            o.reserved_at,
            o.ready_at,
            o.completed_at,
            o.cancelled_at,
            o.sale_id,
            o.created_at,
            o.updated_at,
            b.name AS buyer_name,
            b.login AS buyer_login,
            b.phone AS buyer_phone,
            u.full_name AS taken_by_name,
            u.username AS taken_by_username
        FROM core.showcase_orders o
        LEFT JOIN core.showcase_buyers b
            ON b.id = o.buyer_id
           AND b.tenant_id = o.tenant_id
        LEFT JOIN saas.users u
            ON u.id = o.taken_by_user_id
        WHERE o.tenant_id = $1
          AND o.id = $2
        LIMIT 1
        `,
        [tenantId, orderId]
    );

    if (!orderResult.rows.length) {
        return null;
    }

    const itemsResult = await client.query(
        `
        SELECT
            oi.id,
            oi.order_id,
            oi.item_id,
            oi.requested_qty,
            oi.reserved_qty,
            oi.approved_qty,
            oi.picked_qty,
            oi.base_price,
            oi.final_price,
            oi.line_status,
            oi.comment,
            oi.created_at,
            oi.updated_at,
            i.name AS item_name,
            i.sku,
            i.barcode,
            i.image_url,
            COALESCE(s.qty, 0) AS physical_qty,
            COALESCE((
                SELECT SUM(sr.qty)
                FROM core.stock_reservations sr
                WHERE sr.tenant_id = oi.tenant_id
                  AND sr.item_id = oi.item_id
                  AND sr.status = 'active'
            ), 0) AS total_reserved_qty,
            COALESCE(s.qty, 0) - COALESCE((
                SELECT SUM(sr.qty)
                FROM core.stock_reservations sr
                WHERE sr.tenant_id = oi.tenant_id
                  AND sr.item_id = oi.item_id
                  AND sr.status = 'active'
            ), 0) AS available_qty
        FROM core.showcase_order_items oi
        JOIN core.items i
            ON i.id = oi.item_id
           AND i.tenant_id = oi.tenant_id
        LEFT JOIN core.stock s
            ON s.item_id = oi.item_id
           AND s.tenant_id = oi.tenant_id
        WHERE oi.tenant_id = $1
          AND oi.order_id = $2
        ORDER BY oi.id
        `,
        [tenantId, orderId]
    );

    return {
        ...orderResult.rows[0],
        items: itemsResult.rows
    };
}

async function createEvent(client, tenantId, orderId, eventType, userId, comment = null, payload = null) {
    await client.query(
        `
        INSERT INTO core.showcase_order_events (
            tenant_id,
            order_id,
            event_type,
            user_id,
            comment,
            payload_json
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [tenantId, orderId, eventType, userId || null, comment, payload ? JSON.stringify(payload) : null]
    );
}

async function releaseActiveReservations(client, tenantId, orderId) {
    await client.query(
        `
        UPDATE core.stock_reservations
        SET
            status = 'released',
            released_at = NOW(),
            updated_at = NOW()
        WHERE tenant_id = $1
          AND order_id = $2
          AND status = 'active'
        `,
        [tenantId, orderId]
    );
}

async function recalcOrderStatus(client, tenantId, orderId) {
    const result = await client.query(
        `
        SELECT
            COUNT(*)::INT AS total_lines,
            COUNT(*) FILTER (WHERE line_status = 'picked')::INT AS picked_lines,
            COUNT(*) FILTER (WHERE line_status = 'partial')::INT AS partial_lines,
            COUNT(*) FILTER (WHERE line_status = 'cancelled')::INT AS cancelled_lines
        FROM core.showcase_order_items
        WHERE tenant_id = $1
          AND order_id = $2
        `,
        [tenantId, orderId]
    );

    const row = result.rows[0];
    const totalLines = Number(row.total_lines || 0);
    const pickedLines = Number(row.picked_lines || 0);
    const partialLines = Number(row.partial_lines || 0);
    const cancelledLines = Number(row.cancelled_lines || 0);

    if (totalLines === 0) {
        return null;
    }

    let status = 'in_progress';

    if (pickedLines + cancelledLines === totalLines) {
        status = 'ready';

        await client.query(
            `
            UPDATE core.showcase_orders
            SET
                status = 'ready',
                ready_at = COALESCE(ready_at, NOW()),
                updated_at = NOW()
            WHERE tenant_id = $1
              AND id = $2
            `,
            [tenantId, orderId]
        );

        return status;
    }

    if (pickedLines > 0 || partialLines > 0) {
        status = 'partially_picked';
    }

    await client.query(
        `
        UPDATE core.showcase_orders
        SET
            status = $3,
            updated_at = NOW()
        WHERE tenant_id = $1
          AND id = $2
        `,
        [tenantId, orderId, status]
    );

    return status;
}

// =========================================
// СПИСОК ЗАКАЗОВ
// GET /showcase-admin/orders
// =========================================
router.get('/orders', authRequired, async (req, res) => {
    try {
        const tenantId = getEffectiveTenantId(req);
        const page = Math.max(1, toNumber(req.query.page, 1));
        const limit = Math.min(100, Math.max(1, toNumber(req.query.limit, 20)));
        const offset = (page - 1) * limit;
        const status = String(req.query.status || '').trim();
        const search = String(req.query.search || '').trim();

        const filterParams = [tenantId];
        let whereSql = `WHERE o.tenant_id = $1`;

        if (status) {
            filterParams.push(status);
            whereSql += ` AND o.status = $${filterParams.length}`;
        }

        if (search) {
            filterParams.push(buildLikeSearch(search));
            const searchParam = `$${filterParams.length}`;
            whereSql += `
                AND (
                    o.order_no ILIKE ${searchParam}
                    OR b.name ILIKE ${searchParam}
                    OR COALESCE(b.phone, '') ILIKE ${searchParam}
                )
            `;
        }

        const listParams = [...filterParams, limit, offset];
        const limitParam = `$${listParams.length - 1}`;
        const offsetParam = `$${listParams.length}`;

        const listSql = `
            SELECT
                o.id,
                o.order_no,
                o.status,
                o.comment,
                o.taken_by_user_id,
                o.taken_at,
                o.ready_at,
                o.completed_at,
                o.cancelled_at,
                o.created_at,
                o.updated_at,
                b.id AS buyer_id,
                b.name AS buyer_name,
                b.phone AS buyer_phone,
                u.full_name AS taken_by_name,
                u.username AS taken_by_username,
                COALESCE(SUM(oi.requested_qty), 0) AS requested_plan_total_qty,
                COALESCE(SUM(oi.picked_qty), 0) AS picked_total_qty,
                CASE
                    WHEN COALESCE(SUM(oi.picked_qty), 0) > 0
                        THEN COALESCE(SUM(oi.picked_qty), 0)
                    ELSE COALESCE(SUM(oi.requested_qty), 0)
                END AS requested_total_qty,
                COUNT(oi.id)::INT AS lines_count
            FROM core.showcase_orders o
            LEFT JOIN core.showcase_buyers b
                ON b.id = o.buyer_id
               AND b.tenant_id = o.tenant_id
            LEFT JOIN saas.users u
                ON u.id = o.taken_by_user_id
            LEFT JOIN core.showcase_order_items oi
                ON oi.order_id = o.id
               AND oi.tenant_id = o.tenant_id
            ${whereSql}
            GROUP BY
                o.id,
                b.id,
                b.name,
                b.phone,
                u.full_name,
                u.username
            ORDER BY o.created_at DESC, o.id DESC
            LIMIT ${limitParam} OFFSET ${offsetParam}
        `;

        const countSql = `
            SELECT COUNT(*)::INT AS total
            FROM core.showcase_orders o
            LEFT JOIN core.showcase_buyers b
                ON b.id = o.buyer_id
               AND b.tenant_id = o.tenant_id
            ${whereSql}
        `;

        const [listResult, countResult] = await Promise.all([
            pool.query(listSql, listParams),
            pool.query(countSql, filterParams)
        ]);

        res.json({
            ok: true,
            page,
            limit,
            total: countResult.rows[0].total,
            items: listResult.rows
        });
    } catch (e) {
        console.error('[showcase-admin/orders]', e);
        res.status(500).json({ error: 'server_error' });
    }
});

// =========================================
// КАРТОЧКА ЗАКАЗА
// GET /showcase-admin/orders/:id
// =========================================
router.get('/orders/:id', authRequired, async (req, res) => {
    const client = await pool.connect();

    try {
        const tenantId = getEffectiveTenantId(req);
        const orderId = toNumber(req.params.id);

        const order = await getOrderWithItems(client, tenantId, orderId);

        if (!order) {
            return res.status(404).json({ error: 'order_not_found' });
        }

        res.json({
            ok: true,
            order
        });
    } catch (e) {
        console.error('[showcase-admin/orders/:id]', e);
        res.status(500).json({ error: 'server_error' });
    } finally {
        client.release();
    }
});

// =========================================
// ВЗЯТЬ ЗАКАЗ В РАБОТУ + СОЗДАТЬ РЕЗЕРВ
// POST /showcase-admin/orders/:id/take
// =========================================
router.post('/orders/:id/take', authRequired, async (req, res) => {
    const client = await pool.connect();

    try {
        const tenantId = getEffectiveTenantId(req);
        const orderId = toNumber(req.params.id);
        const userId = req.user && req.user.id ? req.user.id : null;

        await client.query('BEGIN');

        const orderResult = await client.query(
            `
            SELECT *
            FROM core.showcase_orders
            WHERE tenant_id = $1
              AND id = $2
            FOR UPDATE
            `,
            [tenantId, orderId]
        );

        if (!orderResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'order_not_found' });
        }

        const order = orderResult.rows[0];

        if (order.status !== 'new') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'order_already_taken_or_not_new' });
        }

        const itemsResult = await client.query(
            `
            SELECT
                oi.id,
                oi.item_id,
                oi.requested_qty,
                COALESCE(s.qty, 0) AS physical_qty,
                COALESCE((
                    SELECT SUM(sr.qty)
                    FROM core.stock_reservations sr
                    WHERE sr.tenant_id = oi.tenant_id
                      AND sr.item_id = oi.item_id
                      AND sr.status = 'active'
                ), 0) AS total_reserved_qty
            FROM core.showcase_order_items oi
            LEFT JOIN (
                SELECT
                    tenant_id,
                    item_id,
                    SUM(qty) AS qty
                FROM core.stock
                GROUP BY tenant_id, item_id
            ) s
                ON s.item_id = oi.item_id
               AND s.tenant_id = oi.tenant_id
            WHERE oi.tenant_id = $1
              AND oi.order_id = $2
            ORDER BY oi.id
            `,
            [tenantId, orderId]
        );

        for (const row of itemsResult.rows) {
            const physicalQty = toNumber(row.physical_qty);
            const totalReservedQty = toNumber(row.total_reserved_qty);
            const availableQty = physicalQty - totalReservedQty;
            const reserveQty = Math.max(0, Math.min(toNumber(row.requested_qty), availableQty));

            if (reserveQty > 0) {
                await client.query(
                    `
                    INSERT INTO core.stock_reservations (
                        tenant_id,
                        order_id,
                        order_item_id,
                        item_id,
                        qty,
                        status,
                        reserved_by_user_id,
                        reserved_at
                    )
                    VALUES ($1, $2, $3, $4, $5, 'active', $6, NOW())
                    `,
                    [tenantId, orderId, row.id, row.item_id, reserveQty, userId]
                );
            }

            await client.query(
                `
                UPDATE core.showcase_order_items
                SET
                    reserved_qty = $3,
                    approved_qty = COALESCE(approved_qty, $3),
                    line_status = CASE
                        WHEN $3 > 0 THEN 'approved'
                        ELSE line_status
                    END,
                    updated_at = NOW()
                WHERE tenant_id = $1
                  AND id = $2
                `,
                [tenantId, row.id, reserveQty]
            );
        }

        await client.query(
            `
            UPDATE core.showcase_orders
            SET
                status = 'in_progress',
                taken_by_user_id = $3,
                taken_at = NOW(),
                reserved_at = NOW(),
                updated_at = NOW()
            WHERE tenant_id = $1
              AND id = $2
            `,
            [tenantId, orderId, userId]
        );

        await createEvent(client, tenantId, orderId, 'order_taken', userId);

        await client.query('COMMIT');

        const freshOrder = await getOrderWithItems(client, tenantId, orderId);

        res.json({
            ok: true,
            order: freshOrder
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[showcase-admin/orders/:id/take]', e);
        res.status(500).json({ error: 'server_error' });
    } finally {
        client.release();
    }
});

// =========================================
// ОБНОВЛЕНИЕ СТРОКИ ЗАКАЗА
// PATCH /showcase-admin/orders/:orderId/items/:itemRowId
// =========================================
router.patch('/orders/:orderId/items/:itemRowId', authRequired, async (req, res) => {
    const client = await pool.connect();

    try {
        const tenantId = getEffectiveTenantId(req);
        const orderId = toNumber(req.params.orderId);
        const itemRowId = toNumber(req.params.itemRowId);
        const userId = req.user && req.user.id ? req.user.id : null;

        const approvedQtyRaw = req.body.approved_qty;
        const pickedQtyRaw = req.body.picked_qty;
        const finalPriceRaw = req.body.final_price;
        const lineStatusRaw = req.body.line_status;
        const commentRaw = req.body.comment;

        await client.query('BEGIN');

        const orderResult = await client.query(
            `
            SELECT *
            FROM core.showcase_orders
            WHERE tenant_id = $1
              AND id = $2
            FOR UPDATE
            `,
            [tenantId, orderId]
        );

        if (!orderResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'order_not_found' });
        }

        const order = orderResult.rows[0];

        if (!['in_progress', 'partially_picked', 'ready'].includes(order.status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'order_not_editable' });
        }

        const itemResult = await client.query(
            `
            SELECT *
            FROM core.showcase_order_items
            WHERE tenant_id = $1
              AND order_id = $2
              AND id = $3
            FOR UPDATE
            `,
            [tenantId, orderId, itemRowId]
        );

        if (!itemResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'order_item_not_found' });
        }

        const itemRow = itemResult.rows[0];

        const approvedQty = approvedQtyRaw !== undefined && approvedQtyRaw !== null
            ? Math.max(0, toNumber(approvedQtyRaw))
            : (itemRow.approved_qty !== null ? toNumber(itemRow.approved_qty) : toNumber(itemRow.reserved_qty));

        const pickedQty = pickedQtyRaw !== undefined && pickedQtyRaw !== null
            ? Math.max(0, toNumber(pickedQtyRaw))
            : toNumber(itemRow.picked_qty);

        const finalPrice = finalPriceRaw !== undefined && finalPriceRaw !== null && String(finalPriceRaw) !== ''
            ? Math.max(0, toNumber(finalPriceRaw))
            : itemRow.final_price;

        let lineStatus = String(lineStatusRaw || '').trim();
        if (!lineStatus) {
            if (pickedQty <= 0) {
                lineStatus = approvedQty > 0 ? 'approved' : 'cancelled';
            } else if (approvedQty > 0 && pickedQty < approvedQty) {
                lineStatus = 'partial';
            } else {
                lineStatus = 'picked';
            }
        }

        if (!['new', 'approved', 'picked', 'partial', 'cancelled'].includes(lineStatus)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'invalid_line_status' });
        }

        const currentReservedResult = await client.query(
            `
            SELECT id, qty
            FROM core.stock_reservations
            WHERE tenant_id = $1
              AND order_id = $2
              AND order_item_id = $3
              AND status = 'active'
            ORDER BY id
            FOR UPDATE
            `,
            [tenantId, orderId, itemRowId]
        );

        const currentReservedQty = currentReservedResult.rows.reduce((sum, row) => sum + toNumber(row.qty), 0);

        if (approvedQty !== currentReservedQty) {
            if (approvedQty > currentReservedQty) {
                const diff = approvedQty - currentReservedQty;

                const stockResult = await client.query(
                    `
                    SELECT COALESCE(SUM(s.qty), 0) AS physical_qty
                    FROM core.showcase_order_items oi
                    LEFT JOIN core.stock s
                        ON s.item_id = oi.item_id
                       AND s.tenant_id = oi.tenant_id
                    WHERE oi.tenant_id = $1
                      AND oi.id = $2
                    GROUP BY oi.id
                    `,
                    [tenantId, itemRowId]
                );

                const physicalQty = stockResult.rows.length ? toNumber(stockResult.rows[0].physical_qty) : 0;

                const allReservedResult = await client.query(
                    `
                    SELECT COALESCE(SUM(qty), 0) AS total_reserved_qty
                    FROM core.stock_reservations
                    WHERE tenant_id = $1
                      AND item_id = $2
                      AND status = 'active'
                    `,
                    [tenantId, itemRow.item_id]
                );

                const totalReservedQty = toNumber(allReservedResult.rows[0].total_reserved_qty);
                const availableQty = physicalQty - totalReservedQty;

                if (diff > availableQty) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'not_enough_available_stock_for_reserve' });
                }

                await client.query(
                    `
                    INSERT INTO core.stock_reservations (
                        tenant_id,
                        order_id,
                        order_item_id,
                        item_id,
                        qty,
                        status,
                        reserved_by_user_id,
                        reserved_at
                    )
                    VALUES ($1, $2, $3, $4, $5, 'active', $6, NOW())
                    `,
                    [tenantId, orderId, itemRowId, itemRow.item_id, diff, userId]
                );
            } else {
                let needRelease = currentReservedQty - approvedQty;

                for (const reservation of currentReservedResult.rows) {
                    if (needRelease <= 0) {
                        break;
                    }

                    const reservationQty = toNumber(reservation.qty);

                    if (reservationQty <= needRelease) {
                        await client.query(
                            `
                            UPDATE core.stock_reservations
                            SET
                                status = 'released',
                                released_at = NOW(),
                                updated_at = NOW()
                            WHERE id = $1
                            `,
                            [reservation.id]
                        );
                        needRelease -= reservationQty;
                    } else {
                        await client.query(
                            `
                            UPDATE core.stock_reservations
                            SET
                                qty = qty - $2,
                                updated_at = NOW()
                            WHERE id = $1
                            `,
                            [reservation.id, needRelease]
                        );
                        needRelease = 0;
                    }
                }
            }
        }

        await client.query(
            `
            UPDATE core.showcase_order_items
            SET
                reserved_qty = $4,
                approved_qty = $5,
                picked_qty = $6,
                final_price = $7,
                line_status = $8,
                comment = $9,
                updated_at = NOW()
            WHERE tenant_id = $1
              AND order_id = $2
              AND id = $3
            `,
            [
                tenantId,
                orderId,
                itemRowId,
                approvedQty,
                approvedQty,
                pickedQty,
                finalPrice,
                lineStatus,
                commentRaw !== undefined ? commentRaw : itemRow.comment
            ]
        );

        await createEvent(client, tenantId, orderId, 'order_item_updated', userId, null, {
            order_item_id: itemRowId,
            approved_qty: approvedQty,
            picked_qty: pickedQty,
            final_price: finalPrice,
            line_status: lineStatus
        });

        const newOrderStatus = await recalcOrderStatus(client, tenantId, orderId);

        await client.query('COMMIT');

        const freshOrder = await getOrderWithItems(client, tenantId, orderId);

        res.json({
            ok: true,
            order_status: newOrderStatus,
            order: freshOrder
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[showcase-admin/orders/:orderId/items/:itemRowId]', e);
        res.status(500).json({ error: 'server_error' });
    } finally {
        client.release();
    }
});

// =========================================
// ПЕРЕВЕСТИ В ГОТОВ
// POST /showcase-admin/orders/:id/ready
// =========================================
router.post('/orders/:id/ready', authRequired, async (req, res) => {
    const client = await pool.connect();

    try {
        const tenantId = getEffectiveTenantId(req);
        const orderId = toNumber(req.params.id);
        const userId = req.user && req.user.id ? req.user.id : null;

        await client.query('BEGIN');

        const orderResult = await client.query(
            `
            SELECT *
            FROM core.showcase_orders
            WHERE tenant_id = $1
              AND id = $2
            FOR UPDATE
            `,
            [tenantId, orderId]
        );

        if (!orderResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'order_not_found' });
        }

        const order = orderResult.rows[0];

        if (!['in_progress', 'partially_picked', 'ready'].includes(order.status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'order_not_ready_for_this_action' });
        }

        const statResult = await client.query(
            `
            SELECT
                COUNT(*)::INT AS total_lines,
                COUNT(*) FILTER (WHERE picked_qty > 0)::INT AS picked_lines,
                COUNT(*) FILTER (WHERE line_status = 'partial')::INT AS partial_lines
            FROM core.showcase_order_items
            WHERE tenant_id = $1
              AND order_id = $2
            `,
            [tenantId, orderId]
        );

        const stat = statResult.rows[0];
        const totalLines = Number(stat.total_lines || 0);
        const pickedLines = Number(stat.picked_lines || 0);
        const partialLines = Number(stat.partial_lines || 0);

        if (totalLines <= 0 || (pickedLines <= 0 && partialLines <= 0)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'nothing_picked_yet' });
        }

        await client.query(
            `
            UPDATE core.showcase_orders
            SET
                status = 'ready',
                ready_at = NOW(),
                updated_at = NOW()
            WHERE tenant_id = $1
              AND id = $2
            `,
            [tenantId, orderId]
        );

        await createEvent(client, tenantId, orderId, 'order_ready', userId);

        await client.query('COMMIT');

        const freshOrder = await getOrderWithItems(client, tenantId, orderId);

        res.json({
            ok: true,
            order: freshOrder
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[showcase-admin/orders/:id/ready]', e);
        res.status(500).json({ error: 'server_error' });
    } finally {
        client.release();
    }
});

// =========================================
// СОЗДАТЬ ПРОДАЖУ ИЗ ЗАКАЗА
// POST /showcase-admin/orders/:id/create-sale
// =========================================
router.post('/orders/:id/create-sale', authRequired, async (req, res) => {
    const client = await pool.connect();

    try {
        const tenantId = getEffectiveTenantId(req);
        const orderId = toNumber(req.params.id);
        const userId = req.user && req.user.id ? req.user.id : null;

        await client.query('BEGIN');

        const orderResult = await client.query(
            `
            SELECT *
            FROM core.showcase_orders
            WHERE tenant_id = $1
              AND id = $2
            FOR UPDATE
            `,
            [tenantId, orderId]
        );

        if (!orderResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'order_not_found' });
        }

        const order = orderResult.rows[0];

        if (order.status !== 'ready') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'order_not_ready_for_sale' });
        }

        if (order.sale_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'sale_already_created' });
        }

        const itemsResult = await client.query(
            `
            SELECT
                oi.*,
                i.name AS item_name,
                i.sku,
                i.barcode
            FROM core.showcase_order_items oi
            JOIN core.items i
              ON i.id = oi.item_id
             AND i.tenant_id = oi.tenant_id
            WHERE oi.tenant_id = $1
              AND oi.order_id = $2
              AND COALESCE(oi.picked_qty, 0) > 0
            ORDER BY oi.id
            `,
            [tenantId, orderId]
        );

        if (!itemsResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'no_picked_items_for_sale' });
        }

        // Проверка остатков перед списанием.
        // У одного товара может быть несколько строк core.stock по разным МХ.
        // Поэтому остаток считаем суммарно, а не через одну произвольную строку.
        for (const item of itemsResult.rows) {
            const physicalQty = await getAggregatedStockQty(client, tenantId, item.item_id, true);
            const pickedQty = toNumber(item.picked_qty);

            if (pickedQty > physicalQty) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'not_enough_stock_for_sale',
                    item_id: item.item_id,
                    physical_qty: physicalQty,
                    picked_qty: pickedQty
                });
            }
        }

        const salesColumns = await getTableColumns(client, 'core', 'sales');
        const saleItemsColumns = await getTableColumns(client, 'core', 'sale_items');

        let totalAmount = 0;
        for (const item of itemsResult.rows) {
            const linePrice = toNumber(item.final_price, toNumber(item.base_price, 0));
            const lineQty = toNumber(item.picked_qty, 0);
            totalAmount += linePrice * lineQty;
        }

        const saleData = {};

        if (hasColumn(salesColumns, 'tenant_id')) saleData.tenant_id = tenantId;
        if (hasColumn(salesColumns, 'sale_date')) saleData.sale_date = new Date().toISOString();
        if (hasColumn(salesColumns, 'comment')) saleData.comment = `Создано из showcase order #${order.order_no}`;
        if (hasColumn(salesColumns, 'sale_type')) saleData.sale_type = 'retail';
        if (hasColumn(salesColumns, 'payment_status')) saleData.payment_status = 'paid';
        if (hasColumn(salesColumns, 'payment_method')) saleData.payment_method = 'cash';
        if (hasColumn(salesColumns, 'total_amount')) saleData.total_amount = totalAmount;
        if (hasColumn(salesColumns, 'total')) saleData.total = totalAmount;
        if (hasColumn(salesColumns, 'revenue')) saleData.revenue = totalAmount;
        if (hasColumn(salesColumns, 'created_at')) saleData.created_at = new Date().toISOString();
        if (hasColumn(salesColumns, 'updated_at')) saleData.updated_at = new Date().toISOString();
        if (hasColumn(salesColumns, 'created_by')) saleData.created_by = userId;

        if (Object.keys(saleData).length === 0) {
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'sales_schema_not_supported' });
        }

        const saleInsert = buildDynamicInsert('core', 'sales', saleData);
        const saleResult = await client.query(saleInsert.sql, saleInsert.values);

        if (!saleResult.rows.length || !saleResult.rows[0].id) {
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'sale_not_created' });
        }

        const saleId = saleResult.rows[0].id;

        for (const item of itemsResult.rows) {
            const lineQty = toNumber(item.picked_qty, 0);
            const linePrice = toNumber(item.final_price, toNumber(item.base_price, 0));
            const lineTotal = lineQty * linePrice;

            const saleItemData = {};

            if (hasColumn(saleItemsColumns, 'sale_id')) saleItemData.sale_id = saleId;
            if (hasColumn(saleItemsColumns, 'tenant_id')) saleItemData.tenant_id = tenantId;
            if (hasColumn(saleItemsColumns, 'item_id')) saleItemData.item_id = item.item_id;
            if (hasColumn(saleItemsColumns, 'qty')) saleItemData.qty = lineQty;
            if (hasColumn(saleItemsColumns, 'quantity')) saleItemData.quantity = lineQty;
            if (hasColumn(saleItemsColumns, 'price')) saleItemData.price = linePrice;
            if (hasColumn(saleItemsColumns, 'unit_price')) saleItemData.unit_price = linePrice;
            if (hasColumn(saleItemsColumns, 'total_amount')) saleItemData.total_amount = lineTotal;
            if (hasColumn(saleItemsColumns, 'total')) saleItemData.total = lineTotal;
            if (hasColumn(saleItemsColumns, 'line_total')) saleItemData.line_total = lineTotal;
            if (hasColumn(saleItemsColumns, 'line_amount')) saleItemData.line_amount = lineTotal;
            if (hasColumn(saleItemsColumns, 'name')) saleItemData.name = item.item_name;
            if (hasColumn(saleItemsColumns, 'sku')) saleItemData.sku = item.sku;
            if (hasColumn(saleItemsColumns, 'barcode')) saleItemData.barcode = item.barcode;
            if (hasColumn(saleItemsColumns, 'created_at')) saleItemData.created_at = new Date().toISOString();
            if (hasColumn(saleItemsColumns, 'updated_at')) saleItemData.updated_at = new Date().toISOString();

            const saleItemInsert = buildDynamicInsert('core', 'sale_items', saleItemData);
            await client.query(saleItemInsert.sql, saleItemInsert.values);

            await consumeStockByItem(client, tenantId, item.item_id, lineQty);
            await insertMovementIfPossible(client, tenantId, item, lineQty, saleId, order);
        }

        await insertCashTransactionIfPossible(client, tenantId, saleId, totalAmount, order, userId);

        await client.query(
            `
            UPDATE core.stock_reservations
            SET
                status = 'consumed',
                consumed_at = NOW(),
                updated_at = NOW()
            WHERE tenant_id = $1
              AND order_id = $2
              AND status = 'active'
            `,
            [tenantId, orderId]
        );

        await client.query(
            `
            UPDATE core.showcase_orders
            SET
                status = 'completed',
                completed_at = NOW(),
                sale_id = $3,
                updated_at = NOW()
            WHERE tenant_id = $1
              AND id = $2
            `,
            [tenantId, orderId, saleId]
        );

        await createEvent(client, tenantId, orderId, 'sale_created', userId, null, {
            sale_id: saleId,
            total_amount: totalAmount
        });

        await client.query('COMMIT');

        const freshOrder = await getOrderWithItems(client, tenantId, orderId);

        res.json({
            ok: true,
            sale_id: saleId,
            total_amount: totalAmount,
            order: freshOrder
        });
    } catch (e) {
        await client.query('ROLLBACK');

        if (e && e.code === 'not_enough_stock_for_sale') {
            return res.status(400).json({
                error: 'not_enough_stock_for_sale',
                item_id: e.item_id,
                physical_qty: e.physical_qty,
                picked_qty: e.picked_qty
            });
        }

        console.error('[showcase-admin/orders/:id/create-sale]', e);
        res.status(500).json({ error: 'server_error', message: e.message });
    } finally {
        client.release();
    }
});

// =========================================
// ОТМЕНА ЗАКАЗА
// POST /showcase-admin/orders/:id/cancel
// =========================================
router.post('/orders/:id/cancel', authRequired, async (req, res) => {
    const client = await pool.connect();

    try {
        const tenantId = getEffectiveTenantId(req);
        const orderId = toNumber(req.params.id);
        const userId = req.user && req.user.id ? req.user.id : null;
        const comment = req.body && req.body.comment ? String(req.body.comment).trim() : null;

        await client.query('BEGIN');

        const orderResult = await client.query(
            `
            SELECT *
            FROM core.showcase_orders
            WHERE tenant_id = $1
              AND id = $2
            FOR UPDATE
            `,
            [tenantId, orderId]
        );

        if (!orderResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'order_not_found' });
        }

        const order = orderResult.rows[0];

        if (['completed', 'cancelled'].includes(order.status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'order_not_cancellable' });
        }

        await releaseActiveReservations(client, tenantId, orderId);

        await client.query(
            `
            UPDATE core.showcase_order_items
            SET
                line_status = 'cancelled',
                reserved_qty = 0,
                updated_at = NOW()
            WHERE tenant_id = $1
              AND order_id = $2
            `,
            [tenantId, orderId]
        );

        await client.query(
            `
            UPDATE core.showcase_orders
            SET
                status = 'cancelled',
                cancelled_at = NOW(),
                updated_at = NOW()
            WHERE tenant_id = $1
              AND id = $2
            `,
            [tenantId, orderId]
        );

        await createEvent(client, tenantId, orderId, 'order_cancelled', userId, comment);

        await client.query('COMMIT');

        const freshOrder = await getOrderWithItems(client, tenantId, orderId);

        res.json({
            ok: true,
            order: freshOrder
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[showcase-admin/orders/:id/cancel]', e);
        res.status(500).json({ error: 'server_error' });
    } finally {
        client.release();
    }
});

module.exports = router;