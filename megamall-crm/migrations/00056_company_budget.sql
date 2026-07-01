-- 00056_company_budget.sql
-- Ledger-based company budget: every balance change is a row.
-- Balance = SUM(amount) WHERE type IN ('manual_income','finance_profit')
--         - SUM(amount) WHERE type = 'manual_expense'

CREATE TYPE budget_transaction_type AS ENUM (
    'manual_income',
    'manual_expense',
    'finance_profit'
);

CREATE TYPE budget_expense_category AS ENUM (
    'salary',
    'marketing',
    'other'
);

CREATE TABLE company_budget_transactions (
    id               UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type budget_transaction_type  NOT NULL,
    amount           NUMERIC(14,2)            NOT NULL CHECK (amount > 0),
    note             TEXT                     NOT NULL DEFAULT '',
    expense_category budget_expense_category  NULL,
    created_by       UUID                     REFERENCES users(id) ON DELETE SET NULL,
    source_order_id  UUID                     REFERENCES orders(id) ON DELETE SET NULL,
    balance_after    NUMERIC(14,2)            NOT NULL,
    created_at       TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);

-- Prevent the same order's profit from being imported twice.
CREATE UNIQUE INDEX uq_budget_order_profit
    ON company_budget_transactions (source_order_id)
    WHERE transaction_type = 'finance_profit' AND source_order_id IS NOT NULL;

CREATE INDEX idx_budget_created_at ON company_budget_transactions (created_at DESC);
CREATE INDEX idx_budget_type       ON company_budget_transactions (transaction_type);
