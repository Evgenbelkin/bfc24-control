const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

const pool = require('../db');

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function buildLikeSearch(search) {
    return `%${String(search || '').trim()}%`;
}

// =========================================
// AUTH ПОКУПАТЕЛЯ
// POST /showcase/auth/login
// =========================================
router.post('/auth/login', async (req, res) => {
    try {
        const { login, password, tenant_id } = req.body;

        if (!login || !password || !tenant_id) {
            return res.status(400).json({ error: 'login_password_tenant_required' });
        }

        const result = await pool.query(
            `
            SELECT *
            FROM core.showcase_buyers
            WHERE tenant_id = $1
              AND login = $2
              AND is_active = TRUE
            LIMIT 1
            `,
            [tenant_id, login]
        );

        const buyer = result.rows[0];

        if (!buyer) {
            return res.status(401).json({ error: 'invalid_credentials' });
        }

        const ok = await bcrypt.compare(password, buyer.password_hash);

        if (!ok) {
            return res.status(401).json({ error: 'invalid_credentials' });
        }

        return res.json({
            ok: true,
            buyer: {
                id: buyer.id,
                tenant_id: buyer.tenant_id,
                name: buyer.name,
                login: buyer.login,
                phone: buyer.phone,
                email: buyer.email
            }
        });
    } catch (e) {
        console.error('[showcase/auth/login] error:', e);
        return res.status(500).json({ error: 'server_error' });
    }
});


// =========================================
// СПИСОК КАТЕГОРИЙ ВИТРИНЫ
// GET /showcase/categories?tenant_id=1
// =========================================
router.get('/categories', async (req, res) => {
    try {
        const tenantId = toNumber(req.query.tenant_id);

        if (!tenantId) {
            return res.status(400).json({ error: 'tenant_required' });
        }

        const settingsResult = await pool.query(
            `
            SELECT
                is_enabled,
                show_only_in_stock
            FROM core.showcase_settings
            WHERE tenant_id = $1
            LIMIT 1
            `,
            [tenantId]
        );

        if (!settingsResult.rows.length || !settingsResult.rows[0].is_enabled) {
            return res.status(403).json({ error: 'showcase_disabled' });
        }

        const settings = settingsResult.rows[0];

        const havingSql = settings.show_only_in_stock
            ? `HAVING (COALESCE(SUM(s.qty), 0) - COALESCE(SUM(CASE WHEN sr.status = 'active' THEN sr.qty ELSE 0 END), 0)) > 0`
            : '';

        const result = await pool.query(
            `
            SELECT
                COALESCE(NULLIF(TRIM(i.category), ''), 'Без категории') AS category
            FROM core.items i
            LEFT JOIN core.stock s
                ON s.item_id = i.id
               AND s.tenant_id = i.tenant_id
            LEFT JOIN core.stock_reservations sr
                ON sr.item_id = i.id
               AND sr.tenant_id = i.tenant_id
               AND sr.status = 'active'
            WHERE i.tenant_id = $1
            GROUP BY COALESCE(NULLIF(TRIM(i.category), ''), 'Без категории')
            ${havingSql}
            ORDER BY category ASC
            `,
            [tenantId]
        );

        return res.json({
            ok: true,
            items: result.rows.map((row) => row.category)
        });
    } catch (e) {
        console.error('[showcase/categories] error:', e);
        return res.status(500).json({ error: 'server_error' });
    }
});


// =========================================
// КАТАЛОГ
// GET /showcase/catalog?tenant_id=1&page=1&limit=20&search=...&category=...
// =========================================
router.get('/catalog', async (req, res) => {
    try {
        const tenantId = toNumber(req.query.tenant_id);
        const page = Math.max(1, toNumber(req.query.page, 1));
        const limit = Math.min(100, Math.max(1, toNumber(req.query.limit, 20)));
        const offset = (page - 1) * limit;
        const search = String(req.query.search || '').trim();
        const category = String(req.query.category || '').trim();

        if (!tenantId) {
            return res.status(400).json({ error: 'tenant_required' });
        }

        const settingsResult = await pool.query(
            `
            SELECT
                is_enabled,
                show_prices,
                show_only_in_stock
            FROM core.showcase_settings
            WHERE tenant_id = $1
            LIMIT 1
            `,
            [tenantId]
        );

        if (!settingsResult.rows.length || !settingsResult.rows[0].is_enabled) {
            return res.status(403).json({ error: 'showcase_disabled' });
        }

        const settings = settingsResult.rows[0];

        const filterParams = [tenantId];
        let whereSql = `
            WHERE i.tenant_id = $1
        `;

        if (search) {
            filterParams.push(buildLikeSearch(search));
            const searchParam = `$${filterParams.length}`;
            whereSql += `
                AND (
                    i.name ILIKE ${searchParam}
                    OR COALESCE(i.sku, '') ILIKE ${searchParam}
                    OR COALESCE(i.barcode, '') ILIKE ${searchParam}
                )
            `;
        }

        if (category) {
            filterParams.push(category);
            const categoryParam = `$${filterParams.length}`;

            if (category === 'Без категории') {
                whereSql += `
                    AND COALESCE(NULLIF(TRIM(i.category), ''), 'Без категории') = ${categoryParam}
                `;
            } else {
                whereSql += `
                    AND COALESCE(NULLIF(TRIM(i.category), ''), 'Без категории') = ${categoryParam}
                `;
            }
        }

        const havingSql = settings.show_only_in_stock
            ? `HAVING (COALESCE(SUM(s.qty), 0) - COALESCE(SUM(CASE WHEN sr.status = 'active' THEN sr.qty ELSE 0 END), 0)) > 0`
            : '';

        const listParams = [...filterParams, limit, offset];
        const limitParam = `$${listParams.length - 1}`;
        const offsetParam = `$${listParams.length}`;

        const listSql = `
            SELECT
                i.id,
                i.name,
                i.sku,
                i.barcode,
                i.image_url,
                COALESCE(NULLIF(TRIM(i.category), ''), 'Без категории') AS category,
                COALESCE(i.box_qty, 0) AS box_qty,
                COALESCE(SUM(s.qty), 0) AS physical_qty,
                COALESCE(SUM(CASE WHEN sr.status = 'active' THEN sr.qty ELSE 0 END), 0) AS reserved_qty,
                COALESCE(SUM(s.qty), 0) - COALESCE(SUM(CASE WHEN sr.status = 'active' THEN sr.qty ELSE 0 END), 0) AS available_qty,
                ${settings.show_prices ? 'COALESCE(i.sale_price, 0)' : 'NULL'} AS price
            FROM core.items i
            LEFT JOIN core.stock s
                ON s.item_id = i.id
               AND s.tenant_id = i.tenant_id
            LEFT JOIN core.stock_reservations sr
                ON sr.item_id = i.id
               AND sr.tenant_id = i.tenant_id
               AND sr.status = 'active'
            ${whereSql}
            GROUP BY i.id
            ${havingSql}
            ORDER BY i.name ASC, i.id ASC
            LIMIT ${limitParam} OFFSET ${offsetParam}
        `;

        const countSql = `
            SELECT COUNT(*)::INT AS total
            FROM (
                SELECT i.id
                FROM core.items i
                LEFT JOIN core.stock s
                    ON s.item_id = i.id
                   AND s.tenant_id = i.tenant_id
                LEFT JOIN core.stock_reservations sr
                    ON sr.item_id = i.id
                   AND sr.tenant_id = i.tenant_id
                   AND sr.status = 'active'
                ${whereSql}
                GROUP BY i.id
                ${havingSql}
            ) t
        `;

        const [listResult, countResult] = await Promise.all([
            pool.query(listSql, listParams),
            pool.query(countSql, filterParams)
        ]);

        return res.json({
            ok: true,
            page,
            limit,
            total: countResult.rows[0].total,
            show_prices: settings.show_prices,
            items: listResult.rows
        });
    } catch (e) {
        console.error('[showcase/catalog] error:', e);
        return res.status(500).json({ error: 'server_error' });
    }
});


// =========================================
// СОЗДАНИЕ ЗАКАЗА
// POST /showcase/orders
// body:
// {
//   "tenant_id": 1,
//   "buyer_id": 1,
//   "comment": "...",
//   "items": [
//     { "item_id": 10, "qty": 5, "base_price": 100 },
//     { "item_id": 11, "qty": 2 }
//   ]
// }
// =========================================
router.post('/orders', async (req, res) => {
    const client = await pool.connect();

    try {
        const tenantId = toNumber(req.body.tenant_id);
        const buyerId = toNumber(req.body.buyer_id);
        const comment = req.body.comment ? String(req.body.comment).trim() : null;
        const items = Array.isArray(req.body.items) ? req.body.items : [];

        if (!tenantId || !buyerId || !items.length) {
            return res.status(400).json({ error: 'invalid_payload' });
        }

        const badItem = items.find((item) => !toNumber(item.item_id) || toNumber(item.qty) <= 0);
        if (badItem) {
            return res.status(400).json({ error: 'invalid_order_items' });
        }

        await client.query('BEGIN');

        const settingsResult = await client.query(
            `
            SELECT is_enabled
            FROM core.showcase_settings
            WHERE tenant_id = $1
            LIMIT 1
            `,
            [tenantId]
        );

        if (!settingsResult.rows.length || !settingsResult.rows[0].is_enabled) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'showcase_disabled' });
        }

        const buyerResult = await client.query(
            `
            SELECT id
            FROM core.showcase_buyers
            WHERE tenant_id = $1
              AND id = $2
              AND is_active = TRUE
            LIMIT 1
            `,
            [tenantId, buyerId]
        );

        if (!buyerResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'buyer_not_found' });
        }

        const orderNoResult = await client.query(
            `
            SELECT 'SC-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0') AS order_no
            `
        );

        const orderNo = orderNoResult.rows[0].order_no;

        const orderResult = await client.query(
            `
            INSERT INTO core.showcase_orders (
                tenant_id,
                buyer_id,
                order_no,
                status,
                comment
            )
            VALUES ($1, $2, $3, 'new', $4)
            RETURNING id, order_no
            `,
            [tenantId, buyerId, orderNo, comment]
        );

        const orderId = orderResult.rows[0].id;

        for (const item of items) {
            const itemId = toNumber(item.item_id);
            const requestedQty = toNumber(item.qty);
            const basePrice = item.base_price !== undefined && item.base_price !== null && String(item.base_price) !== ''
                ? toNumber(item.base_price)
                : null;

            const itemExistsResult = await client.query(
                `
                SELECT id
                FROM core.items
                WHERE tenant_id = $1
                  AND id = $2
                LIMIT 1
                `,
                [tenantId, itemId]
            );

            if (!itemExistsResult.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'item_not_found', item_id: itemId });
            }

            await client.query(
                `
                INSERT INTO core.showcase_order_items (
                    tenant_id,
                    order_id,
                    item_id,
                    requested_qty,
                    reserved_qty,
                    approved_qty,
                    picked_qty,
                    base_price,
                    final_price,
                    line_status,
                    comment
                )
                VALUES ($1, $2, $3, $4, 0, NULL, 0, $5, NULL, 'new', NULL)
                `,
                [tenantId, orderId, itemId, requestedQty, basePrice]
            );
        }

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
            VALUES ($1, $2, 'order_created', NULL, $3, $4)
            `,
            [tenantId, orderId, comment, JSON.stringify({ source: 'showcase' })]
        );

        await client.query('COMMIT');

        return res.json({
            ok: true,
            order_id: orderId,
            order_no: orderResult.rows[0].order_no
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[showcase/orders] error:', e);
        return res.status(500).json({ error: 'server_error' });
    } finally {
        client.release();
    }
});


// =========================================
// МОИ ЗАКАЗЫ ПОКУПАТЕЛЯ
// GET /showcase/my-orders?tenant_id=1&buyer_id=2
// =========================================
router.get('/my-orders', async (req, res) => {
    try {
        const tenantId = toNumber(req.query.tenant_id);
        const buyerId = toNumber(req.query.buyer_id);

        if (!tenantId || !buyerId) {
            return res.status(400).json({ error: 'tenant_and_buyer_required' });
        }

        const result = await pool.query(
            `
            SELECT
                o.id,
                o.order_no,
                o.status,
                o.comment,
                o.created_at,
                o.ready_at,
                o.completed_at,
                o.cancelled_at,
                COALESCE(ss.title, 'Витрина') AS showcase_title,
                COALESCE(SUM(oi.requested_qty), 0) AS requested_total_qty,
                COALESCE(SUM(oi.picked_qty), 0) AS picked_total_qty,
                COUNT(oi.id)::INT AS lines_count
            FROM core.showcase_orders o
            LEFT JOIN core.showcase_order_items oi
                ON oi.order_id = o.id
               AND oi.tenant_id = o.tenant_id
            LEFT JOIN core.showcase_settings ss
                ON ss.tenant_id = o.tenant_id
            WHERE o.tenant_id = $1
              AND o.buyer_id = $2
            GROUP BY
                o.id,
                ss.title
            ORDER BY o.created_at DESC, o.id DESC
            `,
            [tenantId, buyerId]
        );

        return res.json({
            ok: true,
            items: result.rows
        });
    } catch (e) {
        console.error('[showcase/my-orders] error:', e);
        return res.status(500).json({ error: 'server_error' });
    }
});


// =========================================
// ДЕТАЛИ МОЕГО ЗАКАЗА
// GET /showcase/my-orders/:id?tenant_id=1&buyer_id=2
// =========================================
router.get('/my-orders/:id', async (req, res) => {
    try {
        const tenantId = toNumber(req.query.tenant_id);
        const buyerId = toNumber(req.query.buyer_id);
        const orderId = toNumber(req.params.id);

        if (!tenantId || !buyerId || !orderId) {
            return res.status(400).json({ error: 'tenant_buyer_order_required' });
        }

        const orderResult = await pool.query(
            `
            SELECT
                o.id,
                o.order_no,
                o.status,
                o.comment,
                o.created_at,
                o.ready_at,
                o.completed_at,
                o.cancelled_at,
                COALESCE(ss.title, 'Витрина') AS showcase_title
            FROM core.showcase_orders o
            LEFT JOIN core.showcase_settings ss
                ON ss.tenant_id = o.tenant_id
            WHERE o.tenant_id = $1
              AND o.buyer_id = $2
              AND o.id = $3
            LIMIT 1
            `,
            [tenantId, buyerId, orderId]
        );

        if (!orderResult.rows.length) {
            return res.status(404).json({ error: 'order_not_found' });
        }

        const itemsResult = await pool.query(
            `
            SELECT
                oi.id,
                oi.order_id,
                oi.item_id,
                oi.requested_qty,
                oi.approved_qty,
                oi.picked_qty,
                oi.final_price,
                oi.line_status,
                i.name AS item_name,
                i.sku,
                i.barcode,
                i.image_url,
                COALESCE(i.box_qty, 0) AS box_qty
            FROM core.showcase_order_items oi
            JOIN core.items i
                ON i.id = oi.item_id
               AND i.tenant_id = oi.tenant_id
            WHERE oi.tenant_id = $1
              AND oi.order_id = $2
            ORDER BY oi.id
            `,
            [tenantId, orderId]
        );

        return res.json({
            ok: true,
            order: orderResult.rows[0],
            items: itemsResult.rows
        });
    } catch (e) {
        console.error('[showcase/my-orders/:id] error:', e);
        return res.status(500).json({ error: 'server_error' });
    }
});

module.exports = router;
