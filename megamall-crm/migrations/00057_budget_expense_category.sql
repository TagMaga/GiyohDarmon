-- 00057_budget_expense_category.sql
-- Add index on expense_category for filtered queries.
-- NOTE: The ENUM type and column were already created in 00056_company_budget.sql.

-- +goose Up
-- +goose StatementBegin

CREATE INDEX IF NOT EXISTS idx_budget_expense_category
    ON company_budget_transactions (expense_category)
    WHERE transaction_type = 'manual_expense';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_budget_expense_category;

-- +goose StatementEnd
