-- +goose Up
-- Owners edit budget top-ups/withdrawals and business expenses down to zero
-- as a stand-in for deleting a mis-entered row (no delete endpoint exists).
ALTER TABLE company_budget_transactions DROP CONSTRAINT company_budget_transactions_amount_check;
ALTER TABLE company_budget_transactions ADD CONSTRAINT company_budget_transactions_amount_check CHECK (amount >= 0);

ALTER TABLE finance_business_expenses DROP CONSTRAINT finance_business_expenses_amount_check;
ALTER TABLE finance_business_expenses ADD CONSTRAINT finance_business_expenses_amount_check CHECK (amount >= 0);

-- +goose Down
ALTER TABLE company_budget_transactions DROP CONSTRAINT company_budget_transactions_amount_check;
ALTER TABLE company_budget_transactions ADD CONSTRAINT company_budget_transactions_amount_check CHECK (amount > 0);

ALTER TABLE finance_business_expenses DROP CONSTRAINT finance_business_expenses_amount_check;
ALTER TABLE finance_business_expenses ADD CONSTRAINT finance_business_expenses_amount_check CHECK (amount > 0);
