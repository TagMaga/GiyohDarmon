-- Migration 00049: Courier payout tariffs + cities (Phase 2)
--
-- Business model (decoupling client delivery fee from courier payout):
--   • Client delivery fee  → income to company. Configured in delivery_settings
--       (normal = free by default, fast = owner-configurable).
--   • Courier payout       → expense paid from company margin. Per-courier fixed
--       tariff (normal/fast), independent of what the client was charged.
--   • A courier earns payout ONLY after an order is delivered. Cancelled = 0.
--
-- Cities (Dushanbe, Khujand) are for visibility/assignment only — NOT pricing.
--   • Orders carry a city (made required in Phase 3).
--   • Couriers are assigned one or more cities; the courier app filters by them.

-- +goose Up
-- +goose StatementBegin

-- ── Cities ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cities (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(100) NOT NULL UNIQUE,
    is_active  BOOLEAN      NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

INSERT INTO cities (name, is_active) VALUES
    ('Душанбе', true),
    ('Худжанд', true)
ON CONFLICT (name) DO NOTHING;

-- ── Courier payout profiles (one row per courier) ───────────────────────────
-- payout_normal / payout_fast are paid from company margin, NOT from the client
-- delivery fee. is_active toggles whether the courier receives new assignments.
CREATE TABLE IF NOT EXISTS courier_profiles (
    user_id       UUID          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payout_normal NUMERIC(12,2) NOT NULL DEFAULT 0
                  CONSTRAINT chk_payout_normal_non_negative CHECK (payout_normal >= 0),
    payout_fast   NUMERIC(12,2) NOT NULL DEFAULT 0
                  CONSTRAINT chk_payout_fast_non_negative CHECK (payout_fast >= 0),
    is_active     BOOLEAN       NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Backfill a default profile (0 payout) for every existing courier so the
-- resolver always finds a row.
INSERT INTO courier_profiles (user_id)
SELECT id FROM users WHERE role = 'courier'
ON CONFLICT (user_id) DO NOTHING;

-- ── Courier ↔ City assignments (many-to-many) ───────────────────────────────
CREATE TABLE IF NOT EXISTS courier_cities (
    courier_id UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    city_id    UUID NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    PRIMARY KEY (courier_id, city_id)
);

CREATE INDEX IF NOT EXISTS idx_courier_cities_city ON courier_cities (city_id);

-- ── Orders: city + frozen courier payout ────────────────────────────────────
-- city_id is nullable now; Phase 3 makes it required at order creation.
-- courier_payout is frozen at delivery time (Phase 4); defaults to 0.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS city_id        UUID REFERENCES cities(id),
    ADD COLUMN IF NOT EXISTS courier_payout NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_city ON orders (city_id);

-- ── Delivery settings: client fee single source of truth ────────────────────
-- Rename express_fee → fast_fee and make normal delivery free by default.
ALTER TABLE delivery_settings RENAME COLUMN express_fee TO fast_fee;
ALTER TABLE delivery_settings ALTER COLUMN normal_fee SET DEFAULT 0;
UPDATE delivery_settings SET normal_fee = 0 WHERE id = 1;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE delivery_settings ALTER COLUMN normal_fee SET DEFAULT 20;
ALTER TABLE delivery_settings RENAME COLUMN fast_fee TO express_fee;

ALTER TABLE orders DROP COLUMN IF EXISTS courier_payout;
ALTER TABLE orders DROP COLUMN IF EXISTS city_id;

DROP TABLE IF EXISTS courier_cities;
DROP TABLE IF EXISTS courier_profiles;
DROP TABLE IF EXISTS cities;

-- +goose StatementEnd
