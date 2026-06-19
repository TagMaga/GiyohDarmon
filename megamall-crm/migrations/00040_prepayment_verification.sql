-- Migration 00040: Prepayment verification flow
-- Adds prepayment control fields to orders and creates order_attachments table.
--
-- Business rules implemented:
--   • No prepayment  → order created as confirmed, immediately claimable by courier.
--   • Has prepayment → order stays new, prepayment_status = pending_verification.
--   • Dispatcher verifies → prepayment_status = verified, order auto-confirmed.
--   • Dispatcher rejects → prepayment_status = rejected, order stays blocked.

-- +goose Up

-- 1. Create prepayment_status enum
-- +goose StatementBegin
DO $$ BEGIN
  CREATE TYPE prepayment_status AS ENUM (
    'none',
    'pending_verification',
    'verified',
    'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- +goose StatementEnd

-- 2. Add prepayment control columns to orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS prepayment_required    BOOLEAN                 NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS prepayment_type        TEXT,                  -- 'partial' | 'full'
  ADD COLUMN IF NOT EXISTS prepayment_status      prepayment_status       NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS prepayment_receiver    TEXT,                  -- 'dispatcher_card' | 'company_card' | 'cash' | 'other'
  ADD COLUMN IF NOT EXISTS prepayment_comment     TEXT,
  ADD COLUMN IF NOT EXISTS prepayment_verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prepayment_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prepayment_rejection_reason TEXT;

-- 3. Create order_attachments table
CREATE TABLE IF NOT EXISTS order_attachments (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id    UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL, -- 'payment_proof' | 'customer_chat' | 'other'
  file_url    TEXT        NOT NULL,
  uploaded_by UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_attachments_order_id ON order_attachments(order_id);

-- 4. Back-fill existing orders: prepayment_amount > 0 → pending_verification
UPDATE orders
SET
  prepayment_required = TRUE,
  prepayment_status   = 'pending_verification'
WHERE prepayment_amount > 0
  AND deleted_at IS NULL
  AND prepayment_status = 'none';

-- +goose Down

ALTER TABLE orders
  DROP COLUMN IF EXISTS prepayment_required,
  DROP COLUMN IF EXISTS prepayment_type,
  DROP COLUMN IF EXISTS prepayment_status,
  DROP COLUMN IF EXISTS prepayment_receiver,
  DROP COLUMN IF EXISTS prepayment_comment,
  DROP COLUMN IF EXISTS prepayment_verified_by,
  DROP COLUMN IF EXISTS prepayment_verified_at,
  DROP COLUMN IF EXISTS prepayment_rejection_reason;

DROP TABLE IF EXISTS order_attachments;
DROP TYPE IF EXISTS prepayment_status;
