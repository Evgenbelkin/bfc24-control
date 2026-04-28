// server/routes/notifications.js
// BFC24 CONTROL — Notification settings and logs

const express = require('express');
const pool = require('../db');
const { authRequired, getEffectiveTenantId } = require('../middleware/auth');
const {
  sendTelegramMessage,
  getTelegramSettings,
} = require('../services/telegram-notifier');

const router = express.Router();

function toBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

router.use(authRequired);

router.get('/settings', async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);

    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'tenant_id_required' });
    }

    const result = await pool.query(
      `
        SELECT
          tenant_id,
          CASE
            WHEN bot_token IS NULL OR bot_token = '' THEN ''
            ELSE CONCAT(LEFT(bot_token, 8), '***', RIGHT(bot_token, 5))
          END AS bot_token_masked,
          owner_chat_id,
          is_enabled,
          created_at,
          updated_at
        FROM core.telegram_settings
        WHERE tenant_id = $1
        LIMIT 1
      `,
      [tenantId]
    );

    const row = result.rows[0] || {
      tenant_id: tenantId,
      bot_token_masked: '',
      owner_chat_id: '',
      is_enabled: false,
      created_at: null,
      updated_at: null,
    };

    return res.json({
      ok: true,
      settings: row,
    });
  } catch (err) {
    console.error('[GET /notifications/settings] error:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);

    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'tenant_id_required' });
    }

    const botToken = typeof req.body.bot_token === 'string' ? req.body.bot_token.trim() : '';
    const ownerChatId = typeof req.body.owner_chat_id === 'string' ? req.body.owner_chat_id.trim() : '';
    const isEnabled = toBool(req.body.is_enabled);

    if (isEnabled && (!botToken || !ownerChatId)) {
      return res.status(400).json({
        ok: false,
        error: 'telegram_settings_required',
      });
    }

    const current = await getTelegramSettings(tenantId);

    const finalBotToken = botToken || (current && current.bot_token) || null;

    const result = await pool.query(
      `
        INSERT INTO core.telegram_settings
          (tenant_id, bot_token, owner_chat_id, is_enabled)
        VALUES
          ($1, $2, $3, $4)
        ON CONFLICT (tenant_id)
        DO UPDATE SET
          bot_token = EXCLUDED.bot_token,
          owner_chat_id = EXCLUDED.owner_chat_id,
          is_enabled = EXCLUDED.is_enabled,
          updated_at = NOW()
        RETURNING
          tenant_id,
          CASE
            WHEN bot_token IS NULL OR bot_token = '' THEN ''
            ELSE CONCAT(LEFT(bot_token, 8), '***', RIGHT(bot_token, 5))
          END AS bot_token_masked,
          owner_chat_id,
          is_enabled,
          created_at,
          updated_at
      `,
      [tenantId, finalBotToken, ownerChatId || null, isEnabled]
    );

    return res.json({
      ok: true,
      settings: result.rows[0],
    });
  } catch (err) {
    console.error('[POST /notifications/settings] error:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.post('/test', async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);

    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'tenant_id_required' });
    }

    const text = [
      '✅ <b>BFC24 CONTROL</b>',
      '',
      'Тестовое Telegram-уведомление успешно отправлено.',
      '',
      'Теперь сюда будут приходить уведомления о новых заказах с витрины.',
    ].join('\n');

    const result = await sendTelegramMessage({
      tenantId,
      text,
      eventType: 'telegram_test',
      meta: {
        source: 'notifications_settings',
      },
    });

    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.reason || 'telegram_send_failed',
        result,
      });
    }

    return res.json({
      ok: true,
      result,
    });
  } catch (err) {
    console.error('[POST /notifications/test] error:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.get('/logs', async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);

    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'tenant_id_required' });
    }

    const limitRaw = Number(req.query.limit || 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 100;

    const result = await pool.query(
      `
        SELECT
          id,
          tenant_id,
          event_type,
          channel,
          recipient,
          message_text,
          status,
          error_text,
          meta,
          created_at
        FROM core.notification_logs
        WHERE tenant_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `,
      [tenantId, limit]
    );

    return res.json({
      ok: true,
      logs: result.rows,
    });
  } catch (err) {
    console.error('[GET /notifications/logs] error:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

module.exports = router;
