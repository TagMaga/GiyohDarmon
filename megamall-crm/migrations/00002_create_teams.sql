-- +goose Up
-- +goose StatementBegin

CREATE TABLE teams (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(255) NOT NULL,
    team_lead_id UUID REFERENCES users (id) ON DELETE SET NULL,
    manager_id   UUID REFERENCES users (id) ON DELETE SET NULL,
    is_active    BOOLEAN     NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_teams_name ON teams (name) WHERE deleted_at IS NULL;

CREATE INDEX idx_teams_team_lead_id ON teams (team_lead_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_teams_manager_id   ON teams (manager_id)   WHERE deleted_at IS NULL;
CREATE INDEX idx_teams_is_active    ON teams (is_active)    WHERE deleted_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS teams;
-- +goose StatementEnd
