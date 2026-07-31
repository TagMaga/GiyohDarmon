-- wipe_products_orders_transactions.sql — Delete all products, orders, and
-- financial/transaction records. Employees and their pay records are
-- untouched.
--
-- Deletes:
--   * Products and everything product-scoped: images, inventory, batches,
--     movements, writeoffs, adjustments, goods receipts, courier inventory
--     ledger, inventory transfers, courier returns, lost-product reports,
--     suppliers.
--   * Orders and everything order-scoped: items, timeline, comments,
--     assignments, prepayments, attachments, status history, courier notes,
--     delivery attempts, financial snapshots.
--   * The pharmacy consignment domain in full (pharmacies, invoices, stock,
--     payments, returns, credit ledger) — its line items hard-reference
--     products, so it goes with products.
--   * Financial/transaction ledgers: financial_events, cash handovers,
--     company budget transactions, finance business expenses (+ their edit
--     trails), budget withdrawal requests, dispatcher settlements.
--   * Media assets tied to the above (product images, order attachments,
--     prepayment proofs, cash handover proofs).
--
-- Preserves: users (every role), teams, hierarchy, courier profiles/devices,
-- courier_tariff_rules, customers, payouts, payout_batches,
-- employee_compensations, activity_logs, sessions, avatar/user-document
-- media, warehouses (organizational rows), commission_configs.
--
-- Run via scripts/wipe_products_orders_transactions.sh. Do not run this
-- file directly against a database you have not already confirmed is safe.

BEGIN;

-- Disable FK/RI triggers for the duration of the transaction so tables can
-- be cleared in any order without violating RESTRICT constraints, and
-- without ON DELETE CASCADE/SET NULL side effects firing implicitly — every
-- dependent row this script needs to touch is handled explicitly below.
SET session_replication_role = replica;

-- ── Order domain ─────────────────────────────────────────────────────────
UPDATE notifications SET order_id = NULL WHERE order_id IS NOT NULL;

DELETE FROM order_status_history;
DELETE FROM order_assignments;
DELETE FROM order_comments;
DELETE FROM order_prepayments;
DELETE FROM order_timeline;
DELETE FROM order_attachments;
DELETE FROM courier_notes;
DELETE FROM delivery_attempts;
DELETE FROM order_items;
DELETE FROM order_financial_snapshots;

DELETE FROM cash_handover_edits;
DELETE FROM cash_handover_orders;
DELETE FROM cash_handovers;

DELETE FROM orders;

-- ── Pharmacy consignment domain (product-linked, deleted in full) ──────────
DELETE FROM pharmacy_credit_ledger;
DELETE FROM pharmacy_financial_events;
DELETE FROM pharmacy_events;
DELETE FROM pharmacy_return_allocations;
DELETE FROM pharmacy_return_items;
DELETE FROM pharmacy_returns;
DELETE FROM pharmacy_payment_allocations;
DELETE FROM pharmacy_payment_edits;
DELETE FROM pharmacy_payments;
DELETE FROM pharmacy_stock;
DELETE FROM pharmacy_financial_snapshots;
DELETE FROM pharmacy_invoice_items;
DELETE FROM pharmacy_invoices;
DELETE FROM pharmacy_responsibility_history;
DELETE FROM pharmacies;

-- ── Product / inventory domain ──────────────────────────────────────────
DELETE FROM lost_product_reports;
DELETE FROM courier_return_items;
DELETE FROM courier_returns;
DELETE FROM inventory_transfer_items;
DELETE FROM inventory_transfers;
DELETE FROM courier_inventory_movements;
DELETE FROM courier_inventory;

DELETE FROM inventory_batch_consumptions;
DELETE FROM inventory_batches;
DELETE FROM goods_receipts;
DELETE FROM inventory_receiving_edits;
DELETE FROM inventory_adjustments;
DELETE FROM inventory_movements;
DELETE FROM writeoffs;
DELETE FROM inventory;
DELETE FROM product_images;
DELETE FROM products;
DELETE FROM suppliers;

-- ── Financial / transaction ledgers ─────────────────────────────────────
DELETE FROM financial_events;

DELETE FROM budget_withdrawal_requests;
DELETE FROM expense_edits;
DELETE FROM record_edits;
DELETE FROM company_budget_transactions;
DELETE FROM finance_business_expenses;

DELETE FROM dispatcher_settlements;

-- ── Media tied to deleted records ───────────────────────────────────────
-- Avatars and user documents are left untouched; only media categories
-- belonging to the deleted domains above are removed.
DELETE FROM media_assets
WHERE category IN ('product_image', 'order_attachment', 'prepayment_proof', 'cash_handover_proof');

SET session_replication_role = DEFAULT;

COMMIT;
