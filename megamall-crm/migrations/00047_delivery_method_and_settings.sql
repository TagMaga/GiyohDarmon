-- Migration 00047: delivery_method on orders + delivery_settings singleton
--
-- Business rules:
--   • Each order carries its own delivery_method (normal | express).
--   • Owner configures normal_fee and express_fee in delivery_settings (singleton row).
--   • courier_collect_amount = product_total + delivery_fee - prepayment_amount
--     (previously missed adding delivery_fee — fixed at the query level, no column needed).

-- +goose Up

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'normal';

CREATE TABLE IF NOT EXISTS delivery_settings (
  id          INT         PRIMARY KEY DEFAULT 1,
  normal_fee  NUMERIC(12,2) NOT NULL DEFAULT 0,
  express_fee NUMERIC(12,2) NOT NULL DEFAULT 50,
  updated_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT delivery_settings_singleton CHECK (id = 1)
);

INSERT INTO delivery_settings (id, normal_fee, express_fee)
VALUES (1, 20, 50)
ON CONFLICT (id) DO NOTHING;

-- +goose Down

ALTER TABLE orders DROP COLUMN IF EXISTS delivery_method;
DROP TABLE IF EXISTS delivery_settings;
