-- =========================================
-- 102_create_transfers_module.sql
-- Модуль перемещений (transfers)
-- =========================================

BEGIN;

-- =========================================
-- 1. Таблица transfers
-- =========================================

CREATE TABLE IF NOT EXISTS core.transfers (
  id BIGSERIAL PRIMARY KEY,

  tenant_id BIGINT NOT NULL,

  item_id BIGINT NOT NULL,
  from_location_id BIGINT NOT NULL,
  to_location_id BIGINT NOT NULL,

  qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),

  comment TEXT,

  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_transfers_tenant_id ON core.transfers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transfers_item_id ON core.transfers(item_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from_location ON core.transfers(from_location_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to_location ON core.transfers(to_location_id);
CREATE INDEX IF NOT EXISTS idx_transfers_created_at ON core.transfers(created_at);

-- =========================================
-- 2. Обновление movement_type
-- =========================================

ALTER TABLE core.movements
DROP CONSTRAINT IF EXISTS movements_movement_type_check;

ALTER TABLE core.movements
ADD CONSTRAINT movements_movement_type_check
CHECK (movement_type IN (
  'receipt',
  'sale',
  'writeoff',
  'adjustment',
  'transfer_in',
  'transfer_out'
));

COMMIT;