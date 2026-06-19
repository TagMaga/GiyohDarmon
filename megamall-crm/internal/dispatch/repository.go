package dispatch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/orders"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) DB() *gorm.DB { return r.db }

// ─── Board ────────────────────────────────────────────────────────────────────

// ListBoardOrders returns all orders in confirmed/assigned/in_delivery status
// joined with their active assignment (if any).
func (r *Repository) ListBoardOrders(ctx context.Context, p pagination.Params) ([]BoardOrder, int, error) {
	type row struct {
		OrderID      uuid.UUID          `gorm:"column:order_id"`
		OrderNumber  string             `gorm:"column:order_number"`
		Status       orders.OrderStatus `gorm:"column:status"`
		CustomerID   uuid.UUID          `gorm:"column:customer_id"`
		TotalAmount  float64            `gorm:"column:total_amount"`
		DeliveryFee  float64            `gorm:"column:delivery_fee"`
		ScheduledAt  *time.Time         `gorm:"column:scheduled_at"`
		CourierID    *uuid.UUID         `gorm:"column:courier_id"`
		AssignmentID *uuid.UUID         `gorm:"column:assignment_id"`
		AssignedAt   *time.Time         `gorm:"column:assigned_at"`
		Notes        *string            `gorm:"column:notes"`
		CreatedAt    time.Time          `gorm:"column:created_at"`
	}

	base := r.db.WithContext(ctx).Table("orders o").
		Select(`
			o.id           AS order_id,
			o.order_number,
			o.status,
			o.customer_id,
			o.total_amount,
			o.delivery_fee,
			o.scheduled_at,
			o.courier_id,
			oa.id          AS assignment_id,
			oa.assigned_at,
			o.notes,
			o.created_at
		`).
		Joins("LEFT JOIN order_assignments oa ON oa.order_id = o.id AND oa.is_active = TRUE").
		Where("o.status IN ? AND o.deleted_at IS NULL",
			[]orders.OrderStatus{orders.StatusConfirmed, orders.StatusAssigned, orders.StatusInDelivery})

	var total int64
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count board orders: %w", err)
	}

	var rows []row
	if err := base.Order("o.created_at DESC").
		Limit(p.Limit).Offset(p.Offset()).
		Scan(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list board orders: %w", err)
	}

	result := make([]BoardOrder, 0, len(rows))
	for _, r := range rows {
		result = append(result, BoardOrder{
			OrderID:      r.OrderID,
			OrderNumber:  r.OrderNumber,
			Status:       r.Status,
			CustomerID:   r.CustomerID,
			TotalAmount:  r.TotalAmount,
			DeliveryFee:  r.DeliveryFee,
			ScheduledAt:  r.ScheduledAt,
			CourierID:    r.CourierID,
			AssignmentID: r.AssignmentID,
			AssignedAt:   r.AssignedAt,
			Notes:        r.Notes,
			CreatedAt:    r.CreatedAt,
		})
	}
	return result, int(total), nil
}

// GetCouriersOverview returns workload and cash-owed totals per active courier,
// joined with the users table for display name and phone.
func (r *Repository) GetCouriersOverview(ctx context.Context) ([]CourierOverview, error) {
	type overviewRow struct {
		CourierID            uuid.UUID  `gorm:"column:courier_id"`
		FullName             string     `gorm:"column:full_name"`
		Surname              *string    `gorm:"column:surname"`
		TelegramChatID       *string    `gorm:"column:telegram_chat_id"`
		Phone                string     `gorm:"column:phone"`
		IsActive             bool       `gorm:"column:is_active"`
		AssignedOrders       int        `gorm:"column:assigned_orders"`
		InDelivery           int        `gorm:"column:in_delivery"`
		IssueOrders          int        `gorm:"column:issue_orders"`
		CashOwed             float64    `gorm:"column:cash_owed"`
		OrderIntakeEnabled   bool       `gorm:"column:order_intake_enabled"`
		OrderIntakeReason    *string    `gorm:"column:order_intake_reason"`
		OrderIntakeUpdatedAt *time.Time `gorm:"column:order_intake_updated_at"`
	}

	var rows []overviewRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			u.id                                                             AS courier_id,
			u.full_name,
			u.surname,
			u.telegram_chat_id,
			u.phone,
			u.is_active,
			u.courier_order_intake_enabled                                   AS order_intake_enabled,
			u.courier_order_intake_reason                                    AS order_intake_reason,
			u.courier_order_intake_updated_at                                AS order_intake_updated_at,
			COUNT(*) FILTER (WHERE o.status = 'assigned')                   AS assigned_orders,
			COUNT(*) FILTER (WHERE o.status = 'in_delivery')                AS in_delivery,
			COUNT(*) FILTER (WHERE o.status = 'issue')                      AS issue_orders,
			COALESCE(SUM(
				CASE WHEN o.status = 'delivered'
				     AND o.id NOT IN (
				         SELECT cho.order_id
				         FROM   cash_handover_orders cho
				         JOIN   cash_handovers ch ON ch.id = cho.handover_id
				         WHERE  ch.status IN ('pending', 'confirmed')
				     )
				     THEN o.total_amount - COALESCE(o.prepayment_amount, 0)
				     ELSE 0 END
			), 0)                                                            AS cash_owed
		FROM users u
		LEFT JOIN orders o ON o.courier_id = u.id
		                   AND o.deleted_at IS NULL
		WHERE u.role       = 'courier'
		  AND u.deleted_at IS NULL
		GROUP BY u.id, u.full_name, u.surname, u.telegram_chat_id, u.phone, u.is_active,
		         u.courier_order_intake_enabled, u.courier_order_intake_reason, u.courier_order_intake_updated_at
		ORDER BY u.full_name
	`).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("couriers overview: %w", err)
	}

	result := make([]CourierOverview, 0, len(rows))
	for _, row := range rows {
		result = append(result, CourierOverview{
			CourierID:            row.CourierID,
			FullName:             row.FullName,
			Surname:              row.Surname,
			TelegramChatID:       row.TelegramChatID,
			Phone:                row.Phone,
			IsActive:             row.IsActive,
			ActiveOrders:         row.AssignedOrders + row.InDelivery + row.IssueOrders,
			AssignedOrders:       row.AssignedOrders,
			InDelivery:           row.InDelivery,
			IssueOrders:          row.IssueOrders,
			CashOwed:             row.CashOwed,
			OrderIntakeEnabled:   row.OrderIntakeEnabled,
			OrderIntakeReason:    row.OrderIntakeReason,
			OrderIntakeUpdatedAt: row.OrderIntakeUpdatedAt,
		})
	}
	return result, nil
}

// GetCashSettlement returns one row per active courier with period-scoped
// delivery, failure, cash and earning metrics. ActiveOrders is intentionally
// current workload and is not constrained by the date range.
func (r *Repository) GetCashSettlement(ctx context.Context, filter CashSettlementFilter) ([]CashSettlementRow, error) {
	type settlementRow struct {
		CourierID          uuid.UUID `gorm:"column:courier_id"`
		CourierName        string    `gorm:"column:courier_name"`
		CourierPhone       string    `gorm:"column:courier_phone"`
		IsOnline           bool      `gorm:"column:is_online"`
		ActiveOrders       int       `gorm:"column:active_orders"`
		Delivered          int       `gorm:"column:delivered"`
		Failed             int       `gorm:"column:failed"`
		AvgDeliverySeconds *float64  `gorm:"column:avg_delivery_seconds"`
		CollectedCash      float64   `gorm:"column:collected_cash"`
		HandedOverCash     float64   `gorm:"column:handed_over_cash"`
		Earnings           float64   `gorm:"column:earnings"`
	}

	var rows []settlementRow
	err := r.db.WithContext(ctx).Raw(`
		WITH
		delivered_events AS (
			SELECT order_id, MAX(created_at) AS delivered_at
			FROM order_timeline
			WHERE to_status = 'delivered'
			GROUP BY order_id
		),
		failed_events AS (
			SELECT order_id, MAX(created_at) AS failed_at
			FROM order_timeline
			WHERE to_status IN ('returned','cancelled')
			GROUP BY order_id
		),
		first_assignment AS (
			SELECT order_id, MIN(assigned_at) AS assigned_at
			FROM order_assignments
			GROUP BY order_id
		),
		last_assignment AS (
			SELECT DISTINCT ON (order_id) order_id, courier_id
			FROM order_assignments
			ORDER BY order_id, assigned_at DESC
		),
		latest_status AS (
			SELECT DISTINCT ON (courier_id) courier_id, status
			FROM courier_status_logs
			ORDER BY courier_id, created_at DESC
		),
		active_cte AS (
			SELECT courier_id, COUNT(*) AS active_orders
			FROM orders
			WHERE deleted_at IS NULL
			  AND courier_id IS NOT NULL
			  AND status IN ('assigned','in_delivery','issue')
			GROUP BY courier_id
		),
		metrics_cte AS (
			SELECT
				COALESCE(o.courier_id, la.courier_id) AS courier_id,
				COUNT(*) FILTER (
					WHERE o.status = 'delivered'
					  AND (?::timestamptz IS NULL OR COALESCE(de.delivered_at, o.updated_at) >= ?)
					  AND (?::timestamptz IS NULL OR COALESCE(de.delivered_at, o.updated_at) <= ?)
				) AS delivered,
				COUNT(*) FILTER (
					WHERE o.status IN ('returned','cancelled')
					  AND la.courier_id IS NOT NULL
					  AND (?::timestamptz IS NULL OR COALESCE(fe.failed_at, o.updated_at) >= ?)
					  AND (?::timestamptz IS NULL OR COALESCE(fe.failed_at, o.updated_at) <= ?)
				) AS failed,
				AVG(EXTRACT(EPOCH FROM (COALESCE(de.delivered_at, o.updated_at) - fa.assigned_at))) FILTER (
					WHERE o.status = 'delivered'
					  AND fa.assigned_at IS NOT NULL
					  AND COALESCE(de.delivered_at, o.updated_at) >= fa.assigned_at
					  AND (?::timestamptz IS NULL OR COALESCE(de.delivered_at, o.updated_at) >= ?)
					  AND (?::timestamptz IS NULL OR COALESCE(de.delivered_at, o.updated_at) <= ?)
				) AS avg_delivery_seconds,
				COALESCE(SUM(
					CASE WHEN o.status = 'delivered'
					  AND (?::timestamptz IS NULL OR COALESCE(de.delivered_at, o.updated_at) >= ?)
					  AND (?::timestamptz IS NULL OR COALESCE(de.delivered_at, o.updated_at) <= ?)
					THEN GREATEST(0, o.total_amount + o.delivery_fee - COALESCE(o.prepayment_amount, 0))
					ELSE 0 END
				), 0) AS collected_cash,
				COALESCE(SUM(
					CASE WHEN o.status = 'delivered'
					  AND (?::timestamptz IS NULL OR COALESCE(de.delivered_at, o.updated_at) >= ?)
					  AND (?::timestamptz IS NULL OR COALESCE(de.delivered_at, o.updated_at) <= ?)
					THEN COALESCE(o.courier_payout, 0)
					ELSE 0 END
				), 0) AS earnings
			FROM orders o
			LEFT JOIN delivered_events de ON de.order_id = o.id
			LEFT JOIN failed_events fe ON fe.order_id = o.id
			LEFT JOIN first_assignment fa ON fa.order_id = o.id
			LEFT JOIN last_assignment la ON la.order_id = o.id
			WHERE o.deleted_at IS NULL AND COALESCE(o.courier_id, la.courier_id) IS NOT NULL
			GROUP BY COALESCE(o.courier_id, la.courier_id)
		),
		handover_cte AS (
			SELECT
				ch.courier_id,
				COALESCE(SUM(COALESCE(ch.actual_returned, ch.total_to_return)), 0) AS handed_over_cash
			FROM cash_handovers ch
			WHERE ch.status = 'confirmed'
			  AND (?::timestamptz IS NULL OR COALESCE(ch.confirmed_at, ch.created_at) >= ?)
			  AND (?::timestamptz IS NULL OR COALESCE(ch.confirmed_at, ch.created_at) <= ?)
			GROUP BY ch.courier_id
		)
		SELECT
			u.id AS courier_id,
			u.full_name AS courier_name,
			u.phone AS courier_phone,
			COALESCE(ls.status IN ('online','busy'), FALSE) AS is_online,
			COALESCE(a.active_orders, 0) AS active_orders,
			COALESCE(m.delivered, 0) AS delivered,
			COALESCE(m.failed, 0) AS failed,
			m.avg_delivery_seconds AS avg_delivery_seconds,
			COALESCE(m.collected_cash, 0) AS collected_cash,
			COALESCE(h.handed_over_cash, 0) AS handed_over_cash,
			COALESCE(m.earnings, 0) AS earnings
		FROM users u
		LEFT JOIN latest_status ls ON ls.courier_id = u.id
		LEFT JOIN active_cte a ON a.courier_id = u.id
		LEFT JOIN metrics_cte m ON m.courier_id = u.id
		LEFT JOIN handover_cte h ON h.courier_id = u.id
		WHERE u.role = 'courier'
		  AND u.deleted_at IS NULL
		  AND u.is_active = TRUE
		  AND (?::uuid IS NULL OR u.id = ?)
		ORDER BY u.full_name
	`,
		filter.From, filter.From, filter.To, filter.To,
		filter.From, filter.From, filter.To, filter.To,
		filter.From, filter.From, filter.To, filter.To,
		filter.From, filter.From, filter.To, filter.To,
		filter.From, filter.From, filter.To, filter.To,
		filter.From, filter.From, filter.To, filter.To,
		filter.CourierID, filter.CourierID,
	).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("cash settlement: %w", err)
	}

	result := make([]CashSettlementRow, 0, len(rows))
	for _, row := range rows {
		var avgSeconds *int
		if row.AvgDeliverySeconds != nil {
			seconds := int(*row.AvgDeliverySeconds + 0.5)
			avgSeconds = &seconds
		}

		result = append(result, CashSettlementRow{
			CourierID:          row.CourierID,
			CourierName:        row.CourierName,
			CourierPhone:       row.CourierPhone,
			IsOnline:           row.IsOnline,
			ActiveOrders:       row.ActiveOrders,
			Delivered:          row.Delivered,
			Failed:             row.Failed,
			SuccessRate:        cashSettlementSuccessRate(row.Delivered, row.Failed),
			AvgDeliverySeconds: avgSeconds,
			CashDebt:           cashSettlementDebt(row.CollectedCash, row.HandedOverCash),
			Earnings:           row.Earnings,
		})
	}
	return result, nil
}

func cashSettlementSuccessRate(delivered, failed int) *float64 {
	total := delivered + failed
	if total <= 0 {
		return nil
	}
	rate := float64(delivered) * 100 / float64(total)
	return &rate
}

// cashSettlementDebt is the cash the courier still owes: full collected client
// cash minus what they have handed over. Courier payout is NOT subtracted — it is
// a company expense paid to the courier separately, not cash the courier keeps.
func cashSettlementDebt(collectedCash, handedOverCash float64) float64 {
	debt := collectedCash - handedOverCash
	if debt < 0 {
		return 0
	}
	return debt
}

func (r *Repository) ListCashTransactions(ctx context.Context, filter CashTransactionFilter, p pagination.Params) ([]CashTransactionRow, int, error) {
	q := r.db.WithContext(ctx).Table("cash_handovers ch").
		Joins("JOIN users u ON u.id = ch.courier_id").
		Where("u.deleted_at IS NULL")

	if filter.From != nil {
		q = q.Where("ch.created_at >= ?", filter.From)
	}
	if filter.To != nil {
		q = q.Where("ch.created_at <= ?", filter.To)
	}
	if filter.CourierID != nil {
		q = q.Where("ch.courier_id = ?", *filter.CourierID)
	}
	if filter.Status != "" {
		q = q.Where("ch.status = ?", filter.Status)
	}

	var total int64
	if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count cash transactions: %w", err)
	}

	type cashTransactionScan struct {
		ID              uuid.UUID  `gorm:"column:id"`
		CourierID       uuid.UUID  `gorm:"column:courier_id"`
		CourierName     string     `gorm:"column:courier_name"`
		CourierPhone    string     `gorm:"column:courier_phone"`
		CreatedAt       time.Time  `gorm:"column:created_at"`
		Amount          float64    `gorm:"column:amount"`
		Status          string     `gorm:"column:status"`
		Note            *string    `gorm:"column:note"`
		RejectionReason *string    `gorm:"column:rejection_reason"`
		PhotoURL        *string    `gorm:"column:photo_url"`
		ConfirmedBy     *uuid.UUID `gorm:"column:confirmed_by"`
		ConfirmedAt     *time.Time `gorm:"column:confirmed_at"`
	}

	var rows []cashTransactionScan
	if err := q.Select(`
			ch.id,
			ch.courier_id,
			u.full_name AS courier_name,
			u.phone AS courier_phone,
			ch.created_at,
			COALESCE(ch.actual_returned, ch.total_to_return) AS amount,
			ch.status::text AS status,
			ch.comment AS note,
			CASE WHEN ch.status = 'rejected' THEN COALESCE(ch.admin_note, ch.comment) ELSE NULL END AS rejection_reason,
			ch.proof_url AS photo_url,
			ch.dispatcher_id AS confirmed_by,
			ch.confirmed_at
		`).
		Order("ch.created_at DESC").
		Limit(p.Limit).Offset(p.Offset()).
		Scan(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list cash transactions: %w", err)
	}

	out := make([]CashTransactionRow, 0, len(rows))
	for _, row := range rows {
		out = append(out, CashTransactionRow(row))
	}
	return out, int(total), nil
}

func (r *Repository) ListOrderHistory(ctx context.Context, filter OrderHistoryFilter, p pagination.Params) ([]OrderHistoryRow, int, error) {
	base := r.orderHistoryBase(ctx, filter)

	var total int64
	countQuery := r.db.WithContext(ctx).Table("(?) AS history_count", base.Select("o.id").Group("o.id"))
	if err := countQuery.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count dispatch order history: %w", err)
	}

	type historyScan struct {
		ID                 uuid.UUID          `gorm:"column:id"`
		OrderNumber        string             `gorm:"column:order_number"`
		CreatedAt          time.Time          `gorm:"column:created_at"`
		Status             orders.OrderStatus `gorm:"column:status"`
		ProductsJSON       string             `gorm:"column:products_json"`
		CourierID          *uuid.UUID         `gorm:"column:courier_id"`
		CourierName        *string            `gorm:"column:courier_name"`
		CourierPhone       *string            `gorm:"column:courier_phone"`
		SellerID           uuid.UUID          `gorm:"column:seller_id"`
		SellerName         string             `gorm:"column:seller_name"`
		TotalAmount        float64            `gorm:"column:total_amount"`
		DeliveryFee        float64            `gorm:"column:delivery_fee"`
		DeliveredAt        *time.Time         `gorm:"column:delivered_at"`
		ProcessSeconds     *float64           `gorm:"column:process_seconds"`
		CancellationReason *string            `gorm:"column:cancellation_reason"`
		CustomerName       string             `gorm:"column:customer_name"`
		CustomerPhone      string             `gorm:"column:customer_phone"`
		DeliveryAddress    *string            `gorm:"column:delivery_address"`
	}

	var rows []historyScan
	if err := base.Select(`
			o.id,
			o.order_number,
			o.created_at,
			o.status,
			COALESCE(
				jsonb_agg(
					jsonb_build_object(
						'product_id', oi.product_id,
						'name', COALESCE(p.name, oi.product_id::text),
						'quantity', oi.quantity
					)
					ORDER BY COALESCE(p.name, oi.product_id::text)
				) FILTER (WHERE oi.id IS NOT NULL),
				'[]'::jsonb
			)::text AS products_json,
			COALESCE(o.courier_id, la.courier_id) AS courier_id,
			cu.full_name AS courier_name,
			cu.phone AS courier_phone,
			o.seller_id,
			s.full_name AS seller_name,
			o.total_amount,
			o.delivery_fee,
			de.delivered_at,
			CASE
				WHEN de.delivered_at IS NOT NULL AND de.delivered_at >= COALESCE(ps.process_started_at, o.created_at)
				THEN EXTRACT(EPOCH FROM (de.delivered_at - COALESCE(ps.process_started_at, o.created_at)))
				ELSE NULL
			END AS process_seconds,
			CASE WHEN o.status IN ('cancelled','returned') THEN ce.reason ELSE NULL END AS cancellation_reason,
			c.full_name AS customer_name,
			c.phone AS customer_phone,
			c.address AS delivery_address
		`).
		Group(`
			o.id, o.order_number, o.created_at, o.status, o.courier_id, la.courier_id,
			cu.full_name, cu.phone, o.seller_id, s.full_name, o.total_amount, o.delivery_fee,
			de.delivered_at, ps.process_started_at, ce.reason, c.full_name, c.phone, c.address
		`).
		Order("o.created_at DESC").
		Limit(p.Limit).Offset(p.Offset()).
		Scan(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list dispatch order history: %w", err)
	}

	out := make([]OrderHistoryRow, 0, len(rows))
	for _, row := range rows {
		products := make([]OrderHistoryProduct, 0)
		if err := json.Unmarshal([]byte(row.ProductsJSON), &products); err != nil {
			return nil, 0, fmt.Errorf("decode order history products: %w", err)
		}
		var seconds *int
		if row.ProcessSeconds != nil {
			v := int(*row.ProcessSeconds + 0.5)
			seconds = &v
		}
		out = append(out, OrderHistoryRow{
			ID:                 row.ID,
			OrderNumber:        row.OrderNumber,
			CreatedAt:          row.CreatedAt,
			Status:             row.Status,
			Products:           products,
			CourierID:          row.CourierID,
			CourierName:        row.CourierName,
			CourierPhone:       row.CourierPhone,
			SellerID:           row.SellerID,
			SellerName:         row.SellerName,
			TotalAmount:        row.TotalAmount,
			DeliveryFee:        row.DeliveryFee,
			DeliveredAt:        row.DeliveredAt,
			ProcessSeconds:     seconds,
			CancellationReason: row.CancellationReason,
			CustomerName:       row.CustomerName,
			CustomerPhone:      row.CustomerPhone,
			DeliveryAddress:    row.DeliveryAddress,
		})
	}
	return out, int(total), nil
}

func (r *Repository) orderHistoryBase(ctx context.Context, filter OrderHistoryFilter) *gorm.DB {
	q := r.db.WithContext(ctx).Table("orders o").
		Joins("JOIN customers c ON c.id = o.customer_id").
		Joins("JOIN users s ON s.id = o.seller_id").
		Joins("LEFT JOIN order_items oi ON oi.order_id = o.id").
		Joins("LEFT JOIN products p ON p.id = oi.product_id").
		Joins(`LEFT JOIN LATERAL (
			SELECT oa.courier_id
			FROM order_assignments oa
			WHERE oa.order_id = o.id
			ORDER BY oa.assigned_at DESC
			LIMIT 1
		) la ON TRUE`).
		Joins("LEFT JOIN users cu ON cu.id = COALESCE(o.courier_id, la.courier_id)").
		Joins(`LEFT JOIN LATERAL (
			SELECT MAX(ot.created_at) AS delivered_at
			FROM order_timeline ot
			WHERE ot.order_id = o.id AND ot.to_status = 'delivered'
		) de ON TRUE`).
		Joins(`LEFT JOIN LATERAL (
			SELECT MIN(ot.created_at) AS process_started_at
			FROM order_timeline ot
			WHERE ot.order_id = o.id AND ot.to_status IN ('confirmed','assigned','in_delivery')
		) ps ON TRUE`).
		Joins(`LEFT JOIN LATERAL (
			SELECT ot.comment AS reason
			FROM order_timeline ot
			WHERE ot.order_id = o.id AND ot.to_status IN ('cancelled','returned')
			ORDER BY ot.created_at DESC
			LIMIT 1
		) ce ON TRUE`).
		Where("o.deleted_at IS NULL")

	if filter.From != nil {
		q = q.Where("o.created_at >= ?", filter.From)
	}
	if filter.To != nil {
		q = q.Where("o.created_at <= ?", filter.To)
	}
	if filter.CourierID != nil {
		q = q.Where("COALESCE(o.courier_id, la.courier_id) = ?", *filter.CourierID)
	}
	if filter.SellerID != nil {
		q = q.Where("o.seller_id = ?", *filter.SellerID)
	}
	if filter.ProductID != nil {
		q = q.Where("EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id = o.id AND oi2.product_id = ?)", *filter.ProductID)
	}
	if filter.Status != "" {
		q = q.Where("o.status = ?", filter.Status)
	}
	if strings.TrimSpace(filter.Product) != "" {
		term := "%" + strings.TrimSpace(filter.Product) + "%"
		q = q.Where("EXISTS (SELECT 1 FROM order_items oi3 LEFT JOIN products p3 ON p3.id = oi3.product_id WHERE oi3.order_id = o.id AND (p3.name ILIKE ? OR oi3.product_id::text ILIKE ?))", term, term)
	}
	if strings.TrimSpace(filter.Seller) != "" {
		term := "%" + strings.TrimSpace(filter.Seller) + "%"
		q = q.Where("(s.full_name ILIKE ? OR s.phone ILIKE ?)", term, term)
	}
	if strings.TrimSpace(filter.Search) != "" {
		term := "%" + strings.TrimSpace(filter.Search) + "%"
		q = q.Where("(o.order_number ILIKE ? OR o.id::text ILIKE ? OR c.full_name ILIKE ? OR c.phone ILIKE ? OR c.address ILIKE ?)", term, term, term, term, term)
	}
	return q
}

// ─── Order (locked reads) ─────────────────────────────────────────────────────

// GetOrderForUpdate fetches an order row with a SELECT FOR UPDATE lock.
// Must be called inside a transaction.
func (r *Repository) GetOrderForUpdate(tx *gorm.DB, ctx context.Context, orderID uuid.UUID) (*orders.Order, error) {
	var o orders.Order
	err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND deleted_at IS NULL", orderID).
		First(&o).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperrors.NotFound("order")
	}
	if err != nil {
		return nil, fmt.Errorf("lock order: %w", err)
	}
	return &o, nil
}

// GetOrder fetches an order row without a lock (read-only path).
func (r *Repository) GetOrder(ctx context.Context, orderID uuid.UUID) (*orders.Order, error) {
	var o orders.Order
	err := r.db.WithContext(ctx).
		Where("id = ? AND deleted_at IS NULL", orderID).
		First(&o).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperrors.NotFound("order")
	}
	if err != nil {
		return nil, fmt.Errorf("get order: %w", err)
	}
	return &o, nil
}

// ─── Assignments ──────────────────────────────────────────────────────────────

// GetActiveAssignment returns the is_active=true assignment for an order, or nil.
// Must be called inside a transaction (uses the passed tx for lock consistency).
func (r *Repository) GetActiveAssignment(tx *gorm.DB, ctx context.Context, orderID uuid.UUID) (*OrderAssignment, error) {
	var a OrderAssignment
	err := tx.WithContext(ctx).
		Where("order_id = ? AND is_active = TRUE", orderID).
		First(&a).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get active assignment: %w", err)
	}
	return &a, nil
}

// CourierExists reports whether userID belongs to an active user whose role is
// 'courier'. Used to validate assign/reassign targets (H3) so a non-courier user
// (owner, seller, manager, …) can never be set as an order's courier.
func (r *Repository) CourierExists(tx *gorm.DB, ctx context.Context, userID uuid.UUID) (bool, error) {
	var count int64
	err := tx.WithContext(ctx).
		Table("users").
		Where("id = ? AND role = 'courier' AND is_active = TRUE AND deleted_at IS NULL", userID).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("validate courier: %w", err)
	}
	return count > 0, nil
}

func (r *Repository) CourierOrderIntakeEnabled(tx *gorm.DB, ctx context.Context, courierID uuid.UUID) (bool, error) {
	var enabled bool
	err := tx.WithContext(ctx).
		Table("users").
		Select("courier_order_intake_enabled").
		Where("id = ? AND role = 'courier' AND is_active = TRUE AND deleted_at IS NULL", courierID).
		Scan(&enabled).Error
	if err != nil {
		return false, fmt.Errorf("check courier order intake: %w", err)
	}
	return enabled, nil
}

func (r *Repository) UpdateCourierOrderIntake(ctx context.Context, courierID, actorID uuid.UUID, enabled bool, reason *string) (*CourierOverview, error) {
	now := time.Now().UTC()
	updates := map[string]interface{}{
		"courier_order_intake_enabled":    enabled,
		"courier_order_intake_reason":     reason,
		"courier_order_intake_updated_at": now,
		"courier_order_intake_updated_by": actorID,
		"updated_at":                      now,
	}
	if enabled {
		updates["courier_order_intake_reason"] = nil
	}

	result := r.db.WithContext(ctx).
		Table("users").
		Where("id = ? AND role = 'courier' AND deleted_at IS NULL", courierID).
		Updates(updates)
	if result.Error != nil {
		return nil, fmt.Errorf("update courier order intake: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return nil, apperrors.NotFound("courier")
	}

	rows, err := r.GetCouriersOverview(ctx)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if rows[i].CourierID == courierID {
			return &rows[i], nil
		}
	}
	return nil, apperrors.NotFound("courier")
}

// CreateAssignment inserts a new assignment row. Must be inside a transaction.
func (r *Repository) CreateAssignment(tx *gorm.DB, ctx context.Context, a *OrderAssignment) error {
	if err := tx.WithContext(ctx).Create(a).Error; err != nil {
		return fmt.Errorf("create assignment: %w", err)
	}
	return nil
}

// DeactivateAssignment marks an assignment as inactive and sets unassigned_at.
// Must be inside a transaction.
func (r *Repository) DeactivateAssignment(tx *gorm.DB, ctx context.Context, assignmentID uuid.UUID) error {
	now := time.Now().UTC()
	result := tx.WithContext(ctx).
		Model(&OrderAssignment{}).
		Where("id = ?", assignmentID).
		Updates(map[string]interface{}{
			"is_active":     false,
			"unassigned_at": now,
		})
	if result.Error != nil {
		return fmt.Errorf("deactivate assignment: %w", result.Error)
	}
	return nil
}

// SetCourierCache updates orders.courier_id (the query cache) inside a transaction.
func (r *Repository) SetCourierCache(tx *gorm.DB, ctx context.Context, orderID uuid.UUID, courierID *uuid.UUID) error {
	return tx.WithContext(ctx).
		Table("orders").
		Where("id = ?", orderID).
		UpdateColumn("courier_id", courierID).Error
}

// SetScheduledAt updates orders.scheduled_at inside a transaction.
func (r *Repository) SetScheduledAt(tx *gorm.DB, ctx context.Context, orderID uuid.UUID, scheduledAt time.Time) error {
	return tx.WithContext(ctx).
		Table("orders").
		Where("id = ?", orderID).
		UpdateColumn("scheduled_at", scheduledAt).Error
}

// SetOrderStatus updates orders.status directly. Used for assign/reassign flows
// that must atomically combine assignment creation with status change.
func (r *Repository) SetOrderStatus(tx *gorm.DB, ctx context.Context, orderID uuid.UUID, status orders.OrderStatus) error {
	return tx.WithContext(ctx).
		Table("orders").
		Where("id = ?", orderID).
		UpdateColumn("status", string(status)).Error
}

// InsertTimeline appends a timeline entry.  Must be inside a transaction.
func (r *Repository) InsertTimeline(tx *gorm.DB, ctx context.Context, entry *orders.OrderTimeline) error {
	return tx.WithContext(ctx).Table("order_timeline").Create(entry).Error
}

// ─── Comments ─────────────────────────────────────────────────────────────────

func (r *Repository) CreateComment(ctx context.Context, c *OrderComment) error {
	if err := r.db.WithContext(ctx).Create(c).Error; err != nil {
		return fmt.Errorf("create comment: %w", err)
	}
	return nil
}

func (r *Repository) ListComments(ctx context.Context, orderID uuid.UUID, visibilities []CommentVisibility) ([]OrderComment, error) {
	var rows []OrderComment
	q := r.db.WithContext(ctx).Where("order_id = ?", orderID)
	if len(visibilities) > 0 {
		q = q.Where("visibility IN ?", visibilities)
	}
	if err := q.Order("created_at ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list comments: %w", err)
	}
	return rows, nil
}
