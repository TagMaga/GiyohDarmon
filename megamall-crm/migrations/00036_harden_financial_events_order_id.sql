-- +goose Up
-- +goose StatementBegin

-- Phase 25: Ledger integrity hardening.
--
-- financial_events.order_id was nullable with ON DELETE SET NULL,
-- meaning hard-deleting an order would silently orphan ledger rows.
-- This migration closes that gap:
--
--   1. Verifies no NULL order_id rows exist (aborts loudly if any do).
--   2. Adds NOT NULL constraint on order_id.
--   3. Replaces ON DELETE SET NULL FK with ON DELETE RESTRICT FK.
--   4. Replaces partial WHERE-NOT-NULL index with full unconditional index.
--
-- If this migration fails with "found X financial_event rows with NULL order_id",
-- those rows must be investigated and either back-filled or deleted before retrying.

-- ── Step 1: Abort loudly if any NULL order_id rows exist ─────────────────────
DO $$
DECLARE
    null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_count
    FROM financial_events
    WHERE order_id IS NULL;

    IF null_count > 0 THEN
        RAISE EXCEPTION
            'Ledger integrity pre-check FAILED: found % financial_event row(s) with NULL order_id. '
            'Investigate and back-fill or delete these rows before running this migration.',
            null_count;
    END IF;
END $$;

-- ── Step 2: Drop the old ON DELETE SET NULL FK ────────────────────────────────
-- Name was set in migration 00027_add_order_fk_to_snapshots.sql.
ALTER TABLE financial_events
    DROP CONSTRAINT IF EXISTS fk_financial_events_order;

-- ── Step 3: Set NOT NULL on order_id ─────────────────────────────────────────
ALTER TABLE financial_events
    ALTER COLUMN order_id SET NOT NULL;

-- ── Step 4: Add new FK with ON DELETE RESTRICT ────────────────────────────────
-- ON DELETE RESTRICT prevents hard-deleting an order that has ledger entries,
-- which is the correct invariant: the ledger is the audit trail.
ALTER TABLE financial_events
    ADD CONSTRAINT fk_financial_events_order_strict
    FOREIGN KEY (order_id)
    REFERENCES orders (id)
    ON DELETE RESTRICT;

-- ── Step 5: Replace partial index with full unconditional index ───────────────
-- The old index was: WHERE order_id IS NOT NULL (necessary when column was nullable).
-- Now that order_id is NOT NULL, the WHERE clause is a no-op and wastes index metadata.
DROP INDEX IF EXISTS idx_fin_events_order_id;
CREATE INDEX idx_fin_events_order_id ON financial_events (order_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Reverse: restore nullable + ON DELETE SET NULL (reverts to pre-Phase-25 state).
DROP INDEX IF EXISTS idx_fin_events_order_id;
CREATE INDEX idx_fin_events_order_id ON financial_events (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE financial_events
    DROP CONSTRAINT IF EXISTS fk_financial_events_order_strict;

ALTER TABLE financial_events
    ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE financial_events
    ADD CONSTRAINT fk_financial_events_order
    FOREIGN KEY (order_id)
    REFERENCES orders (id)
    ON DELETE SET NULL;

-- +goose StatementEnd
