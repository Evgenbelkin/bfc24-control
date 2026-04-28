-- 20260428_01_notifications_telegram.sql
-- BFC24 CONTROL — Telegram notifications foundation
-- Creates tenant-level Telegram settings and notification logs.

BEGIN;

CREATE TABLE IF NOT EXISTS core.telegram_settings (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    bot_token TEXT,
    owner_chat_id TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT telegram_settings_tenant_unique UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS core.notification_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT,
    message_text TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_text TEXT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_logs_status_chk CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    CONSTRAINT notification_logs_channel_chk CHECK (channel IN ('telegram', 'email', 'sms', 'whatsapp', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_telegram_settings_tenant_id
    ON core.telegram_settings (tenant_id);

CREATE INDEX IF NOT EXISTS idx_notification_logs_tenant_created
    ON core.notification_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_logs_event_type
    ON core.notification_logs (event_type);

CREATE INDEX IF NOT EXISTS idx_notification_logs_status
    ON core.notification_logs (status);

CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_telegram_settings_updated_at ON core.telegram_settings;

CREATE TRIGGER trg_telegram_settings_updated_at
BEFORE UPDATE ON core.telegram_settings
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

COMMIT;
