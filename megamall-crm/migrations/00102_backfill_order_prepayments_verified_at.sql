-- +goose Up
-- +goose StatementBegin

-- Data-only backfill, no schema change.
--
-- Service.VerifyPrepayment only ever updated the order-level
-- orders.prepayment_status/prepayment_verified_at/prepayment_verified_by
-- columns; it never stamped the matching order_prepayments row's own
-- verified_at/verified_by. The dispatcher drawer's per-record badge
-- ("Ожидает" vs "✓ Подтверждена") reads that row's verified_at directly, so
-- every prepayment record on an already-verified order stayed stuck on
-- "Ожидает" forever, even though the order-level banner correctly showed
-- "✓ Предоплата подтверждена".
--
-- The application code has already been fixed (VerifyPrepayment now also
-- calls Repository.MarkPrepaymentsVerified in the same transaction), so
-- every prepayment verified from now on gets its row stamped correctly.
-- This migration backfills existing rows: any order_prepayments record
-- that is still unverified even though its parent order's prepayment was
-- already verified gets the order's own verified_at/verified_by, matching
-- exactly what MarkPrepaymentsVerified would have written had the fix been
-- in place at the time.
UPDATE order_prepayments op
SET verified_by = o.prepayment_verified_by,
    verified_at = o.prepayment_verified_at
FROM orders o
WHERE op.order_id = o.id
  AND op.verified_at IS NULL
  AND o.prepayment_status = 'verified'
  AND o.prepayment_verified_at IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Deliberately no-op: the pre-backfill verified_at/verified_by = NULL state
-- on these rows was the bug (the order was already verified but the record
-- never reflected it), so there is nothing correct to restore them to.
-- Rolling back this migration must not reintroduce the bug.

-- +goose StatementEnd
