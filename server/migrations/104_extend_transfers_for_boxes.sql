BEGIN;

ALTER TABLE core.transfers
ADD COLUMN IF NOT EXISTS qty_mode TEXT NOT NULL DEFAULT 'boxes';

ALTER TABLE core.transfers
ADD COLUMN IF NOT EXISTS qty_input NUMERIC(14,3) NOT NULL DEFAULT 0;

ALTER TABLE core.transfers
ADD COLUMN IF NOT EXISTS box_qty_snapshot NUMERIC(14,3);

ALTER TABLE core.transfers
DROP CONSTRAINT IF EXISTS transfers_qty_mode_check;

ALTER TABLE core.transfers
ADD CONSTRAINT transfers_qty_mode_check
CHECK (qty_mode IN ('units', 'boxes'));

UPDATE core.transfers
SET
  qty_input = qty,
  box_qty_snapshot = NULL,
  qty_mode = COALESCE(qty_mode, 'units')
WHERE qty_input = 0;

CREATE INDEX IF NOT EXISTS idx_transfers_qty_mode ON core.transfers(qty_mode);

COMMIT;