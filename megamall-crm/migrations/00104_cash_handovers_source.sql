-- +goose Up
-- +goose StatementBegin
-- Every prior attempt to detect "this handover was created via the owner's
-- manual entry point, with no linked orders" by inferring it from an absent
-- cash_handover_orders row was unreliable: the courier app's own SubmitHandover
-- legitimately creates a linked-order-free handover too, whenever a courier
-- pays down a carried-over shortfall with no newly-eligible orders (total_to_return
-- = 0 in that case). An explicit, unambiguous source column replaces the
-- inference — see internal/logistics.CreateHandover, the only place besides
-- the courier app's SubmitHandover that inserts into this table.
ALTER TABLE cash_handovers
    ADD COLUMN source text NOT NULL DEFAULT 'courier_app'
        CHECK (source IN ('courier_app', 'manual'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE cash_handovers DROP COLUMN source;
-- +goose StatementEnd
