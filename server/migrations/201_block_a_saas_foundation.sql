BEGIN;

-- =========================================================
-- BFC24 CONTROL
-- Migration: 201_block_a_saas_foundation.sql
-- Цель:
--   - RBAC foundation
--   - tariffs
--   - tenant limits
--   - self-registration support
--   - subscription requests
--   - audit log
-- Важно:
--   - не ломаем текущую auth-модель
--   - legacy field saas.users.role сохраняем
--   - max_sku пока не удаляем, используем параллельно с max_items-логикой
-- =========================================================

-- ---------------------------------------------------------
-- 1. schemas
-- ---------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS saas;
CREATE SCHEMA IF NOT EXISTS audit;

-- ---------------------------------------------------------
-- 2. saas.roles
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS saas.roles (
    id                  BIGSERIAL PRIMARY KEY,
    code                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    description         TEXT,
    scope               TEXT NOT NULL DEFAULT 'tenant',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT roles_scope_chk CHECK (scope IN ('system', 'tenant'))
);

CREATE INDEX IF NOT EXISTS idx_saas_roles_scope
    ON saas.roles(scope);

CREATE INDEX IF NOT EXISTS idx_saas_roles_is_active
    ON saas.roles(is_active);

-- ---------------------------------------------------------
-- 3. saas.permissions
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS saas.permissions (
    id                  BIGSERIAL PRIMARY KEY,
    code                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    module_code         TEXT NOT NULL,
    description         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saas_permissions_module_code
    ON saas.permissions(module_code);

-- ---------------------------------------------------------
-- 4. saas.role_permissions
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS saas.role_permissions (
    id                  BIGSERIAL PRIMARY KEY,
    role_id             BIGINT NOT NULL REFERENCES saas.roles(id) ON DELETE CASCADE,
    permission_id       BIGINT NOT NULL REFERENCES saas.permissions(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT role_permissions_role_permission_uk UNIQUE (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_saas_role_permissions_role_id
    ON saas.role_permissions(role_id);

CREATE INDEX IF NOT EXISTS idx_saas_role_permissions_permission_id
    ON saas.role_permissions(permission_id);

-- ---------------------------------------------------------
-- 5. saas.user_roles
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS saas.user_roles (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT NOT NULL REFERENCES saas.users(id) ON DELETE CASCADE,
    role_id             BIGINT NOT NULL REFERENCES saas.roles(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_roles_user_role_uk UNIQUE (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_saas_user_roles_user_id
    ON saas.user_roles(user_id);

CREATE INDEX IF NOT EXISTS idx_saas_user_roles_role_id
    ON saas.user_roles(role_id);

-- ---------------------------------------------------------
-- 6. saas.users extension
--    Сохраняем legacy role для совместимости
-- ---------------------------------------------------------

ALTER TABLE saas.users
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE INDEX IF NOT EXISTS idx_saas_users_tenant_id
    ON saas.users(tenant_id);

CREATE INDEX IF NOT EXISTS idx_saas_users_email
    ON saas.users(email);

CREATE INDEX IF NOT EXISTS idx_saas_users_phone
    ON saas.users(phone);

CREATE INDEX IF NOT EXISTS idx_saas_users_is_active
    ON saas.users(is_active);

CREATE INDEX IF NOT EXISTS idx_saas_users_is_blocked
    ON saas.users(is_blocked);

-- ---------------------------------------------------------
-- 7. saas.tariffs
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS saas.tariffs (
    id                  BIGSERIAL PRIMARY KEY,
    code                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    description         TEXT,
    price_monthly       NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency_code       TEXT NOT NULL DEFAULT 'RUB',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_public           BOOLEAN NOT NULL DEFAULT TRUE,
    max_users           INTEGER NOT NULL DEFAULT 3,
    max_items           INTEGER NOT NULL DEFAULT 1000,
    max_locations       INTEGER NOT NULL DEFAULT 10,
    enabled_modules     JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order          INTEGER NOT NULL DEFAULT 100,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tariffs_price_monthly_chk CHECK (price_monthly >= 0),
    CONSTRAINT tariffs_max_users_chk CHECK (max_users >= 0),
    CONSTRAINT tariffs_max_items_chk CHECK (max_items >= 0),
    CONSTRAINT tariffs_max_locations_chk CHECK (max_locations >= 0),
    CONSTRAINT tariffs_currency_code_chk CHECK (char_length(currency_code) >= 3)
);

CREATE INDEX IF NOT EXISTS idx_saas_tariffs_is_active
    ON saas.tariffs(is_active);

CREATE INDEX IF NOT EXISTS idx_saas_tariffs_is_public
    ON saas.tariffs(is_public);

CREATE INDEX IF NOT EXISTS idx_saas_tariffs_sort_order
    ON saas.tariffs(sort_order);

-- ---------------------------------------------------------
-- 8. saas.tenants extension
--    Важно: max_sku не трогаем, не удаляем
-- ---------------------------------------------------------

ALTER TABLE saas.tenants
    ADD COLUMN IF NOT EXISTS tariff_id BIGINT,
    ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS showcase_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS showcase_slug TEXT,
    ADD COLUMN IF NOT EXISTS showcase_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tenants_tariff_id_fkey'
    ) THEN
        ALTER TABLE saas.tenants
            ADD CONSTRAINT tenants_tariff_id_fkey
            FOREIGN KEY (tariff_id)
            REFERENCES saas.tariffs(id)
            ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tenants_max_users_chk'
    ) THEN
        ALTER TABLE saas.tenants
            ADD CONSTRAINT tenants_max_users_chk
            CHECK (max_users >= 0);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_tenants_showcase_slug_not_null
    ON saas.tenants(showcase_slug)
    WHERE showcase_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saas_tenants_tariff_id
    ON saas.tenants(tariff_id);

CREATE INDEX IF NOT EXISTS idx_saas_tenants_subscription_status
    ON saas.tenants(subscription_status);

CREATE INDEX IF NOT EXISTS idx_saas_tenants_is_active
    ON saas.tenants(is_active);

CREATE INDEX IF NOT EXISTS idx_saas_tenants_is_blocked
    ON saas.tenants(is_blocked);

-- ---------------------------------------------------------
-- 9. saas.subscription_requests
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS saas.subscription_requests (
    id                  BIGSERIAL PRIMARY KEY,
    tenant_id           BIGINT NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    contact_name        TEXT,
    phone               TEXT,
    email               TEXT,
    comment             TEXT,
    status              TEXT NOT NULL DEFAULT 'new',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at        TIMESTAMPTZ,
    processed_by        BIGINT REFERENCES saas.users(id) ON DELETE SET NULL,
    CONSTRAINT subscription_requests_status_chk
        CHECK (status IN ('new', 'in_progress', 'done', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_saas_subscription_requests_tenant_id
    ON saas.subscription_requests(tenant_id);

CREATE INDEX IF NOT EXISTS idx_saas_subscription_requests_status
    ON saas.subscription_requests(status);

CREATE INDEX IF NOT EXISTS idx_saas_subscription_requests_created_at
    ON saas.subscription_requests(created_at DESC);

-- ---------------------------------------------------------
-- 10. audit.activity_log
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit.activity_log (
    id                  BIGSERIAL PRIMARY KEY,
    tenant_id           BIGINT REFERENCES saas.tenants(id) ON DELETE SET NULL,
    user_id             BIGINT REFERENCES saas.users(id) ON DELETE SET NULL,
    action_code         TEXT NOT NULL,
    entity_type         TEXT,
    entity_id           TEXT,
    entity_label        TEXT,
    details_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address          INET,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_activity_log_tenant_id
    ON audit.activity_log(tenant_id);

CREATE INDEX IF NOT EXISTS idx_audit_activity_log_user_id
    ON audit.activity_log(user_id);

CREATE INDEX IF NOT EXISTS idx_audit_activity_log_action_code
    ON audit.activity_log(action_code);

CREATE INDEX IF NOT EXISTS idx_audit_activity_log_created_at
    ON audit.activity_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_activity_log_entity_type_entity_id
    ON audit.activity_log(entity_type, entity_id);

-- ---------------------------------------------------------
-- 11. updated_at trigger function
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION saas.set_updated_at()
RETURNS TRIGGER
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------
-- 12. updated_at triggers
-- ---------------------------------------------------------

DROP TRIGGER IF EXISTS trg_saas_roles_set_updated_at ON saas.roles;
CREATE TRIGGER trg_saas_roles_set_updated_at
BEFORE UPDATE ON saas.roles
FOR EACH ROW
EXECUTE FUNCTION saas.set_updated_at();

DROP TRIGGER IF EXISTS trg_saas_tariffs_set_updated_at ON saas.tariffs;
CREATE TRIGGER trg_saas_tariffs_set_updated_at
BEFORE UPDATE ON saas.tariffs
FOR EACH ROW
EXECUTE FUNCTION saas.set_updated_at();

DROP TRIGGER IF EXISTS trg_saas_subscription_requests_set_updated_at ON saas.subscription_requests;
CREATE TRIGGER trg_saas_subscription_requests_set_updated_at
BEFORE UPDATE ON saas.subscription_requests
FOR EACH ROW
EXECUTE FUNCTION saas.set_updated_at();

DROP TRIGGER IF EXISTS trg_saas_tenants_set_updated_at_block_a ON saas.tenants;
CREATE TRIGGER trg_saas_tenants_set_updated_at_block_a
BEFORE UPDATE ON saas.tenants
FOR EACH ROW
EXECUTE FUNCTION saas.set_updated_at();

DROP TRIGGER IF EXISTS trg_saas_users_set_updated_at_block_a ON saas.users;
CREATE TRIGGER trg_saas_users_set_updated_at_block_a
BEFORE UPDATE ON saas.users
FOR EACH ROW
EXECUTE FUNCTION saas.set_updated_at();

-- ---------------------------------------------------------
-- 13. seed roles
-- ---------------------------------------------------------

INSERT INTO saas.roles (code, name, description, scope, is_active)
VALUES
    ('owner',         'Owner',         'Системный владелец SaaS', TRUE, TRUE),
    ('tenant_owner',  'Tenant Owner',  'Владелец клиента',        'tenant', TRUE),
    ('tenant_admin',  'Tenant Admin',  'Администратор клиента',   'tenant', TRUE),
    ('manager',       'Manager',       'Менеджер клиента',        'tenant', TRUE),
    ('seller',        'Seller',        'Продавец/оператор',       'tenant', TRUE),
    ('viewer',        'Viewer',        'Только просмотр',         'tenant', TRUE)
ON CONFLICT (code) DO UPDATE
SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    scope = EXCLUDED.scope,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- ---------------------------------------------------------
-- 14. seed permissions
-- ---------------------------------------------------------

INSERT INTO saas.permissions (code, name, module_code, description)
VALUES
    ('dashboard.read',                    'Просмотр дашборда',                         'dashboard', 'Доступ к dashboard'),

    ('users.read',                        'Просмотр пользователей',                    'users',     'Просмотр пользователей tenant'),
    ('users.create',                      'Создание пользователей',                    'users',     'Создание пользователей tenant'),
    ('users.update',                      'Редактирование пользователей',              'users',     'Редактирование пользователей tenant'),
    ('users.block',                       'Блокировка пользователей',                  'users',     'Блокировка/разблокировка пользователей tenant'),

    ('items.read',                        'Просмотр товаров',                          'items',     'Просмотр товаров'),
    ('items.create',                      'Создание товаров',                          'items',     'Создание товаров'),
    ('items.update',                      'Редактирование товаров',                    'items',     'Редактирование товаров'),
    ('items.delete',                      'Удаление товаров',                          'items',     'Удаление товаров'),

    ('locations.read',                    'Просмотр локаций',                          'locations', 'Просмотр локаций'),
    ('locations.create',                  'Создание локаций',                          'locations', 'Создание локаций'),
    ('locations.update',                  'Редактирование локаций',                    'locations', 'Редактирование локаций'),
    ('locations.delete',                  'Удаление локаций',                          'locations', 'Удаление локаций'),

    ('stock.read',                        'Просмотр остатков',                         'stock',     'Просмотр остатков'),
    ('stock.incoming',                    'Приход товара',                             'stock',     'Операции приходования'),
    ('stock.adjust',                      'Корректировка остатков',                    'stock',     'Операции корректировки'),

    ('sales.read',                        'Просмотр продаж',                           'sales',     'Просмотр продаж'),
    ('sales.create',                      'Создание продаж',                           'sales',     'Создание продаж'),

    ('writeoff.read',                     'Просмотр списаний',                         'writeoff',  'Просмотр списаний'),
    ('writeoff.create',                   'Создание списаний',                         'writeoff',  'Создание списаний'),

    ('cash.read',                         'Просмотр денег',                            'cash',      'Просмотр денежных операций'),
    ('cash.create',                       'Создание денежных операций',                'cash',      'Создание денежных операций'),

    ('debts.read',                        'Просмотр долгов',                           'debts',     'Просмотр долгов'),
    ('debts.pay',                         'Погашение долгов',                          'debts',     'Погашение долгов'),

    ('owner.tenants.read',                'Owner: просмотр клиентов',                  'owner',     'Просмотр tenants'),
    ('owner.tenants.create',              'Owner: создание клиентов',                  'owner',     'Создание tenants'),
    ('owner.tenants.update',              'Owner: редактирование клиентов',            'owner',     'Редактирование tenants'),

    ('owner.users.read',                  'Owner: просмотр пользователей',             'owner',     'Просмотр users'),
    ('owner.users.create',                'Owner: создание пользователей',             'owner',     'Создание users'),
    ('owner.users.update',                'Owner: редактирование пользователей',       'owner',     'Редактирование users'),

    ('owner.tariffs.read',                'Owner: просмотр тарифов',                   'owner',     'Просмотр тарифов'),
    ('owner.tariffs.update',              'Owner: редактирование тарифов',             'owner',     'Редактирование тарифов'),

    ('owner.subscription_requests.read',  'Owner: просмотр заявок на продление',       'owner',     'Просмотр subscription requests'),
    ('owner.subscription_requests.update','Owner: обработка заявок на продление',      'owner',     'Обработка subscription requests')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------
-- 15. seed tariffs
-- ---------------------------------------------------------

INSERT INTO saas.tariffs (
    code,
    name,
    description,
    price_monthly,
    currency_code,
    is_active,
    is_public,
    max_users,
    max_items,
    max_locations,
    enabled_modules,
    sort_order
)
VALUES
    (
        'basic',
        'Basic',
        'Базовый тариф',
        0,
        'RUB',
        TRUE,
        TRUE,
        3,
        1000,
        10,
        '["items","clients","locations","stock","incoming","sales","writeoff","cash","debts","movements"]'::jsonb,
        10
    ),
    (
        'pro',
        'Pro',
        'Продвинутый тариф',
        4900,
        'RUB',
        TRUE,
        TRUE,
        10,
        5000,
        30,
        '["items","clients","locations","stock","incoming","sales","writeoff","cash","debts","movements","analytics","exports","users"]'::jsonb,
        20
    ),
    (
        'business',
        'Business',
        'Бизнес тариф',
        9900,
        'RUB',
        TRUE,
        TRUE,
        30,
        20000,
        100,
        '["items","clients","locations","stock","incoming","sales","writeoff","cash","debts","movements","analytics","exports","users","service","economics"]'::jsonb,
        30
    ),
    (
        'business_pro',
        'Business Pro',
        'Скрытый тариф под расширенные модули и витрину',
        19900,
        'RUB',
        TRUE,
        FALSE,
        100,
        100000,
        300,
        '["items","clients","locations","stock","incoming","sales","writeoff","cash","debts","movements","analytics","exports","users","service","economics","showcase"]'::jsonb,
        40
    )
ON CONFLICT (code) DO UPDATE
SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price_monthly = EXCLUDED.price_monthly,
    currency_code = EXCLUDED.currency_code,
    is_active = EXCLUDED.is_active,
    is_public = EXCLUDED.is_public,
    max_users = EXCLUDED.max_users,
    max_items = EXCLUDED.max_items,
    max_locations = EXCLUDED.max_locations,
    enabled_modules = EXCLUDED.enabled_modules,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

-- ---------------------------------------------------------
-- 16. default tariff mapping for existing tenants
-- ---------------------------------------------------------

UPDATE saas.tenants t
SET tariff_id = tr.id
FROM saas.tariffs tr
WHERE tr.code = 'basic'
  AND t.tariff_id IS NULL;

-- max_users default fill for old tenants if NULL somehow appears
UPDATE saas.tenants
SET max_users = 3
WHERE max_users IS NULL;

-- ---------------------------------------------------------
-- 17. sync tenant limits from current tariff where fields look empty/default
--    Важно:
--    - max_sku в tenant оставляем
--    - max_items пока физически нет в tenants, поэтому используем max_sku
-- ---------------------------------------------------------

UPDATE saas.tenants t
SET
    max_users = COALESCE(t.max_users, tr.max_users),
    max_locations = COALESCE(t.max_locations, tr.max_locations),
    max_sku = COALESCE(t.max_sku, tr.max_items),
    enabled_modules = CASE
        WHEN t.enabled_modules IS NULL OR t.enabled_modules = '[]'::jsonb THEN tr.enabled_modules
        ELSE t.enabled_modules
    END
FROM saas.tariffs tr
WHERE t.tariff_id = tr.id;

-- ---------------------------------------------------------
-- 18. map existing legacy users to RBAC roles
--    Текущее правило:
--      legacy owner  -> role owner
--      legacy client -> role tenant_owner
-- ---------------------------------------------------------

INSERT INTO saas.user_roles (user_id, role_id)
SELECT
    u.id,
    r.id
FROM saas.users u
JOIN saas.roles r
    ON (
        (u.role = 'owner'  AND r.code = 'owner')
        OR
        (u.role = 'client' AND r.code = 'tenant_owner')
    )
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ---------------------------------------------------------
-- 19. grant permissions to roles
-- ---------------------------------------------------------

-- owner gets all owner permissions + dashboard.read
INSERT INTO saas.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM saas.roles r
JOIN saas.permissions p ON (
    p.code = 'dashboard.read'
    OR p.code LIKE 'owner.%'
)
WHERE r.code = 'owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- tenant_owner gets broad full access to tenant modules
INSERT INTO saas.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM saas.roles r
JOIN saas.permissions p ON p.code IN (
    'dashboard.read',
    'users.read','users.create','users.update','users.block',
    'items.read','items.create','items.update','items.delete',
    'locations.read','locations.create','locations.update','locations.delete',
    'stock.read','stock.incoming','stock.adjust',
    'sales.read','sales.create',
    'writeoff.read','writeoff.create',
    'cash.read','cash.create',
    'debts.read','debts.pay'
)
WHERE r.code = 'tenant_owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- tenant_admin almost the same as tenant_owner
INSERT INTO saas.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM saas.roles r
JOIN saas.permissions p ON p.code IN (
    'dashboard.read',
    'users.read','users.create','users.update','users.block',
    'items.read','items.create','items.update','items.delete',
    'locations.read','locations.create','locations.update','locations.delete',
    'stock.read','stock.incoming','stock.adjust',
    'sales.read','sales.create',
    'writeoff.read','writeoff.create',
    'cash.read','cash.create',
    'debts.read','debts.pay'
)
WHERE r.code = 'tenant_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- manager
INSERT INTO saas.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM saas.roles r
JOIN saas.permissions p ON p.code IN (
    'dashboard.read',
    'users.read',
    'items.read','items.create','items.update',
    'locations.read',
    'stock.read','stock.incoming',
    'sales.read','sales.create',
    'writeoff.read','writeoff.create',
    'cash.read','cash.create',
    'debts.read','debts.pay'
)
WHERE r.code = 'manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- seller
INSERT INTO saas.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM saas.roles r
JOIN saas.permissions p ON p.code IN (
    'dashboard.read',
    'items.read',
    'locations.read',
    'stock.read',
    'sales.read','sales.create',
    'cash.read',
    'debts.read'
)
WHERE r.code = 'seller'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- viewer
INSERT INTO saas.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM saas.roles r
JOIN saas.permissions p ON p.code IN (
    'dashboard.read',
    'items.read',
    'locations.read',
    'stock.read',
    'sales.read',
    'writeoff.read',
    'cash.read',
    'debts.read'
)
WHERE r.code = 'viewer'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;