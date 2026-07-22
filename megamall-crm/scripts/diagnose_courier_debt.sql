-- Diagnose why a courier shows a cash debt ("Долг") in the Logistics couriers
-- table / dispatcher board / courier app cash summary.
--
-- All three surfaces compute the same number:
--
--   debt = GREATEST(0,
--       SUM over delivered orders NOT linked to a CONFIRMED handover of
--           GREATEST(0, total_amount + delivery_fee - prepayment_amount - courier_payout)
--     + SUM over CONFIRMED handovers of (total_to_return - COALESCE(actual_returned, total_to_return))
--   )
--
-- (see internal/logistics/repository.go debt_cte + shortfall_cte,
--  internal/courier/repository.go GetCashSummary,
--  internal/dispatch/repository.go cash_owed)
--
-- Usage (read-only):
--   psql "$DB_DSN" -v phone="'%071519797%'" -f scripts/diagnose_courier_debt.sql

\set phone '''%071519797%'''

-- 0. The courier and the headline debt number, exactly as the UI computes it.
WITH courier AS (
    SELECT id, full_name, phone
    FROM users
    WHERE role = 'courier' AND deleted_at IS NULL AND phone LIKE :phone
)
SELECT
    c.full_name,
    c.phone,
    COALESCE((
        SELECT SUM(GREATEST(0, o.total_amount + o.delivery_fee
                               - COALESCE(o.prepayment_amount, 0)
                               - COALESCE(o.courier_payout, 0)))
        FROM orders o
        WHERE o.courier_id = c.id AND o.status = 'delivered' AND o.deleted_at IS NULL
          AND o.id NOT IN (
              SELECT cho.order_id FROM cash_handover_orders cho
              JOIN cash_handovers ch ON ch.id = cho.handover_id
              WHERE ch.status = 'confirmed')
    ), 0) AS unsettled_orders_component,
    COALESCE((
        SELECT SUM(ch.total_to_return - COALESCE(ch.actual_returned, ch.total_to_return))
        FROM cash_handovers ch
        WHERE ch.courier_id = c.id AND ch.status = 'confirmed'
    ), 0) AS confirmed_shortfall_component
FROM courier c;

-- 1. Per-order breakdown: every delivered order still counted as debt,
--    with the status of any handover it is attached to. Orders sitting in a
--    PENDING or DISPUTED handover still count as debt by design — only a
--    CONFIRMED handover clears them.
WITH courier AS (
    SELECT id FROM users
    WHERE role = 'courier' AND deleted_at IS NULL AND phone LIKE :phone
)
SELECT
    o.id,
    o.order_number,
    o.updated_at::date                              AS delivered_on,
    o.total_amount,
    o.delivery_fee,
    COALESCE(o.prepayment_amount, 0)                AS prepayment,
    COALESCE(o.courier_payout, 0)                   AS courier_payout,
    GREATEST(0, o.total_amount + o.delivery_fee
                 - COALESCE(o.prepayment_amount, 0)
                 - COALESCE(o.courier_payout, 0))   AS debt_amount,
    ch.id                                            AS handover_id,
    ch.status                                        AS handover_status,
    ch.created_at                                    AS handover_created_at
FROM orders o
LEFT JOIN cash_handover_orders cho ON cho.order_id = o.id
LEFT JOIN cash_handovers ch        ON ch.id = cho.handover_id
WHERE o.courier_id IN (SELECT id FROM courier)
  AND o.status = 'delivered' AND o.deleted_at IS NULL
  AND o.id NOT IN (
      SELECT cho2.order_id FROM cash_handover_orders cho2
      JOIN cash_handovers ch2 ON ch2.id = cho2.handover_id
      WHERE ch2.status = 'confirmed')
ORDER BY o.updated_at;

-- 2. Per-handover breakdown: every handover for the courier, its shortfall
--    contribution (confirmed only), and how many order lines it carries.
--    linked_orders = 0 on a confirmed handover means it was created manually
--    from the Logistics page — confirming it does NOT clear any order's debt.
WITH courier AS (
    SELECT id FROM users
    WHERE role = 'courier' AND deleted_at IS NULL AND phone LIKE :phone
)
SELECT
    ch.id,
    ch.status,
    ch.created_at,
    ch.confirmed_at,
    ch.total_to_return,
    ch.actual_returned,
    CASE WHEN ch.status = 'confirmed'
         THEN ch.total_to_return - COALESCE(ch.actual_returned, ch.total_to_return)
         ELSE 0 END                                   AS shortfall_contribution,
    (SELECT COUNT(*) FROM cash_handover_orders cho
      WHERE cho.handover_id = ch.id)                  AS linked_orders
FROM cash_handovers ch
WHERE ch.courier_id IN (SELECT id FROM courier)
ORDER BY ch.created_at;

-- 3. Edit history of those handovers (who changed status/amount and when).
WITH courier AS (
    SELECT id FROM users
    WHERE role = 'courier' AND deleted_at IS NULL AND phone LIKE :phone
)
SELECT
    e.handover_id,
    u.full_name       AS editor,
    e.action,
    e.old_status, e.new_status,
    e.old_actual_returned, e.new_actual_returned,
    e.reason,
    e.created_at
FROM cash_handover_edits e
LEFT JOIN users u ON u.id = e.editor_id
WHERE e.handover_id IN (
    SELECT id FROM cash_handovers
    WHERE courier_id IN (SELECT id FROM courier))
ORDER BY e.created_at;
