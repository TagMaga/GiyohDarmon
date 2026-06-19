-- +goose Up
-- Data repair for the "zombie order" bug (C1).
--
-- Before the fix, moving an order backward to `confirmed`/`new` (e.g.
-- issue → confirmed, or legacy in_delivery → confirmed) left the active
-- order_assignments row and the orders.courier_id cache in place. The order then
-- could not be assigned (409), reassigned (400) or started by the courier (400) —
-- permanently stuck.
--
-- This heals any rows already in that corrupted state: an order sitting in a
-- non-courier-holding status (confirmed/new/cancelled/returned) must not retain an
-- active assignment or a courier_id cache. Idempotent and safe to re-run.

-- +goose StatementBegin
UPDATE order_assignments oa
SET    is_active = FALSE,
       unassigned_at = COALESCE(oa.unassigned_at, NOW())
FROM   orders o
WHERE  oa.order_id = o.id
  AND  oa.is_active = TRUE
  AND  o.status IN ('confirmed', 'new', 'cancelled', 'returned');
-- +goose StatementEnd

-- +goose StatementBegin
UPDATE orders
SET    courier_id = NULL
WHERE  courier_id IS NOT NULL
  AND  status IN ('confirmed', 'new', 'cancelled', 'returned');
-- +goose StatementEnd

-- +goose Down
-- Data repair is not reversible (the stale-assignment state was invalid).
-- +goose StatementBegin
SELECT 1;
-- +goose StatementEnd
