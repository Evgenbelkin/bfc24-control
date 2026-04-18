BEGIN;

-- ============================================
-- TABLE: core.expenses
-- ============================================

CREATE TABLE IF NOT EXISTS core.expenses (
    id BIGSERIAL PRIMARY KEY,

    tenant_id BIGINT NOT NULL
        REFERENCES saas.tenants(id)
        ON DELETE CASCADE,

    amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),

    category TEXT NOT NULL,

    comment TEXT,

    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,

    created_by BIGINT
        REFERENCES saas.users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_id
    ON core.expenses(tenant_id);

CREATE INDEX IF NOT EXISTS idx_expenses_date
    ON core.expenses(expense_date);

CREATE INDEX IF NOT EXISTS idx_expenses_category
    ON core.expenses(category);

-- ============================================
-- TRIGGER: updated_at
-- ============================================

CREATE OR REPLACE FUNCTION core.set_expenses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON core.expenses;

CREATE TRIGGER trg_expenses_updated_at
BEFORE UPDATE ON core.expenses
FOR EACH ROW
EXECUTE FUNCTION core.set_expenses_updated_at();

COMMIT;