-- +goose Up
-- +goose StatementBegin

-- Seed the five required global default commission rates.
--
-- DEFAULT VALUES (per architecture spec):
--   seller_rate           = 0.10  (10%)
--   manager_team_rate     = 0.03  (3%)
--   manager_personal_rate = 0.20  (20%)
--   team_lead_pool_rate   = 0.40  (40%)
--   company_rate          = 0.60  (60%)
--
-- These are the fallback rates used when no team-level or employee-level
-- override exists. All five MUST be present before any order can be created.
-- The owner can change them via the API (POST /hr/compensation/configs),
-- which will close these rows and insert new ones, preserving this history.
--
-- created_by = NULL because no user exists yet at migration time.
INSERT INTO commission_configs
    (id, team_id, user_id, commission_type, rate, effective_from, notes, created_by, created_at)
VALUES
    (gen_random_uuid(), NULL, NULL, 'seller_rate',
        0.10000, NOW(), 'Initial global default — 10% seller commission rate',            NULL, NOW()),
    (gen_random_uuid(), NULL, NULL, 'manager_team_rate',
        0.03000, NOW(), 'Initial global default — 3% manager team commission rate',       NULL, NOW()),
    (gen_random_uuid(), NULL, NULL, 'manager_personal_rate',
        0.20000, NOW(), 'Initial global default — 20% manager personal commission rate',  NULL, NOW()),
    (gen_random_uuid(), NULL, NULL, 'team_lead_pool_rate',
        0.40000, NOW(), 'Initial global default — 40% team lead pool rate',               NULL, NOW()),
    (gen_random_uuid(), NULL, NULL, 'company_rate',
        0.60000, NOW(), 'Initial global default — 60% company revenue rate',              NULL, NOW());

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Remove only the seed rows, identified by their notes prefix.
-- In production these rows will have been closed (effective_to set) by the time
-- a rollback is attempted, but we clean them up regardless.
DELETE FROM commission_configs
WHERE team_id IS NULL
  AND user_id IS NULL
  AND notes LIKE 'Initial global default%';
-- +goose StatementEnd
