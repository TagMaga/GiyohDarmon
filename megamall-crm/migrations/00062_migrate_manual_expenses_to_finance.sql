-- +goose Up
-- One-time data migration: copy (never delete) existing manual_expense rows from
-- company_budget_transactions into finance_business_expenses, reusing the same id
-- as primary key so history rows can be re-pointed without an id-mapping CTE.
INSERT INTO finance_business_expenses (id, category, amount, note, created_by, created_at)
SELECT id, expense_category::text::finance_expense_category, amount, note, created_by, created_at
FROM company_budget_transactions
WHERE transaction_type = 'manual_expense';

-- Carry over their edit history too, so the "Изменено N" badge count survives the cutover.
INSERT INTO record_edits (subject_type, subject_id, edited_by, old_amount, new_amount, old_note, new_note, edited_at)
SELECT 'finance_expense', ee.expense_id, ee.edited_by, ee.old_amount, ee.new_amount, ee.old_note, ee.new_note, ee.edited_at
FROM expense_edits ee
JOIN company_budget_transactions t ON t.id = ee.expense_id AND t.transaction_type = 'manual_expense';

-- +goose Down
DELETE FROM record_edits WHERE subject_type = 'finance_expense';
DELETE FROM finance_business_expenses;
