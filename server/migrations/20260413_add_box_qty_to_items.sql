ALTER TABLE core.items
ADD COLUMN box_qty numeric(14,3) DEFAULT 1;

UPDATE core.items
SET box_qty = 1
WHERE box_qty IS NULL;