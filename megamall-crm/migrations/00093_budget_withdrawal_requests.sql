-- 00093_budget_withdrawal_requests.sql
-- Owner budget withdrawals are held pending Telegram approval (internal/telegram,
-- internal/budget) before the actual company_budget_transactions ledger row is
-- created. This table tracks the pending/approved/rejected/expired lifecycle of
-- each requested withdrawal.

-- +goose Up
-- +goose StatementBegin

CREATE TYPE budget_withdrawal_request_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'expired'
);

CREATE TABLE budget_withdrawal_requests (
    id                          UUID                              PRIMARY KEY DEFAULT gen_random_uuid(),
    amount                      NUMERIC(14,2)                     NOT NULL CHECK (amount > 0),
    note                        TEXT                              NOT NULL DEFAULT '',
    requested_by                UUID                              NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status                      budget_withdrawal_request_status  NOT NULL DEFAULT 'pending',
    telegram_chat_id            BIGINT                            NULL,
    telegram_message_id         BIGINT                            NULL,
    decided_by_telegram_user_id BIGINT                            NULL,
    decided_at                  TIMESTAMPTZ                       NULL,
    expires_at                  TIMESTAMPTZ                       NOT NULL,
    transaction_id              UUID                              NULL REFERENCES company_budget_transactions(id) ON DELETE SET NULL,
    created_at                  TIMESTAMPTZ                       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_budget_withdrawal_requests_status  ON budget_withdrawal_requests (status);
CREATE INDEX idx_budget_withdrawal_requests_expires ON budget_withdrawal_requests (expires_at) WHERE status = 'pending';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS budget_withdrawal_requests;
DROP TYPE IF EXISTS budget_withdrawal_request_status;

-- +goose StatementEnd
