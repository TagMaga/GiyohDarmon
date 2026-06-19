-- Migration 00051: Courier tariff rules + user profile fields
--
-- Adds per-courier range-based tariff rules (replaces flat payout_normal/payout_fast
-- for couriers that have rules configured; flat profile is kept as fallback).
-- Also adds surname and telegram_chat_id to the users table.

-- +goose Up
-- +goose StatementBegin

-- ── User profile extensions ──────────────────────────────────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS surname          VARCHAR(150),
    ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(100);

-- ── Courier tariff rules ─────────────────────────────────────────────────────
-- Each row is one bracket rule for a courier × delivery_type combination.
-- Rules are matched by order total_amount falling in [amount_from, amount_to).
-- amount_to NULL means open-ended (no upper bound).
-- When multiple rules exist for a courier+type, all are loaded and the first
-- matching bracket is used (resolver sorts by amount_from ASC).
--
-- delivery_type: 'normal' | 'fast'
-- tariff_type:   'fixed'  | 'percent'
CREATE TABLE IF NOT EXISTS courier_tariff_rules (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivery_type VARCHAR(10)   NOT NULL
                  CONSTRAINT chk_ctr_delivery_type CHECK (delivery_type IN ('normal','fast')),
    amount_from   NUMERIC(12,2) NOT NULL DEFAULT 0
                  CONSTRAINT chk_ctr_amount_from_nn CHECK (amount_from >= 0),
    amount_to     NUMERIC(12,2)
                  CONSTRAINT chk_ctr_amount_to_pos CHECK (amount_to IS NULL OR amount_to > amount_from),
    tariff_type   VARCHAR(10)   NOT NULL
                  CONSTRAINT chk_ctr_tariff_type CHECK (tariff_type IN ('fixed','percent')),
    tariff_value  NUMERIC(12,4) NOT NULL
                  CONSTRAINT chk_ctr_tariff_value_pos CHECK (tariff_value > 0),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctr_courier_type ON courier_tariff_rules (courier_id, delivery_type);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS courier_tariff_rules;

ALTER TABLE users
    DROP COLUMN IF EXISTS surname,
    DROP COLUMN IF EXISTS telegram_chat_id;

-- +goose StatementEnd
