package logistics

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

type Repository struct {
	db  *gorm.DB
	loc *time.Location
}

func NewRepository(db *gorm.DB, loc *time.Location) *Repository {
	if loc == nil {
		loc = time.UTC
	}
	return &Repository{db: db, loc: loc}
}

// todayBounds returns the start and end of the current day in repo's timezone.
func (r *Repository) todayBounds() (time.Time, time.Time) {
	now := time.Now().In(r.loc)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, r.loc).UTC()
	end := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 999999999, r.loc).UTC()
	return start, end
}

// weekBounds returns start of Monday and end of today in repo's timezone.
func (r *Repository) weekBounds() (time.Time, time.Time) {
	now := time.Now().In(r.loc)
	// Roll back to Monday
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	monday := now.AddDate(0, 0, -(weekday - 1))
	start := time.Date(monday.Year(), monday.Month(), monday.Day(), 0, 0, 0, 0, r.loc).UTC()
	_, end := r.todayBounds()
	return start, end
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

func (r *Repository) GetDashboard(ctx context.Context) (*DashboardResponse, error) {
	todayStart, todayEnd := r.todayBounds()
	weekStart, weekEnd := r.weekBounds()

	resp := &DashboardResponse{}

	// ── Courier counts ────────────────────────────────────────────────────────
	type courierCounts struct {
		TotalActive int `gorm:"column:total_active"`
		Busy        int `gorm:"column:busy"`
	}
	var cc courierCounts
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			COUNT(*) FILTER (WHERE u.is_active = TRUE)  AS total_active,
			COUNT(*) FILTER (WHERE u.is_active = TRUE AND EXISTS (
				SELECT 1 FROM order_assignments oa
				JOIN orders o ON o.id = oa.order_id
				WHERE oa.courier_id = u.id AND oa.is_active = TRUE
				  AND o.status IN ('assigned', 'in_delivery') AND o.deleted_at IS NULL
			)) AS busy
		FROM users u
		WHERE u.role = 'courier' AND u.deleted_at IS NULL
	`).Scan(&cc).Error
	if err != nil {
		return nil, fmt.Errorf("courier counts: %w", err)
	}
	resp.ActiveCouriers = cc.TotalActive
	resp.BusyCouriers = cc.Busy
	resp.FreeCouriers = cc.TotalActive - cc.Busy

	// ── Orders assigned today ─────────────────────────────────────────────────
	var ordersToday int64
	err = r.db.WithContext(ctx).Raw(`
		SELECT COUNT(*) FROM order_assignments oa
		WHERE oa.assigned_at >= ? AND oa.assigned_at <= ?
	`, todayStart, todayEnd).Scan(&ordersToday).Error
	if err != nil {
		return nil, fmt.Errorf("orders today: %w", err)
	}
	resp.OrdersAssignedToday = int(ordersToday)

	// ── Cash expected (delivered, not in any pending/confirmed handover) ───────
	type cashRow struct {
		CashExpected      float64 `gorm:"column:cash_expected"`
		CashInCirculation float64 `gorm:"column:cash_in_circulation"`
	}
	var cr cashRow
	err = r.db.WithContext(ctx).Raw(`
		SELECT
			-- all unhandled delivered cash (expected = not in confirmed handover),
			-- plus what confirmed handovers still fell short by (net of
			-- overpayments) — that money is still out with the couriers
			GREATEST(0, COALESCE(SUM(
				CASE WHEN o.id NOT IN (
					SELECT cho.order_id FROM cash_handover_orders cho
					JOIN cash_handovers ch ON ch.id = cho.handover_id
					WHERE ch.status = 'confirmed'
				) THEN GREATEST(0, o.total_amount + o.delivery_fee - COALESCE(o.prepayment_amount,0)) ELSE 0 END
			), 0) + (
				SELECT COALESCE(SUM(ch2.total_to_return - COALESCE(ch2.actual_returned, ch2.total_to_return)), 0)
				FROM cash_handovers ch2 WHERE ch2.status = 'confirmed'
			)) AS cash_expected,
			-- cash actually in circulation (not in pending OR confirmed),
			-- plus the same confirmed-handover net shortfall
			GREATEST(0, COALESCE(SUM(
				CASE WHEN o.id NOT IN (
					SELECT cho.order_id FROM cash_handover_orders cho
					JOIN cash_handovers ch ON ch.id = cho.handover_id
					WHERE ch.status IN ('pending','confirmed')
				) THEN GREATEST(0, o.total_amount + o.delivery_fee - COALESCE(o.prepayment_amount,0)) ELSE 0 END
			), 0) + (
				SELECT COALESCE(SUM(ch2.total_to_return - COALESCE(ch2.actual_returned, ch2.total_to_return)), 0)
				FROM cash_handovers ch2 WHERE ch2.status = 'confirmed'
			)) AS cash_in_circulation
		FROM orders o
		WHERE o.status = 'delivered'
		  AND o.courier_id IS NOT NULL
		  AND o.deleted_at IS NULL
	`).Scan(&cr).Error
	if err != nil {
		return nil, fmt.Errorf("cash expected: %w", err)
	}
	resp.CashExpected = cr.CashExpected
	resp.CashInCirculation = cr.CashInCirculation

	// ── Cash handed over today / this week ────────────────────────────────────
	type cashHandoverRow struct {
		Today float64 `gorm:"column:today"`
		Week  float64 `gorm:"column:week"`
	}
	var chr cashHandoverRow
	err = r.db.WithContext(ctx).Raw(`
		SELECT
			COALESCE(SUM(CASE WHEN confirmed_at >= ? AND confirmed_at <= ? THEN COALESCE(actual_returned, total_to_return) ELSE 0 END), 0) AS today,
			COALESCE(SUM(CASE WHEN confirmed_at >= ? AND confirmed_at <= ? THEN COALESCE(actual_returned, total_to_return) ELSE 0 END), 0) AS week
		FROM cash_handovers
		WHERE status = 'confirmed'
	`, todayStart, todayEnd, weekStart, weekEnd).Scan(&chr).Error
	if err != nil {
		return nil, fmt.Errorf("cash handover stats: %w", err)
	}
	resp.CashHandedOverToday = chr.Today
	resp.CashHandedOverWeek = chr.Week

	// ── Overdue (active, assigned > 4h ago) ───────────────────────────────────
	overdueThreshold := time.Now().UTC().Add(-4 * time.Hour)
	atRiskLow := time.Now().UTC().Add(-4 * time.Hour)
	atRiskHigh := time.Now().UTC().Add(-2 * time.Hour)

	var overdueCount int64
	err = r.db.WithContext(ctx).Raw(`
		SELECT COUNT(DISTINCT o.id)
		FROM orders o
		JOIN order_assignments oa ON oa.order_id = o.id AND oa.is_active = TRUE
		WHERE o.status IN ('assigned', 'in_delivery')
		  AND o.deleted_at IS NULL
		  AND oa.assigned_at <= ?
	`, overdueThreshold).Scan(&overdueCount).Error
	if err != nil {
		return nil, fmt.Errorf("overdue: %w", err)
	}
	resp.OverdueDeliveries = int(overdueCount)

	// ── At risk (2–4 hours old) ───────────────────────────────────────────────
	var atRiskCount int64
	err = r.db.WithContext(ctx).Raw(`
		SELECT COUNT(DISTINCT o.id)
		FROM orders o
		JOIN order_assignments oa ON oa.order_id = o.id AND oa.is_active = TRUE
		WHERE o.status IN ('assigned', 'in_delivery')
		  AND o.deleted_at IS NULL
		  AND oa.assigned_at <= ? AND oa.assigned_at > ?
	`, atRiskHigh, atRiskLow).Scan(&atRiskCount).Error
	if err != nil {
		return nil, fmt.Errorf("at risk: %w", err)
	}
	resp.AtRiskDeliveries = int(atRiskCount)

	// ── Failed today ──────────────────────────────────────────────────────────
	var failedCount int64
	err = r.db.WithContext(ctx).Raw(`
		SELECT COUNT(*) FROM orders o
		WHERE o.status IN ('returned','cancelled')
		  AND o.courier_id IS NOT NULL
		  AND o.deleted_at IS NULL
		  AND o.updated_at >= ? AND o.updated_at <= ?
	`, todayStart, todayEnd).Scan(&failedCount).Error
	if err != nil {
		return nil, fmt.Errorf("failed today: %w", err)
	}
	resp.FailedToday = int(failedCount)

	// ── Success rate (all time, courier orders only) ──────────────────────────
	type rateRow struct {
		Delivered int `gorm:"column:delivered"`
		Terminal  int `gorm:"column:terminal"`
	}
	var rr rateRow
	err = r.db.WithContext(ctx).Raw(`
		SELECT
			COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered,
			COUNT(*) FILTER (WHERE o.status IN ('delivered','returned','cancelled')) AS terminal
		FROM orders o
		WHERE o.courier_id IS NOT NULL AND o.deleted_at IS NULL
	`).Scan(&rr).Error
	if err != nil {
		return nil, fmt.Errorf("success rate: %w", err)
	}
	if rr.Terminal > 0 {
		resp.SuccessRate = float64(rr.Delivered) * 100 / float64(rr.Terminal)
	}

	// ── Average delivery time ─────────────────────────────────────────────────
	var avgMin float64
	err = r.db.WithContext(ctx).Raw(`
		SELECT COALESCE(AVG(
			EXTRACT(EPOCH FROM (tl_del.created_at - oa_first.assigned_at)) / 60.0
		), 0)
		FROM orders o
		JOIN LATERAL (
			SELECT MIN(oa.assigned_at) AS assigned_at
			FROM order_assignments oa WHERE oa.order_id = o.id
		) oa_first ON TRUE
		JOIN LATERAL (
			SELECT ot.created_at FROM order_timeline ot
			WHERE ot.order_id = o.id AND ot.to_status = 'delivered'
			ORDER BY ot.created_at DESC LIMIT 1
		) tl_del ON TRUE
		WHERE o.status = 'delivered' AND o.deleted_at IS NULL AND o.courier_id IS NOT NULL
	`).Scan(&avgMin).Error
	if err != nil {
		return nil, fmt.Errorf("avg delivery time: %w", err)
	}
	resp.AvgDeliveryMinutes = avgMin

	// ── Orders without courier ────────────────────────────────────────────────
	var noCourierCount int64
	err = r.db.WithContext(ctx).Raw(`
		SELECT COUNT(*) FROM orders
		WHERE status IN ('confirmed','prepayment_received')
		  AND courier_id IS NULL AND deleted_at IS NULL
	`).Scan(&noCourierCount).Error
	if err != nil {
		return nil, fmt.Errorf("orders without courier: %w", err)
	}
	resp.OrdersWithoutCourier = int(noCourierCount)

	// ── Top 3 couriers (by delivered count, all time) ─────────────────────────
	type topRow struct {
		CourierID      uuid.UUID `gorm:"column:courier_id"`
		FullName       string    `gorm:"column:full_name"`
		DeliveredCount int       `gorm:"column:delivered_count"`
		TerminalCount  int       `gorm:"column:terminal_count"`
		CashDebt       float64   `gorm:"column:cash_debt"`
	}
	var topRows []topRow
	err = r.db.WithContext(ctx).Raw(`
		SELECT
			u.id AS courier_id,
			u.full_name,
			COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered_count,
			COUNT(*) FILTER (WHERE o.status IN ('delivered','returned','cancelled')) AS terminal_count,
			GREATEST(0, COALESCE(SUM(
				CASE WHEN o.status = 'delivered' AND o.id NOT IN (
					SELECT cho.order_id FROM cash_handover_orders cho
					JOIN cash_handovers ch ON ch.id = cho.handover_id
					WHERE ch.status IN ('pending','confirmed')
				) THEN GREATEST(0, o.total_amount + o.delivery_fee - COALESCE(o.prepayment_amount,0)) ELSE 0 END
			), 0) + COALESCE((
				-- confirmed-handover net shortfall — see ListCouriers' shortfall_cte
				SELECT SUM(ch2.total_to_return - COALESCE(ch2.actual_returned, ch2.total_to_return))
				FROM cash_handovers ch2 WHERE ch2.courier_id = u.id AND ch2.status = 'confirmed'
			), 0)) AS cash_debt
		FROM users u
		LEFT JOIN orders o ON o.courier_id = u.id AND o.deleted_at IS NULL
		WHERE u.role = 'courier' AND u.is_active = TRUE AND u.deleted_at IS NULL
		GROUP BY u.id, u.full_name
		ORDER BY delivered_count DESC
		LIMIT 3
	`).Scan(&topRows).Error
	if err != nil {
		return nil, fmt.Errorf("top couriers: %w", err)
	}
	resp.TopCouriers = make([]TopCourier, 0, len(topRows))
	for _, tr := range topRows {
		sr := 0.0
		if tr.TerminalCount > 0 {
			sr = float64(tr.DeliveredCount) * 100 / float64(tr.TerminalCount)
		}
		resp.TopCouriers = append(resp.TopCouriers, TopCourier{
			CourierID:      tr.CourierID,
			FullName:       tr.FullName,
			DeliveredCount: tr.DeliveredCount,
			SuccessRate:    sr,
			CashDebt:       tr.CashDebt,
		})
	}

	// ── Best success rate courier ─────────────────────────────────────────────
	var bestRows []topRow
	err = r.db.WithContext(ctx).Raw(`
		SELECT
			u.id AS courier_id,
			u.full_name,
			COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered_count,
			COUNT(*) FILTER (WHERE o.status IN ('delivered','returned','cancelled')) AS terminal_count,
			0.0 AS cash_debt
		FROM users u
		LEFT JOIN orders o ON o.courier_id = u.id AND o.deleted_at IS NULL
		WHERE u.role = 'courier' AND u.is_active = TRUE AND u.deleted_at IS NULL
		GROUP BY u.id, u.full_name
		HAVING COUNT(*) FILTER (WHERE o.status IN ('delivered','returned','cancelled')) >= 5
		ORDER BY
			COUNT(*) FILTER (WHERE o.status = 'delivered') * 100.0 /
			NULLIF(COUNT(*) FILTER (WHERE o.status IN ('delivered','returned','cancelled')), 0) DESC NULLS LAST
		LIMIT 1
	`).Scan(&bestRows).Error
	if err != nil {
		return nil, fmt.Errorf("best courier: %w", err)
	}
	if len(bestRows) > 0 {
		tr := bestRows[0]
		sr := 0.0
		if tr.TerminalCount > 0 {
			sr = float64(tr.DeliveredCount) * 100 / float64(tr.TerminalCount)
		}
		t := TopCourier{CourierID: tr.CourierID, FullName: tr.FullName, DeliveredCount: tr.DeliveredCount, SuccessRate: sr}
		resp.BestSuccessCourier = &t
	}

	// ── Biggest debt courier ──────────────────────────────────────────────────
	var debtRows []topRow
	err = r.db.WithContext(ctx).Raw(`
		SELECT
			u.id AS courier_id,
			u.full_name,
			COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered_count,
			COUNT(*) FILTER (WHERE o.status IN ('delivered','returned','cancelled')) AS terminal_count,
			GREATEST(0, COALESCE(SUM(
				CASE WHEN o.status = 'delivered' AND o.id NOT IN (
					SELECT cho.order_id FROM cash_handover_orders cho
					JOIN cash_handovers ch ON ch.id = cho.handover_id
					WHERE ch.status IN ('pending','confirmed')
				) THEN GREATEST(0, o.total_amount + o.delivery_fee - COALESCE(o.prepayment_amount,0)) ELSE 0 END
			), 0) + COALESCE((
				-- confirmed-handover net shortfall — see ListCouriers' shortfall_cte
				SELECT SUM(ch2.total_to_return - COALESCE(ch2.actual_returned, ch2.total_to_return))
				FROM cash_handovers ch2 WHERE ch2.courier_id = u.id AND ch2.status = 'confirmed'
			), 0)) AS cash_debt
		FROM users u
		LEFT JOIN orders o ON o.courier_id = u.id AND o.deleted_at IS NULL
		WHERE u.role = 'courier' AND u.is_active = TRUE AND u.deleted_at IS NULL
		GROUP BY u.id, u.full_name
		ORDER BY cash_debt DESC
		LIMIT 1
	`).Scan(&debtRows).Error
	if err != nil {
		return nil, fmt.Errorf("biggest debt courier: %w", err)
	}
	if len(debtRows) > 0 {
		tr := debtRows[0]
		sr := 0.0
		if tr.TerminalCount > 0 {
			sr = float64(tr.DeliveredCount) * 100 / float64(tr.TerminalCount)
		}
		t := TopCourier{CourierID: tr.CourierID, FullName: tr.FullName, DeliveredCount: tr.DeliveredCount, SuccessRate: sr, CashDebt: tr.CashDebt}
		resp.BiggestDebtCourier = &t
	}

	return resp, nil
}

// ─── Couriers ─────────────────────────────────────────────────────────────────

func (r *Repository) ListCouriers(ctx context.Context) ([]CourierListRow, error) {
	todayStart, todayEnd := r.todayBounds()

	type rawRow struct {
		CourierID          uuid.UUID  `gorm:"column:courier_id"`
		FullName           string     `gorm:"column:full_name"`
		Phone              string     `gorm:"column:phone"`
		TelegramChatID     *string    `gorm:"column:telegram_chat_id"`
		IsActive           bool       `gorm:"column:is_active"`
		OrderIntakeEnabled bool       `gorm:"column:order_intake_enabled"`
		OrderIntakeReason  *string    `gorm:"column:order_intake_reason"`
		ActiveOrders       int        `gorm:"column:active_orders"`
		OrdersToday        int        `gorm:"column:orders_today"`
		DeliveredToday     int        `gorm:"column:delivered_today"`
		FailedToday        int        `gorm:"column:failed_today"`
		DeliveredTotal     int        `gorm:"column:delivered_total"`
		TerminalTotal      int        `gorm:"column:terminal_total"`
		AvgDeliveryMinutes float64    `gorm:"column:avg_delivery_minutes"`
		CashDebt           float64    `gorm:"column:cash_debt"`
		Earnings           float64    `gorm:"column:earnings"`
		LastActivityAt     *time.Time `gorm:"column:last_activity_at"`
	}

	var rows []rawRow
	err := r.db.WithContext(ctx).Raw(`
		WITH
		active_cte AS (
			SELECT oa.courier_id, COUNT(*) AS cnt
			FROM order_assignments oa
			JOIN orders o ON o.id = oa.order_id AND o.deleted_at IS NULL
			WHERE oa.is_active = TRUE AND o.status IN ('assigned','in_delivery')
			GROUP BY oa.courier_id
		),
		today_cte AS (
			SELECT
				o.courier_id,
				COUNT(*) AS orders_today,
				COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered_today,
				COUNT(*) FILTER (WHERE o.status IN ('returned','cancelled')) AS failed_today
			FROM orders o
			WHERE o.courier_id IS NOT NULL AND o.deleted_at IS NULL
			  AND o.updated_at >= ? AND o.updated_at <= ?
			GROUP BY o.courier_id
		),
		rate_cte AS (
			SELECT
				o.courier_id,
				COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered_total,
				COUNT(*) FILTER (WHERE o.status IN ('delivered','returned','cancelled')) AS terminal_total
			FROM orders o
			WHERE o.courier_id IS NOT NULL AND o.deleted_at IS NULL
			GROUP BY o.courier_id
		),
		avgtime_cte AS (
			SELECT
				o.courier_id,
				COALESCE(AVG(
					EXTRACT(EPOCH FROM (tl_del.created_at - oa_first.assigned_at)) / 60.0
				), 0) AS avg_minutes
			FROM orders o
			JOIN LATERAL (
				SELECT MIN(oa.assigned_at) AS assigned_at
				FROM order_assignments oa WHERE oa.order_id = o.id
			) oa_first ON TRUE
			JOIN LATERAL (
				SELECT ot.created_at FROM order_timeline ot
				WHERE ot.order_id = o.id AND ot.to_status = 'delivered'
				ORDER BY ot.created_at DESC LIMIT 1
			) tl_del ON TRUE
			WHERE o.status = 'delivered' AND o.deleted_at IS NULL AND o.courier_id IS NOT NULL
			GROUP BY o.courier_id
		),
		debt_cte AS (
			SELECT
				o.courier_id,
				COALESCE(SUM(GREATEST(0, o.total_amount + o.delivery_fee - COALESCE(o.prepayment_amount,0) - COALESCE(o.courier_payout,0))), 0) AS cash_debt
			FROM orders o
			WHERE o.courier_id IS NOT NULL AND o.status = 'delivered' AND o.deleted_at IS NULL
			  AND o.id NOT IN (
				  SELECT cho.order_id FROM cash_handover_orders cho
				  JOIN cash_handovers ch ON ch.id = cho.handover_id
				  WHERE ch.status = 'confirmed'
			  )
			GROUP BY o.courier_id
		),
		-- Signed net difference on confirmed handovers (expected − actual):
		-- money a courier still owes after a handover was confirmed short,
		-- minus any confirmed overpayments. Mirrors the courier app's own
		-- cash summary (internal/courier GetCashSummary) so both sides
		-- report the same debt.
		shortfall_cte AS (
			SELECT
				ch.courier_id,
				SUM(ch.total_to_return - COALESCE(ch.actual_returned, ch.total_to_return)) AS net_shortfall
			FROM cash_handovers ch
			WHERE ch.status = 'confirmed'
			GROUP BY ch.courier_id
		),
		earnings_cte AS (
			SELECT fe.user_id AS courier_id, COALESCE(SUM(fe.amount), 0) AS earnings
			FROM financial_events fe
			WHERE fe.event_type = 'courier_fee_earned' AND fe.user_id IS NOT NULL
			GROUP BY fe.user_id
		),
		activity_cte AS (
			SELECT oa.courier_id, MAX(oa.assigned_at) AS last_activity_at
			FROM order_assignments oa GROUP BY oa.courier_id
		)
		SELECT
			u.id          AS courier_id,
			u.full_name,
			u.phone,
			u.telegram_chat_id,
			u.is_active,
			u.courier_order_intake_enabled AS order_intake_enabled,
			u.courier_order_intake_reason  AS order_intake_reason,
			COALESCE(a.cnt, 0)          AS active_orders,
			COALESCE(t.orders_today, 0) AS orders_today,
			COALESCE(t.delivered_today, 0) AS delivered_today,
			COALESCE(t.failed_today, 0)    AS failed_today,
			COALESCE(r.delivered_total, 0) AS delivered_total,
			COALESCE(r.terminal_total, 0)  AS terminal_total,
			COALESCE(av.avg_minutes, 0)    AS avg_delivery_minutes,
			GREATEST(0, COALESCE(d.cash_debt, 0) + COALESCE(sf.net_shortfall, 0)) AS cash_debt,
			COALESCE(e.earnings, 0)        AS earnings,
			ac.last_activity_at
		FROM users u
		LEFT JOIN active_cte    a  ON a.courier_id  = u.id
		LEFT JOIN today_cte     t  ON t.courier_id  = u.id
		LEFT JOIN rate_cte      r  ON r.courier_id  = u.id
		LEFT JOIN avgtime_cte   av ON av.courier_id = u.id
		LEFT JOIN debt_cte      d  ON d.courier_id  = u.id
		LEFT JOIN shortfall_cte sf ON sf.courier_id = u.id
		LEFT JOIN earnings_cte  e  ON e.courier_id  = u.id
		LEFT JOIN activity_cte  ac ON ac.courier_id = u.id
		WHERE u.role = 'courier' AND u.deleted_at IS NULL
		ORDER BY u.full_name
	`, todayStart, todayEnd).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("list couriers: %w", err)
	}

	result := make([]CourierListRow, 0, len(rows))
	for _, row := range rows {
		sr := 0.0
		if row.TerminalTotal > 0 {
			sr = float64(row.DeliveredTotal) * 100 / float64(row.TerminalTotal)
		}
		status := CourierDisplayFree
		if !row.IsActive {
			status = CourierDisplayInactive
		} else if row.ActiveOrders > 0 {
			status = CourierDisplayBusy
		}
		result = append(result, CourierListRow{
			CourierID:          row.CourierID,
			FullName:           row.FullName,
			Phone:              row.Phone,
			TelegramChatID:     row.TelegramChatID,
			IsActive:           row.IsActive,
			OrderIntakeEnabled: row.OrderIntakeEnabled,
			OrderIntakeReason:  row.OrderIntakeReason,
			Status:             status,
			ActiveOrders:       row.ActiveOrders,
			OrdersToday:        row.OrdersToday,
			DeliveredToday:     row.DeliveredToday,
			FailedToday:        row.FailedToday,
			SuccessRate:        sr,
			AvgDeliveryMinutes: row.AvgDeliveryMinutes,
			CashDebt:           row.CashDebt,
			Earnings:           row.Earnings,
			LastActivityAt:     row.LastActivityAt,
			CityIDs:            []uuid.UUID{},
		})
	}

	// Batch-load city assignments — same shape the dispatcher's courier
	// overview uses, so EditCourierModal pre-fills identically regardless of
	// which courier list (Logistics or dispatcher board) it was opened from.
	if len(result) > 0 {
		courierIDs := make([]uuid.UUID, len(result))
		for i, o := range result {
			courierIDs[i] = o.CourierID
		}
		type cityLinkRow struct {
			CourierID uuid.UUID `gorm:"column:courier_id"`
			CityID    uuid.UUID `gorm:"column:city_id"`
		}
		var cityLinks []cityLinkRow
		r.db.WithContext(ctx).Raw(`
			SELECT courier_id, city_id FROM courier_cities WHERE courier_id IN ?
		`, courierIDs).Scan(&cityLinks)

		cityMap := make(map[uuid.UUID][]uuid.UUID, len(result))
		for _, cl := range cityLinks {
			cityMap[cl.CourierID] = append(cityMap[cl.CourierID], cl.CityID)
		}
		for i := range result {
			if ids, ok := cityMap[result[i].CourierID]; ok {
				result[i].CityIDs = ids
			}
		}
	}

	return result, nil
}

// ─── Single courier ───────────────────────────────────────────────────────────

func (r *Repository) GetCourier(ctx context.Context, courierID uuid.UUID) (*CourierDetailResponse, error) {
	type rawRow struct {
		FullName           string  `gorm:"column:full_name"`
		Phone              string  `gorm:"column:phone"`
		IsActive           bool    `gorm:"column:is_active"`
		DeliveredTotal     int     `gorm:"column:delivered_total"`
		FailedTotal        int     `gorm:"column:failed_total"`
		TerminalTotal      int     `gorm:"column:terminal_total"`
		AvgDeliveryMinutes float64 `gorm:"column:avg_delivery_minutes"`
		CashDebt           float64 `gorm:"column:cash_debt"`
		TotalHandedOver    float64 `gorm:"column:total_handed_over"`
		Earnings           float64 `gorm:"column:earnings"`
		ActiveOrders       int     `gorm:"column:active_orders"`
	}
	var row rawRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			u.full_name,
			u.phone,
			u.is_active,
			COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered_total,
			COUNT(*) FILTER (WHERE o.status IN ('returned','cancelled')) AS failed_total,
			COUNT(*) FILTER (WHERE o.status IN ('delivered','returned','cancelled')) AS terminal_total,
			COALESCE((
				SELECT AVG(EXTRACT(EPOCH FROM (tl_del.created_at - oa_first.assigned_at)) / 60.0)
				FROM orders o2
				JOIN LATERAL (
					SELECT MIN(oa.assigned_at) AS assigned_at FROM order_assignments oa WHERE oa.order_id = o2.id
				) oa_first ON TRUE
				JOIN LATERAL (
					SELECT ot.created_at FROM order_timeline ot
					WHERE ot.order_id = o2.id AND ot.to_status = 'delivered'
					ORDER BY ot.created_at DESC LIMIT 1
				) tl_del ON TRUE
				WHERE o2.courier_id = u.id AND o2.status = 'delivered' AND o2.deleted_at IS NULL
			), 0) AS avg_delivery_minutes,
			GREATEST(0, COALESCE(SUM(
				CASE WHEN o.status = 'delivered' AND o.id NOT IN (
					SELECT cho.order_id FROM cash_handover_orders cho
					JOIN cash_handovers ch ON ch.id = cho.handover_id
					WHERE ch.status IN ('pending','confirmed')
				) THEN GREATEST(0, o.total_amount + o.delivery_fee - COALESCE(o.prepayment_amount,0)) ELSE 0 END
			), 0) + COALESCE((
				-- confirmed-handover net shortfall — see ListCouriers' shortfall_cte
				SELECT SUM(ch2.total_to_return - COALESCE(ch2.actual_returned, ch2.total_to_return))
				FROM cash_handovers ch2 WHERE ch2.courier_id = u.id AND ch2.status = 'confirmed'
			), 0)) AS cash_debt,
			COALESCE((
				SELECT SUM(COALESCE(actual_returned, total_to_return))
				FROM cash_handovers WHERE courier_id = u.id AND status = 'confirmed'
			), 0) AS total_handed_over,
			COALESCE((
				SELECT SUM(fe.amount) FROM financial_events fe
				WHERE fe.user_id = u.id AND fe.event_type = 'courier_fee_earned'
			), 0) AS earnings,
			COUNT(*) FILTER (WHERE o.status IN ('assigned','in_delivery')) AS active_orders
		FROM users u
		LEFT JOIN orders o ON o.courier_id = u.id AND o.deleted_at IS NULL
		WHERE u.id = ? AND u.role = 'courier' AND u.deleted_at IS NULL
		GROUP BY u.id, u.full_name, u.phone, u.is_active
	`, courierID).Scan(&row).Error
	if err != nil {
		return nil, fmt.Errorf("get courier: %w", err)
	}
	if row.FullName == "" {
		return nil, apperrors.NotFound("courier")
	}

	sr := 0.0
	if row.TerminalTotal > 0 {
		sr = float64(row.DeliveredTotal) * 100 / float64(row.TerminalTotal)
	}
	status := CourierDisplayFree
	if !row.IsActive {
		status = CourierDisplayInactive
	} else if row.ActiveOrders > 0 {
		status = CourierDisplayBusy
	}
	return &CourierDetailResponse{
		CourierID:          courierID,
		FullName:           row.FullName,
		Phone:              row.Phone,
		IsActive:           row.IsActive,
		Status:             status,
		TotalDelivered:     row.DeliveredTotal,
		TotalFailed:        row.FailedTotal,
		SuccessRate:        sr,
		AvgDeliveryMinutes: row.AvgDeliveryMinutes,
		CashDebt:           row.CashDebt,
		TotalHandedOver:    row.TotalHandedOver,
		Earnings:           row.Earnings,
		ActiveOrders:       row.ActiveOrders,
	}, nil
}

// ─── Courier orders ───────────────────────────────────────────────────────────

type CourierOrdersParams struct {
	From   *time.Time
	To     *time.Time
	Status string
}

func (r *Repository) ListCourierOrders(
	ctx context.Context,
	courierID uuid.UUID,
	p pagination.Params,
	params CourierOrdersParams,
) ([]CourierOrderRow, int, error) {
	q := r.db.WithContext(ctx).Table("orders o").
		Select(`
			o.id            AS order_id,
			o.order_number,
			c.full_name     AS customer_name,
			c.phone         AS customer_phone,
			c.address       AS delivery_address,
			o.total_amount,
			o.delivery_fee,
			o.prepayment_amount,
			o.status,
			oa_first.assigned_at,
			tl_del.created_at AS delivered_at,
			EXTRACT(EPOCH FROM (tl_del.created_at - oa_first.assigned_at)) / 60.0 AS delivery_minutes,
			o.notes,
			o.created_at
		`).
		Joins("JOIN customers c ON c.id = o.customer_id").
		Joins(`JOIN LATERAL (
			SELECT MIN(oa.assigned_at) AS assigned_at
			FROM order_assignments oa WHERE oa.order_id = o.id
		) oa_first ON TRUE`).
		Joins(`LEFT JOIN LATERAL (
			SELECT ot.created_at FROM order_timeline ot
			WHERE ot.order_id = o.id AND ot.to_status = 'delivered'
			ORDER BY ot.created_at DESC LIMIT 1
		) tl_del ON TRUE`).
		Where("o.courier_id = ? AND o.deleted_at IS NULL", courierID)

	if params.Status != "" {
		q = q.Where("o.status = ?", params.Status)
	}
	if params.From != nil {
		q = q.Where("o.created_at >= ?", *params.From)
	}
	if params.To != nil {
		q = q.Where("o.created_at <= ?", *params.To)
	}

	var total int64
	if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count courier orders: %w", err)
	}

	type rawRow struct {
		OrderID          uuid.UUID  `gorm:"column:order_id"`
		OrderNumber      string     `gorm:"column:order_number"`
		CustomerName     string     `gorm:"column:customer_name"`
		CustomerPhone    *string    `gorm:"column:customer_phone"`
		DeliveryAddress  *string    `gorm:"column:delivery_address"`
		TotalAmount      float64    `gorm:"column:total_amount"`
		DeliveryFee      float64    `gorm:"column:delivery_fee"`
		PrepaymentAmount float64    `gorm:"column:prepayment_amount"`
		Status           string     `gorm:"column:status"`
		AssignedAt       *time.Time `gorm:"column:assigned_at"`
		DeliveredAt      *time.Time `gorm:"column:delivered_at"`
		DeliveryMinutes  *float64   `gorm:"column:delivery_minutes"`
		Notes            *string    `gorm:"column:notes"`
		CreatedAt        time.Time  `gorm:"column:created_at"`
	}
	var rows []rawRow
	if err := q.Order("o.created_at DESC").Limit(p.Limit).Offset(p.Offset()).Scan(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list courier orders: %w", err)
	}

	result := make([]CourierOrderRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, CourierOrderRow{
			OrderID:          row.OrderID,
			OrderNumber:      row.OrderNumber,
			CustomerName:     row.CustomerName,
			CustomerPhone:    row.CustomerPhone,
			DeliveryAddress:  row.DeliveryAddress,
			TotalAmount:      row.TotalAmount,
			DeliveryFee:      row.DeliveryFee,
			PrepaymentAmount: row.PrepaymentAmount,
			Status:           row.Status,
			AssignedAt:       row.AssignedAt,
			DeliveredAt:      row.DeliveredAt,
			DeliveryMinutes:  row.DeliveryMinutes,
			Notes:            row.Notes,
			CreatedAt:        row.CreatedAt,
		})
	}
	return result, int(total), nil
}

// ─── Courier performance ──────────────────────────────────────────────────────

func (r *Repository) GetCourierPerformance(
	ctx context.Context,
	courierID uuid.UUID,
	from, to time.Time,
) ([]PerformancePoint, error) {
	type rawRow struct {
		Date               string  `gorm:"column:date"`
		Delivered          int     `gorm:"column:delivered"`
		Failed             int     `gorm:"column:failed"`
		CashCollected      float64 `gorm:"column:cash_collected"`
		AvgDeliveryMinutes float64 `gorm:"column:avg_delivery_minutes"`
	}
	var rows []rawRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			TO_CHAR(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
			COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered,
			COUNT(*) FILTER (WHERE o.status IN ('returned','cancelled')) AS failed,
			COALESCE(SUM(
				CASE WHEN o.status = 'delivered'
				THEN GREATEST(0, o.total_amount + o.delivery_fee - COALESCE(o.prepayment_amount,0)) ELSE 0 END
			), 0) AS cash_collected,
			COALESCE(AVG(
				EXTRACT(EPOCH FROM (tl_del.created_at - oa_first.assigned_at)) / 60.0
			) FILTER (WHERE o.status = 'delivered'), 0) AS avg_delivery_minutes
		FROM orders o
		JOIN LATERAL (
			SELECT MIN(oa.assigned_at) AS assigned_at FROM order_assignments oa WHERE oa.order_id = o.id
		) oa_first ON TRUE
		LEFT JOIN LATERAL (
			SELECT ot.created_at FROM order_timeline ot
			WHERE ot.order_id = o.id AND ot.to_status = 'delivered'
			ORDER BY ot.created_at DESC LIMIT 1
		) tl_del ON TRUE
		WHERE o.courier_id = ? AND o.deleted_at IS NULL
		  AND o.updated_at >= ? AND o.updated_at <= ?
		  AND o.status IN ('delivered','returned','cancelled')
		GROUP BY TO_CHAR(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
		ORDER BY date
	`, courierID, from, to).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("courier performance: %w", err)
	}
	result := make([]PerformancePoint, 0, len(rows))
	for _, row := range rows {
		result = append(result, PerformancePoint{
			Date:               row.Date,
			Delivered:          row.Delivered,
			Failed:             row.Failed,
			CashCollected:      row.CashCollected,
			AvgDeliveryMinutes: row.AvgDeliveryMinutes,
		})
	}
	return result, nil
}

// ─── Cash handovers ───────────────────────────────────────────────────────────

func (r *Repository) ListHandovers(ctx context.Context, p pagination.Params, courierID *uuid.UUID, status string, from, to *time.Time) ([]HandoverListRow, int, error) {
	q := r.db.WithContext(ctx).Table("cash_handovers ch").
		Select(`
			ch.id,
			ch.courier_id,
			u.full_name AS courier_name,
			u.phone     AS courier_phone,
			ch.total_collected,
			ch.total_delivery_fees,
			ch.total_to_return,
			ch.actual_returned,
			ch.status,
			ch.proof_url,
			ch.attachments_json,
			ch.comment,
			ch.admin_note,
			ch.confirmed_at,
			ch.created_at,
			GREATEST(0, rd.debt_after) AS courier_debt_after
		`).
		Joins("JOIN users u ON u.id = ch.courier_id").
		// rd computes each handover's running courier balance over the
		// courier's ENTIRE history (unfiltered by this query's own
		// courier/status/date-range params), so debt_after is correct even
		// when the visible page/filter doesn't include the handover(s) that
		// created the debt. Same shortfall formula as ListCouriers'
		// shortfall_cte, just as a running window sum instead of one total.
		Joins(`LEFT JOIN (
			SELECT
				id,
				SUM(CASE WHEN status = 'confirmed'
				         THEN total_to_return - COALESCE(actual_returned, total_to_return)
				         ELSE 0 END)
					OVER (PARTITION BY courier_id ORDER BY created_at, id) AS debt_after
			FROM cash_handovers
		) rd ON rd.id = ch.id`)

	if courierID != nil {
		q = q.Where("ch.courier_id = ?", *courierID)
	}
	if status != "" {
		q = q.Where("ch.status = ?", status)
	}
	if from != nil {
		q = q.Where("ch.created_at >= ?", *from)
	}
	if to != nil {
		q = q.Where("ch.created_at <= ?", *to)
	}

	var total int64
	if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count handovers: %w", err)
	}

	type rawRow struct {
		ID                uuid.UUID  `gorm:"column:id"`
		CourierID         uuid.UUID  `gorm:"column:courier_id"`
		CourierName       string     `gorm:"column:courier_name"`
		CourierPhone      string     `gorm:"column:courier_phone"`
		TotalCollected    float64    `gorm:"column:total_collected"`
		TotalDeliveryFees float64    `gorm:"column:total_delivery_fees"`
		TotalToReturn     float64    `gorm:"column:total_to_return"`
		ActualReturned    *float64   `gorm:"column:actual_returned"`
		Status            string     `gorm:"column:status"`
		ProofURL          *string    `gorm:"column:proof_url"`
		AttachmentsJSON   *string    `gorm:"column:attachments_json"`
		Comment           *string    `gorm:"column:comment"`
		AdminNote         *string    `gorm:"column:admin_note"`
		ConfirmedAt       *time.Time `gorm:"column:confirmed_at"`
		CreatedAt         time.Time  `gorm:"column:created_at"`
		CourierDebtAfter  float64    `gorm:"column:courier_debt_after"`
	}
	var rows []rawRow
	if err := q.Order("ch.created_at DESC").Limit(p.Limit).Offset(p.Offset()).Scan(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list handovers: %w", err)
	}

	result := make([]HandoverListRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, HandoverListRow{
			ID:                row.ID,
			CourierID:         row.CourierID,
			CourierName:       row.CourierName,
			CourierPhone:      row.CourierPhone,
			TotalCollected:    row.TotalCollected,
			TotalDeliveryFees: row.TotalDeliveryFees,
			TotalToReturn:     row.TotalToReturn,
			ActualReturned:    row.ActualReturned,
			Status:            row.Status,
			ProofURL:          row.ProofURL,
			AttachmentsJSON:   row.AttachmentsJSON,
			Comment:           row.Comment,
			AdminNote:         row.AdminNote,
			ConfirmedAt:       row.ConfirmedAt,
			CreatedAt:         row.CreatedAt,
			CourierDebtAfter:  row.CourierDebtAfter,
		})
	}
	return result, int(total), nil
}

func (r *Repository) CreateHandover(ctx context.Context, req CreateHandoverReq) (*HandoverListRow, error) {
	id := uuid.New()
	err := r.db.WithContext(ctx).Exec(`
		INSERT INTO cash_handovers
			(id, courier_id, total_collected, total_delivery_fees, total_to_return, comment, status)
		VALUES (?, ?, ?, ?, ?, ?, 'pending')
	`, id, req.CourierID, req.TotalCollected, req.TotalDeliveryFees, req.TotalToReturn, req.Comment).Error
	if err != nil {
		return nil, fmt.Errorf("create handover: %w", err)
	}
	return r.getHandoverByID(ctx, id)
}

func (r *Repository) UpdateHandover(ctx context.Context, id uuid.UUID, editorID uuid.UUID, req UpdateHandoverReq) (*HandoverListRow, error) {
	existing, err := r.getHandoverByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing.Status != "pending" && existing.Status != "disputed" {
		return nil, apperrors.BadRequest("only pending or disputed handovers can be updated")
	}
	if req.Status != nil && (*req.Status == "rejected" || *req.Status == "cancelled") {
		if req.AdminNote == nil || *req.AdminNote == "" {
			return nil, apperrors.BadRequest("admin_note (rejection reason) is required when rejecting")
		}
	}

	after := *existing
	updates := map[string]interface{}{}
	if req.Comment != nil {
		updates["comment"] = *req.Comment
		after.Comment = req.Comment
	}
	if req.AdminNote != nil {
		updates["admin_note"] = *req.AdminNote
		after.AdminNote = req.AdminNote
	}
	if req.ActualReturned != nil {
		updates["actual_returned"] = *req.ActualReturned
		after.ActualReturned = req.ActualReturned
	}
	action := "update"
	if req.Status != nil {
		updates["status"] = *req.Status
		after.Status = *req.Status
		switch *req.Status {
		case "confirmed":
			now := time.Now().UTC()
			updates["confirmed_at"] = now
			action = "confirm"
		case "rejected":
			action = "reject"
		}
	}
	if len(updates) > 0 {
		err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Table("cash_handovers").Where("id = ?", id).Updates(updates).Error; err != nil {
				return fmt.Errorf("update handover: %w", err)
			}
			return recordHandoverEdit(tx, ctx, id, &editorID, action, existing, &after, nil)
		})
		if err != nil {
			return nil, err
		}
	}
	return r.getHandoverByID(ctx, id)
}

// EditHandover corrects a handover that has already been finalized
// (confirmed/rejected/disputed) — the "we made a mistake" path. The
// initial pending→decision flow stays on UpdateHandover; this method only
// allows landing on confirmed/rejected (enforced by the DTO oneof) and
// appends every applied change to cash_handover_edits inside the same
// transaction, so a correction can never happen without its audit row.
func (r *Repository) EditHandover(ctx context.Context, id uuid.UUID, editorID uuid.UUID, req EditHandoverReq) (*HandoverListRow, error) {
	existing, err := r.getHandoverByID(ctx, id)
	if err != nil {
		return nil, err
	}
	switch existing.Status {
	case "confirmed", "rejected", "disputed":
		// finalized — editable here
	default:
		return nil, apperrors.BadRequest("only confirmed, rejected or disputed handovers can be edited; use the regular update for pending ones")
	}

	newStatus := existing.Status
	if req.Status != nil {
		newStatus = *req.Status
	}
	newAdminNote := existing.AdminNote
	if req.AdminNote != nil {
		newAdminNote = req.AdminNote
	}
	if newStatus == "rejected" && (newAdminNote == nil || *newAdminNote == "") {
		return nil, apperrors.BadRequest("admin_note (rejection reason) is required when rejecting")
	}

	after := *existing
	updates := map[string]interface{}{}
	if req.Status != nil && *req.Status != existing.Status {
		updates["status"] = *req.Status
		after.Status = *req.Status
		if *req.Status == "confirmed" {
			now := time.Now().UTC()
			updates["confirmed_at"] = now
			after.ConfirmedAt = &now
		} else {
			// No longer confirmed — the confirmation timestamp no longer
			// describes the row's state.
			updates["confirmed_at"] = gorm.Expr("NULL")
			after.ConfirmedAt = nil
		}
	}
	if req.ActualReturned != nil && (existing.ActualReturned == nil || *existing.ActualReturned != *req.ActualReturned) {
		updates["actual_returned"] = *req.ActualReturned
		after.ActualReturned = req.ActualReturned
	}
	if req.AdminNote != nil && !strPtrEqual(existing.AdminNote, req.AdminNote) {
		updates["admin_note"] = *req.AdminNote
		after.AdminNote = req.AdminNote
	}
	if req.Comment != nil && !strPtrEqual(existing.Comment, req.Comment) {
		updates["comment"] = *req.Comment
		after.Comment = req.Comment
	}
	if len(updates) == 0 {
		return nil, apperrors.BadRequest("nothing to change")
	}

	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Table("cash_handovers").Where("id = ?", id).Updates(updates).Error; err != nil {
			return fmt.Errorf("edit handover: %w", err)
		}
		return recordHandoverEdit(tx, ctx, id, &editorID, "edit", existing, &after, req.Reason)
	})
	if err != nil {
		return nil, err
	}
	return r.getHandoverByID(ctx, id)
}

// ListHandoverEdits returns a handover's full edit history, oldest first.
func (r *Repository) ListHandoverEdits(ctx context.Context, handoverID uuid.UUID) ([]HandoverEditRow, error) {
	if _, err := r.getHandoverByID(ctx, handoverID); err != nil {
		return nil, err
	}
	var rows []HandoverEditRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			e.id,
			e.handover_id,
			e.editor_id,
			u.full_name          AS editor_name,
			e.action,
			e.old_status::text   AS old_status,
			e.new_status::text   AS new_status,
			e.old_actual_returned,
			e.new_actual_returned,
			e.old_admin_note,
			e.new_admin_note,
			e.old_comment,
			e.new_comment,
			e.reason,
			e.created_at
		FROM cash_handover_edits e
		LEFT JOIN users u ON u.id = e.editor_id
		WHERE e.handover_id = ?
		ORDER BY e.created_at ASC, e.id ASC
	`, handoverID).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("list handover edits: %w", err)
	}
	return rows, nil
}

// recordHandoverEdit appends one audit row describing a handover change.
// Always called inside the same transaction as the change itself.
// created_at is set from Go's clock rather than the column's NOW() default:
// NOW() is fixed for a whole transaction, so two edits inside one enclosing
// transaction would tie on created_at and lose their ordering.
func recordHandoverEdit(tx *gorm.DB, ctx context.Context, handoverID uuid.UUID, editorID *uuid.UUID, action string, before, after *HandoverListRow, reason *string) error {
	err := tx.WithContext(ctx).Exec(`
		INSERT INTO cash_handover_edits
			(handover_id, editor_id, action,
			 old_status, new_status,
			 old_actual_returned, new_actual_returned,
			 old_admin_note, new_admin_note,
			 old_comment, new_comment,
			 reason, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, handoverID, editorID, action,
		before.Status, after.Status,
		before.ActualReturned, after.ActualReturned,
		before.AdminNote, after.AdminNote,
		before.Comment, after.Comment,
		reason, time.Now().UTC()).Error
	if err != nil {
		return fmt.Errorf("record handover edit: %w", err)
	}
	return nil
}

func strPtrEqual(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func (r *Repository) DeleteHandover(ctx context.Context, id uuid.UUID) error {
	existing, err := r.getHandoverByID(ctx, id)
	if err != nil {
		return err
	}
	if existing.Status != "pending" {
		return apperrors.BadRequest("only pending handovers can be deleted")
	}
	return r.db.WithContext(ctx).Exec("DELETE FROM cash_handovers WHERE id = ?", id).Error
}

func (r *Repository) getHandoverByID(ctx context.Context, id uuid.UUID) (*HandoverListRow, error) {
	type rawRow struct {
		ID                uuid.UUID  `gorm:"column:id"`
		CourierID         uuid.UUID  `gorm:"column:courier_id"`
		CourierName       string     `gorm:"column:courier_name"`
		CourierPhone      string     `gorm:"column:courier_phone"`
		TotalCollected    float64    `gorm:"column:total_collected"`
		TotalDeliveryFees float64    `gorm:"column:total_delivery_fees"`
		TotalToReturn     float64    `gorm:"column:total_to_return"`
		ActualReturned    *float64   `gorm:"column:actual_returned"`
		Status            string     `gorm:"column:status"`
		ProofURL          *string    `gorm:"column:proof_url"`
		AttachmentsJSON   *string    `gorm:"column:attachments_json"`
		Comment           *string    `gorm:"column:comment"`
		AdminNote         *string    `gorm:"column:admin_note"`
		ConfirmedAt       *time.Time `gorm:"column:confirmed_at"`
		CreatedAt         time.Time  `gorm:"column:created_at"`
	}
	var row rawRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT ch.*, u.full_name AS courier_name, u.phone AS courier_phone
		FROM cash_handovers ch JOIN users u ON u.id = ch.courier_id
		WHERE ch.id = ?
	`, id).Scan(&row).Error
	if err != nil {
		return nil, fmt.Errorf("get handover: %w", err)
	}
	if row.ID == uuid.Nil {
		return nil, apperrors.NotFound("handover")
	}
	return &HandoverListRow{
		ID:                row.ID,
		CourierID:         row.CourierID,
		CourierName:       row.CourierName,
		CourierPhone:      row.CourierPhone,
		TotalCollected:    row.TotalCollected,
		TotalDeliveryFees: row.TotalDeliveryFees,
		TotalToReturn:     row.TotalToReturn,
		ActualReturned:    row.ActualReturned,
		Status:            row.Status,
		ProofURL:          row.ProofURL,
		AttachmentsJSON:   row.AttachmentsJSON,
		Comment:           row.Comment,
		AdminNote:         row.AdminNote,
		ConfirmedAt:       row.ConfirmedAt,
		CreatedAt:         row.CreatedAt,
	}, nil
}
