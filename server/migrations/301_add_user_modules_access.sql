BEGIN;

ALTER TABLE saas.users
  ADD COLUMN IF NOT EXISTS modules jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE saas.users
SET modules = '[]'::jsonb
WHERE modules IS NULL;

COMMIT;
