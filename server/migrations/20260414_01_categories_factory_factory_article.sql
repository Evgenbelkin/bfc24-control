BEGIN;

CREATE TABLE IF NOT EXISTS core.categories (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS categories_tenant_name_uk
  ON core.categories (tenant_id, LOWER(name));

ALTER TABLE core.items
  ADD COLUMN IF NOT EXISTS category_id BIGINT,
  ADD COLUMN IF NOT EXISTS factory TEXT,
  ADD COLUMN IF NOT EXISTS factory_article TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'items_category_id_fkey'
  ) THEN
    ALTER TABLE core.items
      ADD CONSTRAINT items_category_id_fkey
      FOREIGN KEY (category_id)
      REFERENCES core.categories(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS items_category_id_idx
  ON core.items (category_id);

COMMIT;
