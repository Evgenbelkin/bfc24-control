BEGIN;

ALTER TABLE core.sale_items
  ADD COLUMN IF NOT EXISTS cost_price numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_profit numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batch_deductions jsonb;

ALTER TABLE core.item_batches
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_sale_items_tenant_item_id
  ON core.sale_items (tenant_id, item_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_tenant_sale_id
  ON core.sale_items (tenant_id, sale_id);

CREATE INDEX IF NOT EXISTS idx_sales_tenant_payment_status
  ON core.sales (tenant_id, payment_status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'core'
      AND t.relname = 'movements'
      AND c.conname = 'movements_qty_positive'
  ) THEN
    ALTER TABLE core.movements
      ADD CONSTRAINT movements_qty_positive CHECK (qty > 0);
  END IF;
END $$;

COMMIT;