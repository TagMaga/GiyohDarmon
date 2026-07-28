-- 00094_batch_expiry_and_goods_receipts.sql
-- Adds an optional expiry date to inventory batches (mandatory for new
-- receiving from the service layer, NULL only for historical batches that
-- predate this feature) and a goods_receipts header table so one invoice can
-- group several batch lines created atomically. FEFO consumption order is
-- implemented in the repository query (expiry_date ASC NULLS LAST, then
-- received_at/created_at/id) — no schema change needed for that beyond the
-- index below.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE inventory_batches
    ADD COLUMN expiry_date DATE NULL;

-- FEFO scan: active batches ordered by expiry first (NULLs — historical
-- batches without a recorded expiry — sort last), then received_at for the
-- FIFO tie-break among same-expiry or undated batches.
CREATE INDEX idx_inv_batches_fefo_active
    ON inventory_batches (product_id, expiry_date ASC NULLS LAST, received_at ASC)
    WHERE remaining_quantity > 0;

-- Fast lookup for the expiry-warning endpoint: active batches with a known
-- expiry, ordered soonest first.
CREATE INDEX idx_inv_batches_expiry_active
    ON inventory_batches (expiry_date ASC)
    WHERE remaining_quantity > 0 AND expiry_date IS NOT NULL;

-- Multi-line goods receipt (invoice) header. Each line item becomes one
-- inventory_batches row (+ one purchase movement) linked back here via
-- goods_receipt_id, so a single invoice number/date/note/user is shared
-- across every batch it created.
CREATE TABLE goods_receipts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_no  VARCHAR(100) NOT NULL,
    received_at DATE NOT NULL,
    notes       TEXT,
    created_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_goods_receipts_created_at ON goods_receipts (created_at DESC);

ALTER TABLE inventory_batches
    ADD COLUMN goods_receipt_id UUID REFERENCES goods_receipts(id) ON DELETE RESTRICT;

CREATE INDEX idx_inv_batches_goods_receipt ON inventory_batches (goods_receipt_id);

-- Audit trail for expiry-date edits on an existing batch (mirrors the
-- existing old/new product/quantity/unit_cost/note columns on this table).
ALTER TABLE inventory_receiving_edits
    ADD COLUMN old_expiry_date DATE,
    ADD COLUMN new_expiry_date DATE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE inventory_receiving_edits
    DROP COLUMN IF EXISTS old_expiry_date,
    DROP COLUMN IF EXISTS new_expiry_date;

DROP INDEX IF EXISTS idx_inv_batches_goods_receipt;
ALTER TABLE inventory_batches DROP COLUMN IF EXISTS goods_receipt_id;

DROP TABLE IF EXISTS goods_receipts;

DROP INDEX IF EXISTS idx_inv_batches_expiry_active;
DROP INDEX IF EXISTS idx_inv_batches_fefo_active;
ALTER TABLE inventory_batches DROP COLUMN IF EXISTS expiry_date;

-- +goose StatementEnd
