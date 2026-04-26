BEGIN;

ALTER TABLE core.showcase_buyers
ADD COLUMN IF NOT EXISTS counterparty_id bigint;

ALTER TABLE core.showcase_buyers
ADD CONSTRAINT showcase_buyers_counterparty_id_fkey
FOREIGN KEY (counterparty_id)
REFERENCES core.counterparties(id)
ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_showcase_buyers_counterparty_id
ON core.showcase_buyers(counterparty_id);

COMMIT;