-- 00099_backfill_courier_inventory_batches.sql
--
-- Data-only backfill, no schema change.
--
-- Migration 00098 added the courier cost-lot ledger
-- (courier_inventory_batches), but only AcceptTransfer creates lots, and
-- nothing seeded lots for stock couriers were ALREADY holding when it
-- shipped. Every such unit therefore had no lot, so
-- Service.ConsumeCourierFIFO ran out of lots mid-delivery and returned a
-- plain error — surfacing to the courier as "internal server error" and
-- rolling the whole transaction back, leaving the order stuck in "в пути"
-- with no way for the courier to complete it. Since a claimed order's items
-- are always reserved in the courier's own warehouse, this blocked every
-- delivery by every courier holding pre-00098 stock.
--
-- The cost data is recoverable: accepting a transfer has always written an
-- inventory_movements row (movement_type='transfer_out', reference_id = the
-- transfer id) whose inventory_batch_consumptions carry the exact
-- per-накладная quantities and unit costs consumed from the main warehouse.
-- This migration replays those into courier_inventory_batches for the units
-- each courier still holds.
--
-- Scoped by DEFICIT rather than by transfer, so it composes with whatever
-- lots already exist: for each (warehouse, product) it only creates lots for
--     courier_inventory.quantity - SUM(existing lots' remaining_quantity)
-- and it skips transfers that already produced lots (those accepted after
-- 00098 shipped). Couriers with a mix of pre- and post-00098 stock get
-- exactly the missing part, and re-running is a no-op once the deficit is 0.
--
-- Historical lots are allocated NEWEST-first: under FIFO the units a courier
-- is still holding are the most recently received ones — the older lots are
-- the ones already delivered. created_at is set to the transfer's decided_at
-- so the backfilled lots keep their true chronological FIFO order, both
-- among themselves and against lots created after 00098.

-- +goose Up
-- +goose StatementBegin

-- ─── 1. Replay real cost lots from accepted-transfer history ─────────────────
WITH deficit AS (
    SELECT ci.warehouse_id,
           ci.product_id,
           ci.quantity - COALESCE((
               SELECT SUM(cb.remaining_quantity)
               FROM courier_inventory_batches cb
               WHERE cb.warehouse_id = ci.warehouse_id
                 AND cb.product_id   = ci.product_id
           ), 0) AS missing
    FROM courier_inventory ci
    WHERE ci.quantity > 0
),
hist AS (
    SELECT COALESCE(t.to_warehouse_id, cw.id) AS warehouse_id,
           m.product_id,
           t.id                               AS transfer_id,
           ibc.batch_id                       AS source_batch_id,
           ibc.quantity,
           ibc.unit_cost,
           COALESCE(t.decided_at, t.created_at) AS received_at,
           -- One transfer consumes several source batches in the same
           -- instant, so its decided_at cannot order them among themselves.
           -- The source batch's own FEFO key can: it is the order
           -- Repository.ConsumeFEFO drew them in (expiry first, then
           -- receipt), and therefore the order they reached the courier.
           sb.expiry_date                     AS source_expiry_date,
           sb.received_at                     AS source_received_at,
           sb.created_at                      AS source_created_at,
           ibc.batch_id                       AS source_batch_sort
    FROM inventory_transfers t
    JOIN inventory_movements m
      ON m.reference_id  = t.id
     AND m.movement_type = 'transfer_out'
    JOIN inventory_batch_consumptions ibc
      ON ibc.movement_id = m.id
    JOIN inventory_batches sb
      ON sb.id = ibc.batch_id
    LEFT JOIN warehouses cw
      ON cw.courier_id = t.to_courier_id
     AND cw.type       = 'courier'
    WHERE t.status = 'accepted'
      -- Skip transfers that already produced courier lots (post-00098),
      -- so their units are never counted twice.
      AND NOT EXISTS (
          SELECT 1 FROM courier_inventory_batches cb
          WHERE cb.transfer_id = t.id
            AND cb.product_id  = m.product_id
      )
),
ranked AS (
    SELECT h.*,
           SUM(h.quantity) OVER (
               PARTITION BY h.warehouse_id, h.product_id
               ORDER BY h.received_at        DESC,
                        h.source_expiry_date DESC NULLS FIRST,
                        h.source_received_at DESC,
                        h.source_created_at  DESC,
                        h.source_batch_sort  DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS running_total,
           ROW_NUMBER() OVER (
               PARTITION BY h.warehouse_id, h.product_id
               ORDER BY h.received_at        ASC,
                        h.source_expiry_date ASC NULLS LAST,
                        h.source_received_at ASC,
                        h.source_created_at  ASC,
                        h.source_batch_sort  ASC
           ) AS fifo_seq
    FROM hist h
),
alloc AS (
    SELECT r.*,
           -- Units of this lot that are still on the courier's shelf:
           -- what is left of the deficit once all newer lots took their share.
           LEAST(
               r.quantity,
               GREATEST(d.missing - (r.running_total - r.quantity), 0)
           ) AS take
    FROM ranked r
    JOIN deficit d
      ON d.warehouse_id = r.warehouse_id
     AND d.product_id   = r.product_id
    WHERE d.missing > 0
)
INSERT INTO courier_inventory_batches (
    warehouse_id, product_id, source_batch_id, transfer_id,
    received_quantity, remaining_quantity, unit_cost, created_at
)
SELECT a.warehouse_id,
       a.product_id,
       a.source_batch_id,
       a.transfer_id,
       a.take,
       a.take,
       a.unit_cost,
       -- Strictly increasing per lot so FIFO order is deterministic even
       -- when several lots share one transfer's decided_at (same convention
       -- as AcceptTransfer's own microsecond offsets).
       a.received_at + (a.fifo_seq * INTERVAL '1 microsecond')
FROM alloc a
WHERE a.take > 0;

-- ─── 2. Cover whatever history could not explain ─────────────────────────────
-- Stock that arrived by a path leaving no consumption trail (seeded/imported
-- rows, transfers predating batch tracking). Valued at the product's
-- purchase_price — the same fallback ConsumeCourierFIFO now applies at
-- delivery time. NULL source_batch_id + transfer_id marks a lot synthetic.
INSERT INTO courier_inventory_batches (
    warehouse_id, product_id, source_batch_id, transfer_id,
    received_quantity, remaining_quantity, unit_cost, created_at
)
SELECT ci.warehouse_id,
       ci.product_id,
       NULL,
       NULL,
       ci.quantity - COALESCE(lots.remaining, 0),
       ci.quantity - COALESCE(lots.remaining, 0),
       COALESCE(p.purchase_price, 0),
       NOW()
FROM courier_inventory ci
JOIN products p ON p.id = ci.product_id
LEFT JOIN LATERAL (
    SELECT SUM(cb.remaining_quantity) AS remaining
    FROM courier_inventory_batches cb
    WHERE cb.warehouse_id = ci.warehouse_id
      AND cb.product_id   = ci.product_id
) lots ON TRUE
WHERE ci.quantity > COALESCE(lots.remaining, 0);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Deliberately no-op. These lots are not a schema artifact that can be
-- withdrawn: once a delivery FIFO-consumes one, courier_batch_consumptions
-- references it (ON DELETE RESTRICT) and orders.product_cost has already
-- been written from its unit cost. Deleting them would leave orders costed
-- against rows that no longer exist and reintroduce the delivery-blocking
-- shortfall this migration exists to close.

-- +goose StatementEnd
