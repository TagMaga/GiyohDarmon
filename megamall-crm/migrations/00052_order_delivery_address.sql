-- Add per-order delivery address so courier address-changes don't
-- overwrite the shared customer record.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
