-- +goose Up
-- +goose StatementBegin

CREATE TABLE user_hierarchy (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    parent_id  UUID        REFERENCES users (id) ON DELETE SET NULL,
    team_id    UUID        REFERENCES teams (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Each user can only have one active hierarchy entry.
CREATE UNIQUE INDEX uq_user_hierarchy_user_id ON user_hierarchy (user_id);

CREATE INDEX idx_user_hierarchy_parent_id ON user_hierarchy (parent_id);
CREATE INDEX idx_user_hierarchy_team_id   ON user_hierarchy (team_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS user_hierarchy;
-- +goose StatementEnd
