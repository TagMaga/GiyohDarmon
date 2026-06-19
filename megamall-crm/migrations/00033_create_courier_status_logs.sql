-- +goose Up
-- Append-only courier availability log.
-- Latest row per courier_id is current status.

CREATE TYPE courier_online_status AS ENUM (
    'online',
    'offline',
    'busy'
);

CREATE TABLE courier_status_logs (
    id         UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id UUID                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     courier_online_status NOT NULL,
    latitude   NUMERIC(10,7),
    longitude  NUMERIC(10,7),
    created_at TIMESTAMPTZ          NOT NULL DEFAULT NOW()
    -- Immutable: no updated_at
);

CREATE INDEX idx_courier_status_logs_courier_id  ON courier_status_logs(courier_id);
CREATE INDEX idx_courier_status_logs_created_at  ON courier_status_logs(created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS courier_status_logs;
DROP TYPE  IF EXISTS courier_online_status;
