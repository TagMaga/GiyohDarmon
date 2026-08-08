-- Clear all transactional/business data.
-- Preserves: users, teams, hierarchy, courier profiles, warehouse tables (products, inventory, etc.), config tables.
-- Deletes: orders and all children, customers, financial events, cash handovers, sessions, logs.
--
-- NOTE ON COURIER/SELLER HISTORY: order rows are the only record of what each
-- courier delivered and what each seller sold — courier work lives in
-- order_assignments/order_timeline, seller work in orders.seller_id and its
-- timeline, both cascade-deleted with the orders they reference. Courier and
-- seller *profiles* (the users/hierarchy tables) are preserved, but every
-- completed delivery and every completed sale attributed to them is gone
-- after this runs, with no way to recover who did what.
--
-- PREFER: bash scripts/clear_transactional_data.sh
-- That wrapper applies the lib/dbsafety.sh production refusal, reports the row
-- counts about to be destroyed, and requires a typed confirmation. Running this
-- file directly with `psql -f` bypasses all three: it will TRUNCATE whatever
-- database DB_DSN happens to point at, with no prompt and no undo.

BEGIN;

-- Single TRUNCATE CASCADE clears all transactional tables in one shot,
-- letting PostgreSQL resolve the FK graph automatically.
-- Cascades from orders → all order children + financial_events + snapshots + cash_handover_orders
-- Cascades from cash_handovers → cash_handover_orders (already handled)
TRUNCATE
    orders,
    cash_handovers,
    customers,
    refresh_tokens,
    activity_logs,
    courier_status_logs
CASCADE;

COMMIT;
