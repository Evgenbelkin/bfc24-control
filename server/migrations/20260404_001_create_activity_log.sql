BEGIN;

CREATE SCHEMA IF NOT EXISTS saas;

CREATE TABLE IF NOT EXISTS saas.activity_log (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NULL REFERENCES saas.users(id) ON DELETE SET NULL,
    tenant_id    BIGINT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    event_type   TEXT NOT NULL,
    entity_type  TEXT NOT NULL,
    entity_id    BIGINT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    meta         JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_activity_log_tenant_created_at
    ON saas.activity_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_log_event_type
    ON saas.activity_log (event_type);

CREATE INDEX IF NOT EXISTS idx_activity_log_entity
    ON saas.activity_log (entity_type, entity_id);

CREATE OR REPLACE FUNCTION saas.fn_log_core_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_event_type  TEXT;
    v_entity_type TEXT;
    v_meta        JSONB;
BEGIN
    IF TG_TABLE_SCHEMA <> 'core' THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'sales' THEN
        v_event_type := 'sale_created';
        v_entity_type := 'sale';
    ELSIF TG_TABLE_NAME = 'receipts' THEN
        v_event_type := 'receipt_created';
        v_entity_type := 'receipt';
    ELSIF TG_TABLE_NAME = 'writeoffs' THEN
        v_event_type := 'writeoff_created';
        v_entity_type := 'writeoff';
    ELSIF TG_TABLE_NAME = 'cash_transactions' THEN
        IF COALESCE(NEW.transaction_type, '') = 'income' THEN
            v_event_type := 'cash_income_created';
            v_entity_type := 'cash_income';
        ELSIF COALESCE(NEW.transaction_type, '') = 'expense' THEN
            v_event_type := 'cash_expense_created';
            v_entity_type := 'cash_expense';
        ELSE
            v_event_type := 'cash_transaction_created';
            v_entity_type := 'cash_transaction';
        END IF;
    ELSE
        v_event_type := TG_TABLE_NAME || '_created';
        v_entity_type := TG_TABLE_NAME;
    END IF;

    v_meta := jsonb_build_object(
        'table', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME
    );

    INSERT INTO saas.activity_log (
        user_id,
        tenant_id,
        event_type,
        entity_type,
        entity_id,
        meta
    )
    VALUES (
        NULL,
        NEW.tenant_id,
        v_event_type,
        v_entity_type,
        NEW.id,
        v_meta
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_sales_activity ON core.sales;
CREATE TRIGGER trg_log_sales_activity
AFTER INSERT ON core.sales
FOR EACH ROW
EXECUTE FUNCTION saas.fn_log_core_activity();

DROP TRIGGER IF EXISTS trg_log_receipts_activity ON core.receipts;
CREATE TRIGGER trg_log_receipts_activity
AFTER INSERT ON core.receipts
FOR EACH ROW
EXECUTE FUNCTION saas.fn_log_core_activity();

DROP TRIGGER IF EXISTS trg_log_writeoffs_activity ON core.writeoffs;
CREATE TRIGGER trg_log_writeoffs_activity
AFTER INSERT ON core.writeoffs
FOR EACH ROW
EXECUTE FUNCTION saas.fn_log_core_activity();

DROP TRIGGER IF EXISTS trg_log_cash_transactions_activity ON core.cash_transactions;
CREATE TRIGGER trg_log_cash_transactions_activity
AFTER INSERT ON core.cash_transactions
FOR EACH ROW
EXECUTE FUNCTION saas.fn_log_core_activity();

COMMIT;