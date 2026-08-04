-- +goose Up
-- +goose StatementBegin

-- Retire 'issue', 'prepayment_pending', 'prepayment_received' from the live
-- order_status enum. 'issue' collapses into 'cancelled' (no more flag-and-
-- recover state — a courier/dispatcher problem now cancels the order
-- outright). 'prepayment_pending'/'prepayment_received' collapse into
-- 'confirmed' (prepayment verification already runs off the separate
-- orders.prepayment_status column, not this state machine).
--
-- order_timeline.from_status/to_status are switched from the order_status
-- enum to TEXT first so this immutable audit trail keeps its original
-- historical values (e.g. 'issue') even though those values are no longer
-- valid live statuses — only orders.status itself is remapped below.

ALTER TABLE order_timeline ALTER COLUMN from_status TYPE TEXT;
ALTER TABLE order_timeline ALTER COLUMN to_status   TYPE TEXT;

UPDATE orders SET status = 'cancelled' WHERE status = 'issue';
UPDATE orders SET status = 'confirmed' WHERE status IN ('prepayment_pending', 'prepayment_received');

ALTER TYPE order_status RENAME TO order_status_old;

CREATE TYPE order_status AS ENUM (
    'new',
    'confirmed',
    'assigned',
    'in_delivery',
    'delivered',
    'returned',
    'cancelled'
);

ALTER TABLE orders
    ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE order_status USING status::text::order_status,
    ALTER COLUMN status SET DEFAULT 'new';

DROP TYPE order_status_old;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Best-effort: restores the wider enum and column types. Orders that were
-- remapped to 'cancelled'/'confirmed' by the Up migration are NOT restored
-- to 'issue'/'prepayment_pending'/'prepayment_received' — that information
-- was discarded by design (a live status was permanently retired, not an
-- accident to undo). order_timeline stays TEXT (a strict superset of the
-- enum; no data loss to reverse there).

ALTER TYPE order_status RENAME TO order_status_new;

CREATE TYPE order_status AS ENUM (
    'new',
    'confirmed',
    'prepayment_pending',
    'prepayment_received',
    'assigned',
    'in_delivery',
    'delivered',
    'returned',
    'cancelled',
    'issue'
);

ALTER TABLE orders
    ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE order_status USING status::text::order_status,
    ALTER COLUMN status SET DEFAULT 'new';

DROP TYPE order_status_new;

-- +goose StatementEnd
