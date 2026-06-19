-- +goose Up
-- +goose StatementBegin

CREATE TYPE device_platform AS ENUM ('android', 'ios', 'web');

CREATE TABLE courier_devices (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id   UUID            NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_token VARCHAR(500)    NOT NULL,
    platform     device_platform NOT NULL,
    last_seen    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- A device token must be unique (one registration per device).
CREATE UNIQUE INDEX uq_courier_devices_token ON courier_devices (device_token);

CREATE INDEX idx_courier_devices_courier_id ON courier_devices (courier_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS courier_devices;
DROP TYPE IF EXISTS device_platform;
-- +goose StatementEnd
