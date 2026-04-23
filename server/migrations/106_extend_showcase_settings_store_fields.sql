ALTER TABLE core.showcase_settings
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS logo_url text,
ADD COLUMN IF NOT EXISTS banner_url text;