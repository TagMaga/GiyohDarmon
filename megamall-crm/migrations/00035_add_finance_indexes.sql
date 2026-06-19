-- +goose Up
-- Phase 15.1: Add index on cash_handovers.created_at for date-filtered finance queries.
-- Without this index, SELECT ... FROM cash_handovers WHERE created_at >= ? does a full
-- table scan.  The finance/cash endpoint filters by date range on every request.
CREATE INDEX IF NOT EXISTS idx_cash_handovers_created_at ON cash_handovers (created_at DESC);

-- +goose Down
DROP INDEX IF EXISTS idx_cash_handovers_created_at;
