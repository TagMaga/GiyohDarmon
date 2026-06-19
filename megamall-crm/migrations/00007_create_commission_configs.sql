-- +goose Up
-- +goose StatementBegin

-- Commission type enum.
-- Covers all configurable commission rates in the system.
CREATE TYPE commission_type AS ENUM (
    'seller_rate',
    'manager_team_rate',
    'manager_personal_rate',
    'team_lead_pool_rate',
    'company_rate'
);

-- commission_configs stores ALL commission rates at every scope level.
--
-- Three mutually exclusive scopes per row:
--   1. user_id IS NOT NULL                    → employee-level override  (highest priority)
--   2. team_id IS NOT NULL, user_id IS NULL   → team-level override
--   3. Both NULL                              → global default           (lowest priority)
--
-- IMMUTABILITY RULES:
--   Rows are never updated (except setting effective_to ONCE to close the window).
--   A rate change must:
--     a) Set effective_to on the current active row (= new_effective_from - 1ms)
--     b) Insert a new row with effective_to = NULL
--     c) Write an activity_log entry (synchronously, same transaction)
--     d) Require a non-empty `notes` reason
--
-- Rate change history is preserved automatically via immutable row accumulation.
CREATE TABLE commission_configs (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID            REFERENCES teams(id) ON DELETE SET NULL,
    user_id         UUID            REFERENCES users(id) ON DELETE SET NULL,
    commission_type commission_type NOT NULL,
    rate            NUMERIC(6,5)    NOT NULL
                    CONSTRAINT chk_commission_rate CHECK (rate > 0 AND rate <= 1),
    effective_from  TIMESTAMPTZ     NOT NULL,
    effective_to    TIMESTAMPTZ,                -- NULL = currently open / active
    notes           TEXT            NOT NULL,   -- reason for this config being created
    created_by      UUID            REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
    -- NO updated_at.  NO deleted_at.
    -- The ONLY allowed mutation is: UPDATE effective_to = <ts> WHERE effective_to IS NULL
);

-- Enforces exactly one open (effective_to IS NULL) config per (scope, commission_type).
-- COALESCE maps NULLs to a sentinel UUID so PostgreSQL unique logic applies correctly.
CREATE UNIQUE INDEX uq_active_commission
    ON commission_configs (
        COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
        commission_type
    )
    WHERE effective_to IS NULL;

-- Critical path: rate resolution query (employee → team → global priority loop).
CREATE INDEX idx_commission_resolution
    ON commission_configs (commission_type, user_id, team_id, effective_from, effective_to);

-- History queries by employee.
CREATE INDEX idx_commission_by_user
    ON commission_configs (user_id, commission_type, effective_from DESC)
    WHERE user_id IS NOT NULL;

-- History queries by team.
CREATE INDEX idx_commission_by_team
    ON commission_configs (team_id, commission_type, effective_from DESC)
    WHERE team_id IS NOT NULL AND user_id IS NULL;

-- History queries for global defaults.
CREATE INDEX idx_commission_global
    ON commission_configs (commission_type, effective_from DESC)
    WHERE team_id IS NULL AND user_id IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS commission_configs;
DROP TYPE  IF EXISTS commission_type;
-- +goose StatementEnd
