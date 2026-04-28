// server/services/telegram-notifier.js
// BFC24 CONTROL — Telegram Notification Agent

const pool = require('../db');

function safeText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeMoney(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

async function logNotification({
  tenantId,
  eventType,
  channel = 'telegram',
  recipient = null,
  messageText = '',
  status = 'pending',
  errorText = null,
  meta = {},
}) {
  try {
    await pool.query(
      `
        INSERT INTO core.notification_logs
          (tenant_id, event_type, channel, recipient, message_text, status, error_text, meta)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        tenantId,
        eventType,
        channel,
        recipient,
        messageText,
        status,
        errorText,
        JSON.stringify(meta || {}),
      ]
    );
  } catch (err) {
    console.error('[notification log error]', err);
  }
}

async function getTelegramSettings(tenantId) {
  const result = await pool.query(
    `
      SELECT
        tenant_id,
        bot_token,
        owner_chat_id,
        is_enabled
      FROM core.telegram_settings
      WHERE tenant_id = $1
      LIMIT 1
    `,
    [tenantId]
  );

  return result.rows[0] || null;
}

async function sendTelegramRaw({ botToken, chatId, text }) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data || data.ok !== true) {
    const description =
      data && data.description
        ? data.description
        : `Telegram API error: HTTP ${response.status}`;

    const err = new Error(description);
    err.telegramResponse = data;
    throw err;
  }

  return data;
}

async function sendTelegramMessage({ tenantId, text, eventType = 'manual', meta = {} }) {
  const settings = await getTelegramSettings(tenantId);

  if (!settings || !settings.is_enabled) {
    await logNotification({
      tenantId,
      eventType,
      channel: 'telegram',
      recipient: settings ? settings.owner_chat_id : null,
      messageText: text,
      status: 'skipped',
      errorText: 'telegram_disabled',
      meta,
    });

    return {
      ok: false,
      skipped: true,
      reason: 'telegram_disabled',
    };
  }

  if (!settings.bot_token || !settings.owner_chat_id) {
    await logNotification({
      tenantId,
      eventType,
      channel: 'telegram',
      recipient: settings.owner_chat_id || null,
      messageText: text,
      status: 'failed',
      errorText: 'telegram_settings_incomplete',
      meta,
    });

    return {
      ok: false,
      skipped: false,
      reason: 'telegram_settings_incomplete',
    };
  }

  try {
    const sent = await sendTelegramRaw({
      botToken: settings.bot_token,
      chatId: settings.owner_chat_id,
      text,
    });

    await logNotification({
      tenantId,
      eventType,
      channel: 'telegram',
      recipient: settings.owner_chat_id,
      messageText: text,
      status: 'sent',
      errorText: null,
      meta: {
        ...meta,
        telegram_message_id: sent?.result?.message_id || null,
      },
    });

    return {
      ok: true,
      skipped: false,
      telegram_message_id: sent?.result?.message_id || null,
    };
  } catch (err) {
    await logNotification({
      tenantId,
      eventType,
      channel: 'telegram',
      recipient: settings.owner_chat_id,
      messageText: text,
      status: 'failed',
      errorText: err.message,
      meta: {
        ...meta,
        telegram_response: err.telegramResponse || null,
      },
    });

    return {
      ok: false,
      skipped: false,
      reason: err.message,
    };
  }
}

async function buildShowcaseOrderText({ tenantId, orderId }) {
  const orderResult = await pool.query(
    `
      SELECT
        o.id,
        o.tenant_id,
        o.buyer_name,
        o.buyer_phone,
        o.status,
        o.total_amount,
        o.created_at,
        COUNT(oi.id)::int AS items_count,
        COALESCE(SUM(oi.qty), 0)::numeric AS total_qty
      FROM core.showcase_orders o
      LEFT JOIN core.showcase_order_items oi ON oi.order_id = o.id
      WHERE o.tenant_id = $1
        AND o.id = $2
      GROUP BY o.id
      LIMIT 1
    `,
    [tenantId, orderId]
  );

  const order = orderResult.rows[0];

  if (!order) {
    throw new Error(`showcase_order_not_found:${orderId}`);
  }

  const itemsResult = await pool.query(
    `
      SELECT
        oi.qty,
        oi.price,
        i.name,
        i.sku
      FROM core.showcase_order_items oi
      LEFT JOIN core.items i ON i.id = oi.item_id
      WHERE oi.order_id = $1
      ORDER BY oi.id ASC
      LIMIT 10
    `,
    [orderId]
  );

  const items = itemsResult.rows;

  const appUrl = process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || 'https://app.bfc-24.ru';
  const orderUrl = `${appUrl}/showcase-orders.html?order_id=${encodeURIComponent(order.id)}`;

  const itemsLines = items.length
    ? items
        .map((item, index) => {
          const name = safeText(item.name || 'Товар');
          const sku = item.sku ? ` / ${safeText(item.sku)}` : '';
          const qty = safeText(item.qty || 0);
          const price = normalizeMoney(item.price || 0);
          return `${index + 1}. ${name}${sku} — ${qty} шт × ${price} ₽`;
        })
        .join('\n')
    : 'Позиции не найдены';

  const moreItemsText = Number(order.items_count) > items.length
    ? `\n...ещё позиций: ${Number(order.items_count) - items.length}`
    : '';

  return [
    '🛒 <b>Новый заказ с витрины</b>',
    '',
    `Заказ: <b>№${safeText(order.id)}</b>`,
    `Клиент: <b>${safeText(order.buyer_name || 'Не указан')}</b>`,
    `Телефон: <b>${safeText(order.buyer_phone || 'Не указан')}</b>`,
    `Сумма: <b>${normalizeMoney(order.total_amount)} ₽</b>`,
    `Позиций: <b>${safeText(order.items_count)}</b>`,
    `Количество: <b>${safeText(order.total_qty)}</b>`,
    '',
    '<b>Состав:</b>',
    `${itemsLines}${moreItemsText}`,
    '',
    `Открыть заказ: ${orderUrl}`,
  ].join('\n');
}

async function sendShowcaseNewOrderNotification({ tenantId, orderId }) {
  const text = await buildShowcaseOrderText({ tenantId, orderId });

  return sendTelegramMessage({
    tenantId,
    text,
    eventType: 'showcase_new_order',
    meta: {
      order_id: orderId,
    },
  });
}

module.exports = {
  getTelegramSettings,
  sendTelegramMessage,
  sendShowcaseNewOrderNotification,
};
