-- +goose Up
-- +goose StatementBegin

-- Immutable audit trail of every status transition.
-- Never updated or deleted. No updated_at.
CREATE TABLE order_timeline (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    from_status order_status,             -- NULL for the initial 'new' entry
    to_status   order_status NOT NULL,
    comment     TEXT,
    created_by  UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_timeline_order_id  ON order_timeline (order_id, created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS order_timeline;
-- +goose StatementEnd
