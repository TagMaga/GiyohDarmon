-- +goose Up
-- orders.net_revenue was computed as total_amount - delivery_fee, which
-- double-subtracts delivery since total_amount never included it in the
-- first place (see internal/orders/model.go). The corrected formula matches
-- commission_base (internal/orders/financial.go): total_amount + delivery_fee
-- minus courier_payout for delivered orders (courier_payout is frozen and
-- final), or without it for orders not yet delivered (provisional, courier
-- not yet assigned/paid).
UPDATE orders
SET net_revenue = total_amount + delivery_fee - courier_payout
WHERE status = 'delivered';

UPDATE orders
SET net_revenue = total_amount + delivery_fee
WHERE status <> 'delivered';

-- +goose Down
UPDATE orders
SET net_revenue = total_amount - delivery_fee;
