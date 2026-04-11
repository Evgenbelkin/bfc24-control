-- 102_extend_core_items_for_rich_product_card.sql

ALTER TABLE core.items
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS weight_grams numeric,
  ADD COLUMN IF NOT EXISTS volume_ml numeric,
  ADD COLUMN IF NOT EXISTS length_cm numeric,
  ADD COLUMN IF NOT EXISTS width_cm numeric,
  ADD COLUMN IF NOT EXISTS height_cm numeric;

CREATE INDEX IF NOT EXISTS idx_core_items_tenant_brand
  ON core.items (tenant_id, brand);

CREATE INDEX IF NOT EXISTS idx_core_items_tenant_category
  ON core.items (tenant_id, category);
