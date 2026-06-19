-- +goose Up
-- Cash handover records: courier submits collected cash to dispatcher.
-- cash_handover_orders links each delivered order to a specific handover.
--
-- Double-inclusion prevention is handled at the application layer:
--   FindEligibleHandoverOrders queries orders WHERE NOT IN
--   (SELECT order_id FROM cash_handover_orders JOIN cash_handovers
--    WHERE status IN ('pending', 'confirmed'))
-- This allows re-handover after a rejected handover.

CREATE TYPE handover_status AS ENUM (
    'pending',
    'confirmed',
    'rejected',
    'disputed'
);

CREATE TABLE cash_handovers (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id          UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    dispatcher_id       UUID                     REFERENCES users(id) ON DELETE SET NULL,
    total_collected     NUMERIC(12,2)   NOT NULL CHECK (total_collected >= 0),
    total_delivery_fees NUMERIC(12,2)   NOT NULL CHECK (total_delivery_fees >= 0),
    total_to_return     NUMERIC(12,2)   NOT NULL,
    actual_returned     NUMERIC(12,2)            CHECK (actual_returned >= 0),
    status              handover_status NOT NULL DEFAULT 'pending',
    proof_url           TEXT,
    comment             TEXT,
    confirmed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE cash_handover_orders (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    handover_id       UUID          NOT NULL REFERENCES cash_handovers(id) ON DELETE CASCADE,
    order_id          UUID          NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    order_total       NUMERIC(12,2) NOT NULL,
    prepayment_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    courier_collected NUMERIC(12,2) NOT NULL,
    delivery_fee      NUMERIC(12,2) NOT NULL DEFAULT 0,
    courier_returns   NUMERIC(12,2) NOT NULL
);

CREATE INDEX idx_cash_handovers_courier_id     ON cash_handovers(courier_id);
CREATE INDEX idx_cash_handovers_status         ON cash_handovers(status);
CREATE INDEX idx_cash_handover_orders_handover ON cash_handover_orders(handover_id);
CREATE INDEX idx_cash_handover_orders_order_id ON cash_handover_orders(order_id);

-- +goose Down
DROP TABLE IF EXISTS cash_handover_orders;
DROP TABLE IF EXISTS cash_handovers;
DROP TYPE  IF EXISTS handover_status;
