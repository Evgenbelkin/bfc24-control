const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
const JWT_EXPIRES_IN = '7d';

function isSubscriptionExpired(subscriptionEndAt) {
  if (!subscriptionEndAt) return false;
  const end = new Date(subscriptionEndAt);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < Date.now();
}

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'username_and_password_required' });
    }

    const { rows } = await pool.query(
      `
      SELECT
        u.id,
        u.tenant_id,
        u.full_name,
        u.username,
        u.password_hash,
        u.role,
        u.is_active AS user_is_active,
        u.is_blocked AS user_is_blocked,
        t.name AS tenant_name,
        t.is_active AS tenant_is_active,
        t.is_blocked AS tenant_is_blocked,
        t.subscription_status,
        t.subscription_end_at
      FROM saas.users u
      LEFT JOIN saas.tenants t ON t.id = u.tenant_id
      WHERE u.username = $1
      LIMIT 1
      `,
      [username]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }

    if (!user.user_is_active) {
      return res.status(403).json({ ok: false, error: 'user_inactive' });
    }

    if (user.user_is_blocked) {
      return res.status(403).json({ ok: false, error: 'user_blocked' });
    }

    if (user.role !== 'owner') {
      if (!user.tenant_id || !user.tenant_name) {
        return res.status(403).json({ ok: false, error: 'tenant_not_found' });
      }

      if (!user.tenant_is_active) {
        return res.status(403).json({ ok: false, error: 'tenant_inactive' });
      }

      if (user.tenant_is_blocked) {
        return res.status(403).json({ ok: false, error: 'tenant_blocked' });
      }

      if (user.subscription_status === 'blocked') {
        return res.status(403).json({ ok: false, error: 'subscription_blocked' });
      }

      if (user.subscription_status === 'expired') {
        return res.status(403).json({ ok: false, error: 'subscription_expired' });
      }

      if (user.subscription_status === 'trial' && isSubscriptionExpired(user.subscription_end_at)) {
        return res.status(403).json({ ok: false, error: 'trial_expired' });
      }

      if (isSubscriptionExpired(user.subscription_end_at)) {
        return res.status(403).json({ ok: false, error: 'subscription_expired' });
      }
    }

    await pool.query(
      `UPDATE saas.users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [user.id]
    );

    const token = jwt.sign(
      {
        id: String(user.id),
        tenant_id: user.tenant_id != null ? String(user.tenant_id) : null,
        username: user.username,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      ok: true,
      token,
      user: {
        id: String(user.id),
        tenant_id: user.tenant_id != null ? String(user.tenant_id) : null,
        full_name: user.full_name,
        username: user.username,
        role: user.role,
        company_name: user.tenant_name || null
      }
    });
  } catch (error) {
    console.error('[POST /auth/login] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_server_error' });
  }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    return res.json({
      ok: true,
      user: req.user
    });
  } catch (error) {
    console.error('[GET /auth/me] error:', error);
    return res.status(500).json({ ok: false, error: 'internal_server_error' });
  }
});

module.exports = router;