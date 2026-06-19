-- +goose Up
-- Immutable courier-append notes per order.
-- Only the assigned courier for that order may add notes.

CREATE TABLE courier_notes (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id   UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    courier_id UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    note       TEXT        NOT NULL CHECK (TRIM(note) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- Immutable: no updated_at
);

CREATE INDEX idx_courier_notes_order_id   ON courier_notes(order_id);
CREATE INDEX idx_courier_notes_courier_id ON courier_notes(courier_id);

-- +goose Down
DROP TABLE IF EXISTS courier_notes;
