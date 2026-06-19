-- +goose Up
-- +goose StatementBegin

-- Immutable audit log. No updated_at, no deleted_at. Rows are never changed.
CREATE TABLE activity_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id     UUID         REFERENCES users (id) ON DELETE SET NULL,
    action       VARCHAR(100) NOT NULL,
    entity_type  VARCHAR(50)  NOT NULL,
    entity_id    UUID,
    before_state JSONB,
    after_state  JSONB,
    ip_address   INET,
    user_agent   TEXT,
    reason       TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Primary query patterns
CREATE INDEX idx_activity_logs_actor_id    ON activity_logs (actor_id, created_at DESC);
CREATE INDEX idx_activity_logs_entity      ON activity_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_activity_logs_action      ON activity_logs (action, created_at DESC);
CREATE INDEX idx_activity_logs_created_at  ON activity_logs (created_at DESC);

-- GIN index for JSONB searches on before/after state
CREATE INDEX idx_activity_logs_before_gin ON activity_logs USING GIN (before_state);
CREATE INDEX idx_activity_logs_after_gin  ON activity_logs USING GIN (after_state);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS activity_logs;
-- +goose StatementEnd
