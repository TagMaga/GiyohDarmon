-- Migration 00096: Persisted, push-backed notifications.
--
-- Generic table: one row per (recipient, event). Deliberately not scoped to
-- couriers only — sellers/dispatchers/managers/team leads all read the same
-- table via GET /notifications, only couriers additionally get an Expo push
-- (the only client with courier_push_tokens registered today).

-- +goose Up
-- +goose StatementBegin

CREATE TABLE notifications (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       VARCHAR(40)  NOT NULL,
    title      TEXT         NOT NULL,
    body       TEXT         NOT NULL,
    order_id   UUID         REFERENCES orders(id) ON DELETE SET NULL,
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS notifications;

-- +goose StatementEnd
