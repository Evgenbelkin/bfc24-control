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
                COALESCE(SUM(oi.requested_qty), 0) AS requested_total_qty,
                COALESCE(SUM(oi.picked_qty), 0) AS picked_total_qty,
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
            LEFT JOIN core.stock s
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
// body: approved_qty, picked_qty, final_price, comment, line_status
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
                    SELECT COALESCE(s.qty, 0) AS physical_qty
                    FROM core.showcase_order_items oi
                    LEFT JOIN core.stock s
                        ON s.item_id = oi.item_id
                       AND s.tenant_id = oi.tenant_id
                    WHERE oi.tenant_id = $1
                      AND oi.id = $2
                    LIMIT 1
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