-- +goose Up
-- Immutable dispatcher/internal comments per order.
-- visibility controls who can read the comment.

CREATE TYPE comment_visibility AS ENUM (
    'internal',
    'courier_visible',
    'seller_visible'
);

CREATE TABLE order_comments (
    id         UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id   UUID               NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id    UUID               NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    comment    TEXT               NOT NULL CHECK (TRIM(comment) <> ''),
    visibility comment_visibility NOT NULL DEFAULT 'internal',
    created_at TIMESTAMPTZ        NOT NULL DEFAULT NOW()
    -- Immutable: no updated_at
);

CREATE INDEX idx_order_comments_order_id ON order_comments(order_id);

-- +goose Down
DROP TABLE IF EXISTS order_comments;
DROP TYPE  IF EXISTS comment_visibility;
