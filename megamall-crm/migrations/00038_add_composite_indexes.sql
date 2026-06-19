-- +goose Up
-- +goose StatementBegin

-- Phase 28: Composite indexes for common query patterns.
--
-- AUDIT FINDINGS
-- ──────────────────────────────────────────────────────────────────────────────
-- Individual single-column indexes already exist on orders for:
--   status, seller_id, manager_id, team_lead_id, warehouse_id, created_at
--
-- financial_events already has:
--   (user_id, event_type, created_at DESC)  ← idx_fin_events_user_id
--   (event_type, created_at DESC)            ← idx_fin_events_type_date
--   (order_id)                               ← idx_fin_events_order_id (00036)
--
-- cash_handovers already has:
--   courier_id, status, created_at          ← separate single-column indexes
--
-- GAPS IDENTIFIED
-- ──────────────────────────────────────────────────────────────────────────────
-- GET /orders list for role-scoped views always adds:
--   WHERE (seller_id = X | manager_id = X | team_lead_id = X) [+ status filter]
--   ORDER BY created_at DESC
--
-- PostgreSQL can use an individual index on seller_id to satisfy the WHERE
-- clause, but then re-sort by created_at. A composite (seller_id, status,
-- created_at DESC) lets the planner satisfy both the filter and the ORDER in a
-- single index scan — eliminating the sort for the common case.
--
-- Same pattern applies to manager_id and team_lead_id views.
--
-- financial_events income queries filter on (user_id, created_at range).
-- The existing idx_fin_events_user_id covers (user_id, event_type, created_at)
-- which already satisfies (user_id + created_at range) via index prefix scan —
-- NO new index needed.
--
-- cash_handovers: dispatcher board reads status + created_at together; a
-- (status, created_at DESC) composite index helps that scan.
-- ──────────────────────────────────────────────────────────────────────────────

-- ── orders: seller-scoped list + optional status filter ───────────────────────
-- Covers: WHERE seller_id = X [AND status = ?] ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_orders_seller_status_date
    ON orders (seller_id, status, created_at DESC)
    WHERE deleted_at IS NULL;

-- ── orders: manager-scoped list + optional status filter ─────────────────────
-- Covers: WHERE manager_id = X [AND status = ?] ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_orders_manager_status_date
    ON orders (manager_id, status, created_at DESC)
    WHERE deleted_at IS NULL;

-- ── orders: team-lead-scoped list + optional status filter ───────────────────
-- Covers: WHERE team_lead_id = X [AND status = ?] ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_orders_tl_status_date
    ON orders (team_lead_id, status, created_at DESC)
    WHERE deleted_at IS NULL;

-- ── orders: owner / dispatcher full-table list ───────────────────────────────
-- Owner/dispatcher see ALL orders, most commonly filtered by status + date.
-- Covers: [WHERE status = ?] ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_orders_status_date
    ON orders (status, created_at DESC)
    WHERE deleted_at IS NULL;

-- ── cash_handovers: dispatcher board ─────────────────────────────────────────
-- Covers: WHERE status = X ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_cash_handovers_status_date
    ON cash_handovers (status, created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_orders_seller_status_date;
DROP INDEX IF EXISTS idx_orders_manager_status_date;
DROP INDEX IF EXISTS idx_orders_tl_status_date;
DROP INDEX IF EXISTS idx_orders_status_date;
DROP INDEX IF EXISTS idx_cash_handovers_status_date;

-- +goose StatementEnd
