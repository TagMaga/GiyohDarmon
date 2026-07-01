-- +goose Up
-- Business expenses (salaries, rent, marketing, taxes, other) belong to Finance's P&L,
-- not to Company Budget. This replaces company_budget_transactions.manual_expense going
-- forward; see 00062 for the one-time data migration of existing rows.
CREATE TYPE finance_expense_category AS ENUM (
    'salary',
    'rent',
    'marketing',
    'taxes',
    'other'
);

CREATE TABLE finance_business_expenses (
    id          UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    category    finance_expense_category NOT NULL,
    amount      NUMERIC(14,2)            NOT NULL CHECK (amount > 0),
    note        TEXT                     NOT NULL DEFAULT '',
    created_by  UUID                     REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_finance_expenses_created_at ON finance_business_expenses (created_at DESC);
CREATE INDEX idx_finance_expenses_category   ON finance_business_expenses (category);

-- +goose Down
DROP TABLE IF EXISTS finance_business_expenses;
DROP TYPE IF EXISTS finance_expense_category;
