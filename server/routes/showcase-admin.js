
ИМЯ ФАЙЛА:
server/routes/showcase-admin.js

НИЖЕ ПОЛНОЕ СОДЕРЖИМОЕ ФАЙЛА:
=====================================================

const express = require('express');
const router = express.Router();

const pool = require('../db');
const { authRequired, getEffectiveTenantId } = require('../middleware/auth');

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

// =========================================
// СПИСОК ЗАКАЗОВ
// =========================================
router.get('/orders', authRequired, async (req, res) => {
    try {
        const tenantId = getEffectiveTenantId(req);

        const result = await pool.query(
            `
            SELECT
                o.id,
                o.order_no,
                o.status,
                o.created_at,
                b.name AS buyer_name
            FROM core.showcase_orders o
            LEFT JOIN core.showcase_buyers b
                ON b.id = o.buyer_id
            WHERE o.tenant_id = $1
            ORDER BY o.created_at DESC
            `,
            [tenantId]
        );

        res.json({ ok: true, items: result.rows });
    } catch (e) {
        console.error('[showcase-admin/orders]', e);
        res.status(500).json({ error: 'server_error' });
    }
});

// =========================================
// ВЗЯТЬ В РАБОТУ
// =========================================
router.post('/orders/:id/take', authRequired, async (req, res) => {
    const client = await pool.connect();

    try {
        const tenantId = getEffectiveTenantId(req);
        const orderId = toNumber(req.params.id);
        const userId = req.user.id;

        await client.query('BEGIN');

        const order = await client.query(
            `
            SELECT * FROM core.showcase_orders
            WHERE id = $1 AND tenant_id = $2
            FOR UPDATE
            `,
            [orderId, tenantId]
        );

        if (!order.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'not_found' });
        }

        if (order.rows[0].status !== 'new') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'already_taken' });
        }

        await client.query(
            `
            UPDATE core.showcase_orders
            SET status='in_progress',
                taken_by_user_id=$2,
                taken_at=NOW()
            WHERE id=$1
            `,
            [orderId, userId]
        );

        await client.query('COMMIT');

        res.json({ ok: true });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: 'server_error' });
    } finally {
        client.release();
    }
});

// =========================================
// ОТМЕНА
// =========================================
router.post('/orders/:id/cancel', authRequired, async (req, res) => {
    try {
        const tenantId = getEffectiveTenantId(req);
        const orderId = toNumber(req.params.id);

        await pool.query(
            `
            UPDATE core.showcase_orders
            SET status='cancelled', cancelled_at=NOW()
            WHERE id=$1 AND tenant_id=$2
            `,
            [orderId, tenantId]
        );

        res.json({ ok: true });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'server_error' });
    }
});

module.exports = router;
