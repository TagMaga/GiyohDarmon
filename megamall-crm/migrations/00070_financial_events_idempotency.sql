-- +goose Up
-- +goose StatementBegin

-- Production-hardening: DB-level idempotency backstop for financial_events.
--
-- The only writer of this table is internal/orders/financial.go
-- (emitFinancialEvents + emitCourierFeeEvent), called exactly once per order
-- from ChangeStatus's single transition into the terminal `delivered` status
-- (protected by SELECT ... FOR UPDATE + a state machine where `delivered` has
-- zero outgoing transitions — verified live). For a given order, each
-- event_type is therefore emitted at most once, always for the same user.
-- This migration adds a DB-level UNIQUE constraint on (order_id, event_type)
-- as a backstop in case that application-level protection is ever bypassed
-- (a future refactor, a direct-SQL fix, a queue redelivery). The existing
-- app-level row locking in orders.ChangeStatus is unchanged by this migration.
--
-- If this migration fails with "found X duplicate order_id+event_type
-- group(s)", those rows must be investigated (they indicate the ledger
-- already double-counted money for some order) before retrying.

-- ── Step 1: Abort loudly if any duplicate (order_id, event_type) groups exist ─
DO $$
DECLARE
    dup_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT order_id, event_type
        FROM financial_events
        GROUP BY order_id, event_type
        HAVING COUNT(*) > 1
    ) dups;

    IF dup_count > 0 THEN
        RAISE EXCEPTION
            'Idempotency pre-check FAILED: found % order_id+event_type group(s) with '
            'more than one financial_event row. Investigate these duplicates '
            '(they indicate double-counted commission/revenue) before running this migration.',
            dup_count;
    END IF;
END $$;

-- ── Step 2: Add the unique constraint ─────────────────────────────────────────
CREATE UNIQUE INDEX uq_financial_events_order_event_type
    ON financial_events (order_id, event_type);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS uq_financial_events_order_event_type;

-- +goose StatementEnd
