-- wipe_keep_owner.sql — Delete every business record in the database,
-- keeping ONLY the owner user row(s) (login + password_hash untouched).
--
-- Deletes: orders and all order children, products and all inventory/
-- warehouse data, customers, finance/transaction records (financial_events,
-- payouts, budget, cash handovers, etc.), couriers/delivery data, teams,
-- non-owner users (employees), activity logs, sessions, and media.
--
-- Preserves: rows in `users` where role = 'owner' — every column on those
-- rows, including phone/email (login) and password_hash, is left untouched.
--
-- Run via scripts/wipe_keep_owner.sh, which applies the same production
-- guard as scripts/reset_db.sh before invoking this file. Do not run this
-- file directly against a database you have not already confirmed is safe.

BEGIN;

-- Disable FK/RI triggers for the duration of the transaction so tables can
-- be cleared in any order without violating RESTRICT/CASCADE constraints,
-- and — critically — without the whole-graph cascade that TRUNCATE ...
-- CASCADE would trigger (users.avatar_media_asset_id references
-- media_assets, so `TRUNCATE media_assets CASCADE` would empty `users`
-- too). Requires a role with sufficient privilege (e.g. table owner or
-- superuser) to set this session GUC.
SET session_replication_role = replica;

DELETE FROM order_status_history;
DELETE FROM order_assignments;
DELETE FROM order_comments;
DELETE FROM order_prepayments;
DELETE FROM order_timeline;
DELETE FROM order_attachments;
DELETE FROM order_items;
DELETE FROM order_financial_snapshots;
DELETE FROM delivery_attempts;
DELETE FROM cash_handover_edits;
DELETE FROM cash_handover_orders;
DELETE FROM cash_handovers;
DELETE FROM financial_events;
DELETE FROM orders;
DELETE FROM customers;

DELETE FROM inventory_batch_consumptions;
DELETE FROM inventory_batches;
DELETE FROM inventory_receiving_edits;
DELETE FROM inventory_adjustments;
DELETE FROM inventory_movements;
DELETE FROM writeoffs;
DELETE FROM inventory;
DELETE FROM product_images;
DELETE FROM products;
DELETE FROM categories;
DELETE FROM suppliers;
DELETE FROM warehouses;

DELETE FROM payouts;
DELETE FROM payout_batches;
DELETE FROM seller_payouts;
DELETE FROM employee_compensations;
DELETE FROM company_budget_transactions;
DELETE FROM expense_edits;
DELETE FROM finance_business_expenses;
DELETE FROM record_edits;
DELETE FROM commission_configs;
DELETE FROM delivery_tariffs;
DELETE FROM delivery_tariff_ranges;
DELETE FROM delivery_settings;
DELETE FROM courier_tariff_rules;

DELETE FROM courier_status_logs;
DELETE FROM courier_notes;
DELETE FROM courier_push_tokens;
DELETE FROM courier_devices;
DELETE FROM courier_profiles;
DELETE FROM courier_cities;
DELETE FROM cities;

DELETE FROM user_documents;
DELETE FROM user_history;
DELETE FROM activity_logs;
DELETE FROM refresh_tokens;
DELETE FROM media_assets;

DELETE FROM user_hierarchy;
DELETE FROM teams;

-- Every employee/courier/manager/etc. account is removed. Owner rows —
-- including password_hash — are left completely untouched.
DELETE FROM users WHERE role <> 'owner';

SET session_replication_role = DEFAULT;

COMMIT;
