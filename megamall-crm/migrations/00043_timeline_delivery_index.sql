-- +goose Up
-- +goose StatementBegin

-- Support efficient delivery-date range queries on order_timeline.
--
-- finance/repository.go GetOrdersSummary now joins order_timeline WHERE
-- to_status = 'delivered' AND created_at BETWEEN ? AND ?, so we need an
-- index that satisfies both the equality filter on to_status and the range
-- on created_at without a full table scan.
--
-- The existing idx_order_timeline_order_id (order_id, created_at DESC) is
-- a lookup-by-order index and does NOT help here.  This new index covers
-- the aggregate query pattern: status filter → date range → sort.
CREATE INDEX IF NOT EXISTS idx_order_timeline_status_date
    ON order_timeline (to_status, created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_order_timeline_status_date;
-- +goose StatementEnd
