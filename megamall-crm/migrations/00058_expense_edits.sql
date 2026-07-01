-- +goose Up
CREATE TABLE expense_edits (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id     UUID        NOT NULL REFERENCES company_budget_transactions(id) ON DELETE CASCADE,
    edited_by      UUID        NOT NULL REFERENCES users(id),
    old_amount     NUMERIC(14,2) NOT NULL,
    new_amount     NUMERIC(14,2) NOT NULL,
    old_note       TEXT        NOT NULL DEFAULT '',
    new_note       TEXT        NOT NULL DEFAULT '',
    old_category   TEXT        NOT NULL DEFAULT '',
    new_category   TEXT        NOT NULL DEFAULT '',
    edited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expense_edits_expense_id ON expense_edits(expense_id, edited_at DESC);

-- +goose Down
DROP TABLE IF EXISTS expense_edits;
