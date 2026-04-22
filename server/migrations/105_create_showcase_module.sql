-- =====================================================
-- 104_create_showcase_module.sql
-- Модуль витрины (showcase)
-- =====================================================

BEGIN;

-- =====================================================
-- 1. Настройки витрины
-- =====================================================

CREATE TABLE IF NOT EXISTS core.showcase_settings (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL UNIQUE,

    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    title TEXT,
    show_prices BOOLEAN NOT NULL DEFAULT TRUE,
    show_only_in_stock BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_showcase_settings_tenant 
ON core.showcase_settings(tenant_id);


-- =====================================================
-- 2. Покупатели витрины
-- =====================================================

CREATE TABLE IF NOT EXISTS core.showcase_buyers (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,

    name TEXT NOT NULL,
    login TEXT NOT NULL,
    password_hash TEXT NOT NULL,

    phone TEXT,
    email TEXT,
    comment TEXT,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, login)
);

CREATE INDEX IF NOT EXISTS idx_showcase_buyers_tenant 
ON core.showcase_buyers(tenant_id);


-- =====================================================
-- 3. Заказы витрины
-- =====================================================

CREATE TABLE IF NOT EXISTS core.showcase_orders (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,

    buyer_id BIGINT NOT NULL,
    order_no TEXT NOT NULL,

    status TEXT NOT NULL,

    comment TEXT,

    taken_by_user_id BIGINT,
    taken_at TIMESTAMPTZ,

    reserved_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,

    sale_id BIGINT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT showcase_orders_status_chk
    CHECK (status IN (
        'new',
        'in_progress',
        'partially_picked',
        'ready',
        'completed',
        'cancelled'
    ))
);

CREATE INDEX IF NOT EXISTS idx_showcase_orders_tenant 
ON core.showcase_orders(tenant_id);

CREATE INDEX IF NOT EXISTS idx_showcase_orders_buyer 
ON core.showcase_orders(buyer_id);

CREATE INDEX IF NOT EXISTS idx_showcase_orders_status 
ON core.showcase_orders(status);


-- =====================================================
-- 4. Строки заказа
-- =====================================================

CREATE TABLE IF NOT EXISTS core.showcase_order_items (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,

    order_id BIGINT NOT NULL,
    item_id BIGINT NOT NULL,

    requested_qty NUMERIC(14,3) NOT NULL,
    reserved_qty NUMERIC(14,3) DEFAULT 0,
    approved_qty NUMERIC(14,3),
    picked_qty NUMERIC(14,3) DEFAULT 0,

    base_price NUMERIC(14,2),
    final_price NUMERIC(14,2),

    line_status TEXT NOT NULL,

    comment TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT showcase_order_items_status_chk
    CHECK (line_status IN (
        'new',
        'approved',
        'picked',
        'partial',
        'cancelled'
    ))
);

CREATE INDEX IF NOT EXISTS idx_showcase_order_items_order 
ON core.showcase_order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_showcase_order_items_item 
ON core.showcase_order_items(item_id);


-- =====================================================
-- 5. Резервы
-- =====================================================

CREATE TABLE IF NOT EXISTS core.stock_reservations (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,

    order_id BIGINT NOT NULL,
    order_item_id BIGINT NOT NULL,

    item_id BIGINT NOT NULL,

    qty NUMERIC(14,3) NOT NULL,

    status TEXT NOT NULL,

    reserved_by_user_id BIGINT,

    reserved_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT stock_reservations_status_chk
    CHECK (status IN (
        'active',
        'released',
        'consumed'
    ))
);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_item 
ON core.stock_reservations(item_id);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_order 
ON core.stock_reservations(order_id);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_status 
ON core.stock_reservations(status);


-- =====================================================
-- 6. История действий
-- =====================================================

CREATE TABLE IF NOT EXISTS core.showcase_order_events (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,

    order_id BIGINT NOT NULL,

    event_type TEXT NOT NULL,
    user_id BIGINT,

    comment TEXT,
    payload_json JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_showcase_events_order 
ON core.showcase_order_events(order_id);


-- =====================================================
-- 7. ВАЖНЫЙ ИНДЕКС ДЛЯ STOCK (если нет)
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_stock_tenant_item 
ON core.stock(tenant_id, item_id);


COMMIT;