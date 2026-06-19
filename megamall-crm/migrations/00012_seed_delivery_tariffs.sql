-- +goose Up
-- +goose StatementBegin

-- Seed the default fixed delivery tariff = 20 TJS.
--
-- The owner can replace this via POST /hr/tariffs, which will close this record
-- (set effective_to) and insert a new one — preserving this history.
--
-- created_by = NULL because no user exists yet at migration time.
INSERT INTO delivery_tariffs
    (id, name, type, fixed_fee, is_active, effective_from, notes, created_by, created_at)
VALUES (
    gen_random_uuid(),
    'Стандартная доставка',
    'fixed',
    20.00,
    true,
    NOW(),
    'Initial default — fixed delivery fee 20 TJS',
    NULL,
    NOW()
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM delivery_tariffs
WHERE notes = 'Initial default — fixed delivery fee 20 TJS';
-- +goose StatementEnd
