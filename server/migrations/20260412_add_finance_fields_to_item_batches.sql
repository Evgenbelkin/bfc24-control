ALTER TABLE core.item_batches
  ADD COLUMN IF NOT EXISTS usd_rate numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cny_rate numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_cost numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_finance_filled boolean NOT NULL DEFAULT false;