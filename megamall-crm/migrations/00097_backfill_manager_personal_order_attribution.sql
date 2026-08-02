-- +goose Up
-- +goose StatementBegin

-- Data-only backfill, no schema change.
--
-- internal/orders/service.go used to populate manager_id/manager_team_id on
-- a manager_personal_order from the team's separately-assigned "manager"
-- slot (team.manager_id) instead of the manager who actually placed the
-- order. Those only coincide when that manager happens to be assigned to
-- the team's manager slot — a manager with no sellers under them (placing
-- only their own personal orders) has no such assignment, so their
-- employee-level manager_personal_rate override was silently skipped in
-- favor of the global default rate, both in the frozen commission ledger
-- and in the live payables recompute (internal/compensation/live_income.go).
--
-- The application code has already been fixed (see managerAttribution in
-- internal/orders/service.go) so every NEW manager_personal_order gets the
-- correct attribution going forward. This migration corrects existing rows
-- so already-placed, not-yet-paid orders reflect it too.
--
-- Safe: only touches orders.manager_id / orders.manager_team_id — never
-- financial_events.amount or order_financial_snapshots, which stay exactly
-- as originally recorded for audit purposes. Any already-paid amount is
-- unaffected; this only changes what the live/unpaid recompute sees going
-- forward for these rows.
UPDATE orders o
SET manager_id      = o.seller_id,
    manager_team_id = uh.team_id
FROM user_hierarchy uh
WHERE o.order_type = 'manager_personal_order'
  AND uh.user_id = o.seller_id
  AND o.manager_id IS DISTINCT FROM o.seller_id;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Deliberately no-op: the pre-backfill manager_id/manager_team_id values
-- were wrong (that was the bug), so there is nothing correct to restore
-- them to. Rolling back this migration must not reintroduce the bug.

-- +goose StatementEnd
