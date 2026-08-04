-- Migration 00100: Full destructive wipe of the courier-side inventory
-- ledger (current stock balances + full movement/cost history).
--
-- Requested explicitly, with the consequences below accepted:
--   • This does NOT make any physically-held courier stock disappear. It
--     only deletes the system's record of it. Reconciliation against real
--     stock in couriers' hands will no longer be possible after this runs.
--   • order_items.reserved_warehouse_id is INTENTIONALLY left untouched by
--     this migration. Any order currently reserved/claimed against a
--     courier warehouse will keep pointing at a warehouse whose
--     courier_inventory row no longer exists (it will be silently
--     recreated at 0 by GetOrCreateForUpdate on next touch). That order's
--     reservation becomes inconsistent with real courier stock. This can
--     surface as: delivery completing against phantom stock, cancellation/
--     address-change/postpone logic operating on a zeroed row, or a
--     courier being unable to claim further stock for that product until
--     the reservation is manually resolved.
--   • This is IRREVERSIBLE. There is no soft-delete and no snapshot taken
--     by this migration. Do not run this against production without a
--     verified backup and without accepting the order-reservation risk
--     above.
--
-- Before running, check the blast radius on affected live orders with:
--
--   SELECT oi.id, oi.order_id, o.status, oi.product_id, oi.quantity, oi.reserved_warehouse_id
--   FROM order_items oi
--   JOIN orders o ON o.id = oi.order_id
--   JOIN warehouses w ON w.id = oi.reserved_warehouse_id
--   WHERE w.type = 'courier'
--     AND o.status NOT IN ('delivered', 'cancelled', 'returned');
--
-- Deletion order respects FK constraints (children before parents):
--   courier_batch_consumptions
--     -> FK courier_inventory_movements (ON DELETE RESTRICT)
--     -> FK courier_inventory_batches   (ON DELETE RESTRICT)
--   then courier_inventory_movements, courier_inventory_batches,
--   then courier_inventory itself.
--
-- inventory_transfers / courier_returns / lost_product_reports (the
-- transfer/return/lost-report *transaction records* that moved stock onto
-- the courier ledger) are intentionally NOT touched by this migration --
-- only the resulting courier-side stock/cost/movement ledger is wiped.

-- +goose Up
-- +goose StatementBegin

DELETE FROM courier_batch_consumptions;
DELETE FROM courier_inventory_movements;
DELETE FROM courier_inventory_batches;
DELETE FROM courier_inventory;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- No-op: the data deleted by the Up migration cannot be reconstructed.
-- This Down exists only so `goose down` doesn't error; it does not restore
-- any courier inventory, movement, or cost-lot history.
SELECT 1;

-- +goose StatementEnd
