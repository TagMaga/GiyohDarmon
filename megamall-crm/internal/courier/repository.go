package courier

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/courier_tariffs"
	logistics_settings "github.com/megamall/crm/internal/logistics_settings"
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

// ─── Assignment helpers (internal; avoids importing dispatch package) ─────────

// activeAssignmentRow is a thin local struct for reading assignment data.
type activeAssignmentRow struct {
	ID         uuid.UUID `gorm:"column:id"`
	CourierID  uuid.UUID `gorm:"column:courier_id"`
	AssignedAt time.Time `gorm:"column:assigned_at"`
	IsActive   bool      `gorm:"column:is_active"`
}

// createAssignment inserts a new order_assignment row within a tx.
func (r *Repository) createAssignment(tx *gorm.DB, ctx context.Context, orderID, courierID, assignedBy uuid.UUID) (uuid.UUID, error) {
	id := uuid.New()
	row := map[string]interface{}{
		"id":          id,
		"order_id":    orderID,
		"courier_id":  courierID,
		"assigned_by": assignedBy,
		"assigned_at": time.Now().UTC(),
		"is_active":   true,
	}
	if err := tx.WithContext(ctx).Table("order_assignments").Create(&row).Error; err != nil {
		return uuid.Nil, fmt.Errorf("create assignment: %w", err)
	}
	return id, nil
}

// getActiveAssignment returns the currently active assignment row for
// orderID, verifying it belongs to courierID.
func (r *Repository) getActiveAssignment(ctx context.Context, orderID, courierID uuid.UUID) (*activeAssignmentRow, error) {
	var row activeAssignmentRow
	err := r.db.WithContext(ctx).
		Table("order_assignments").
		Select("id, courier_id, assigned_at, is_active").
		Where("order_id = ? AND is_active = TRUE", orderID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperrors.Forbidden("no active assignment found for this order")
	}
	if err != nil {
		return nil, fmt.Errorf("get active assignment: %w", err)
	}
	if row.CourierID != courierID {
		return nil, apperrors.Forbidden("you are not the assigned courier for this order")
	}
	return &row, nil
}

// verifyActiveAssignment checks that the is_active=true assignment for orderID
// belongs to courierID. Returns apperrors.Forbidden if not.
func (r *Repository) verifyActiveAssignment(ctx context.Context, orderID, courierID uuid.UUID) error {
	_, err := r.getActiveAssignment(ctx, orderID, courierID)
	return err
}

// GetActiveAssignmentTime returns when the caller's active assignment for
// orderID began — UnclaimOrder uses it to enforce its short undo window.
func (r *Repository) GetActiveAssignmentTime(ctx context.Context, orderID, courierID uuid.UUID) (time.Time, error) {
	row, err := r.getActiveAssignment(ctx, orderID, courierID)
	if err != nil {
		return time.Time{}, err
	}
	return row.AssignedAt, nil
}

// GetOrderStatus returns orderID's current status. UnclaimOrder uses it to
// confirm the order is still just-claimed (assigned), not already picked up.
func (r *Repository) GetOrderStatus(ctx context.Context, orderID uuid.UUID) (orders.OrderStatus, error) {
	var status orders.OrderStatus
	err := r.db.WithContext(ctx).
		Table("orders").
		Select("status").
		Where("id = ? AND deleted_at IS NULL", orderID).
		Scan(&status).Error
	if err != nil {
		return "", fmt.Errorf("get order status: %w", err)
	}
	if status == "" {
		return "", apperrors.NotFound("order")
	}
	return status, nil
}

// ─── My Orders ────────────────────────────────────────────────────────────────

// ListMyOrders returns orders assigned to courierID across all relevant statuses:
// assigned, in_delivery, delivered, returned, issue.
// Cancelled orders are excluded.
//
// Strategy: use orders.courier_id (the cache column set by both the dispatcher
// assign flow and the courier claim flow) instead of joining order_assignments,
// so that delivered/returned orders remain visible even after the assignment row
// is deactivated.
func (r *Repository) ListMyOrders(ctx context.Context, courierID uuid.UUID, status string) ([]MyOrderResponse, error) {
	type row struct {
		OrderID              uuid.UUID          `gorm:"column:order_id"`
		OrderNumber          string             `gorm:"column:order_number"`
		Status               orders.OrderStatus `gorm:"column:status"`
		CustomerName         string             `gorm:"column:customer_name"`
		CustomerPhone        string             `gorm:"column:customer_phone"`
		CustomerAddress      *string            `gorm:"column:customer_address"`
		CreatorID            *uuid.UUID         `gorm:"column:creator_id"`
		CreatorName          *string            `gorm:"column:creator_name"`
		CreatorPhone         *string            `gorm:"column:creator_phone"`
		CreatorRole          *string            `gorm:"column:creator_role"`
		CreatorAvatarURL     *string            `gorm:"column:creator_avatar_url"`
		DeliveryMethod       string             `gorm:"column:delivery_method"`
		ProductTotal         float64            `gorm:"column:product_total"`
		DeliveryFee          float64            `gorm:"column:delivery_fee"`
		CourierPayout        float64            `gorm:"column:courier_payout"`
		PrepaymentAmount     float64            `gorm:"column:prepayment_amount"`
		CourierCollectAmount float64            `gorm:"column:courier_collect_amount"`
		ScheduledAt          *time.Time         `gorm:"column:scheduled_at"`
		AssignedAt           *time.Time         `gorm:"column:assigned_at"`
		CreatedAt            time.Time          `gorm:"column:created_at"`
		Notes                *string            `gorm:"column:notes"`
	}

	var rows []row
	err := r.db.WithContext(ctx).
		Table("orders o").
		Select(`
			o.id AS order_id,
			o.order_number,
			o.status,
			c.full_name AS customer_name,
			c.phone AS customer_phone,
			COALESCE(o.delivery_address, c.address) AS customer_address,
			creator.id AS creator_id,
			creator.full_name AS creator_name,
			creator.phone AS creator_phone,
			creator.role AS creator_role,
			creator.avatar_url AS creator_avatar_url,
			COALESCE(o.delivery_method, 'normal') AS delivery_method,
			o.total_amount AS product_total,
			o.delivery_fee,
			o.courier_payout,
			o.prepayment_amount,
			GREATEST(0, o.total_amount + o.delivery_fee - o.prepayment_amount) AS courier_collect_amount,
			o.scheduled_at,
			oa.assigned_at,
			o.created_at,
			o.notes
		`).
		Joins("LEFT JOIN customers c ON c.id = o.customer_id").
		Joins("LEFT JOIN users creator ON creator.id = o.seller_id").
		Joins(`LEFT JOIN order_assignments oa
			ON oa.order_id = o.id
			AND oa.courier_id = ?
			AND oa.assigned_at = (
				SELECT MAX(oa2.assigned_at)
				FROM order_assignments oa2
				WHERE oa2.order_id = o.id AND oa2.courier_id = ?
			)`, courierID, courierID).
		Where(`o.courier_id = ?
			AND o.status NOT IN ?
			AND o.deleted_at IS NULL`,
			courierID,
			[]orders.OrderStatus{orders.StatusCancelled},
		).
		Scopes(func(db *gorm.DB) *gorm.DB {
			if status != "" {
				return db.Where("o.status = ?", status)
			}
			return db
		}).
		Order("oa.assigned_at DESC NULLS LAST, o.created_at DESC").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("list my orders: %w", err)
	}

	// Collect order IDs to batch-fetch items
	orderIDs := make([]uuid.UUID, 0, len(rows))
	idxByID := make(map[uuid.UUID]int, len(rows))
	result := make([]MyOrderResponse, 0, len(rows))
	for i, rw := range rows {
		totalOrderAmount := rw.ProductTotal + rw.DeliveryFee
		amountToCollect := rw.CourierCollectAmount
		result = append(result, MyOrderResponse{
			ID:          rw.OrderID,
			OrderNumber: rw.OrderNumber,
			Status:      rw.Status,
			Customer: OrderCustomer{
				FullName: rw.CustomerName,
				Phone:    rw.CustomerPhone,
				Address:  rw.CustomerAddress,
			},
			CreatorID:            rw.CreatorID,
			CreatorName:          derefStr(rw.CreatorName),
			CreatorPhone:         derefStr(rw.CreatorPhone),
			CreatorRole:          derefStr(rw.CreatorRole),
			CreatorAvatarURL:     rw.CreatorAvatarURL,
			DeliveryMethod:       rw.DeliveryMethod,
			ProductTotal:         rw.ProductTotal,
			DeliveryFee:          rw.DeliveryFee,
			CourierPayout:        rw.CourierPayout,
			PrepaymentAmount:     rw.PrepaymentAmount,
			TotalOrderAmount:     totalOrderAmount,
			AmountToCollect:      amountToCollect,
			CourierCollectAmount: amountToCollect,
			PaymentLabel:         paymentLabel(rw.PrepaymentAmount, totalOrderAmount),
			ScheduledAt:          rw.ScheduledAt,
			AssignedAt:           rw.AssignedAt,
			CreatedAt:            rw.CreatedAt,
			Notes:                rw.Notes,
			Items:                []OrderItemResponse{},
		})
		orderIDs = append(orderIDs, rw.OrderID)
		idxByID[rw.OrderID] = i
	}

	if len(orderIDs) > 0 {
		// Convert UUIDs to strings for reliable GORM IN clause
		idStrs := make([]string, len(orderIDs))
		for i, id := range orderIDs {
			idStrs[i] = id.String()
		}

		type itemRow struct {
			OrderID         string  `gorm:"column:order_id"`
			ProductID       string  `gorm:"column:product_id"`
			ProductName     string  `gorm:"column:product_name"`
			ProductImageURL *string `gorm:"column:product_image_url"`
			Quantity        int     `gorm:"column:quantity"`
			UnitPrice       float64 `gorm:"column:unit_price"`
			TotalPrice      float64 `gorm:"column:total_price"`
		}
		var itemRows []itemRow
		r.db.WithContext(ctx).
			Table("order_items oi").
			Select("oi.order_id::text, oi.product_id::text, p.name AS product_name, oi.quantity, oi.unit_price, oi.total_price, (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = oi.product_id AND pi.is_primary = true LIMIT 1) AS product_image_url").
			Joins("JOIN products p ON p.id = oi.product_id").
			Where("oi.order_id::text IN ?", idStrs).
			Scan(&itemRows)

		for _, ir := range itemRows {
			orderUUID, err := uuid.Parse(ir.OrderID)
			if err != nil {
				continue
			}
			if idx, ok := idxByID[orderUUID]; ok {
				productUUID, _ := uuid.Parse(ir.ProductID)
				result[idx].Items = append(result[idx].Items, OrderItemResponse{
					ProductID:       productUUID,
					ProductName:     ir.ProductName,
					ProductImageURL: ir.ProductImageURL,
					Quantity:        ir.Quantity,
					UnitPrice:       ir.UnitPrice,
					TotalPrice:      ir.TotalPrice,
				})
			}
		}
	}

	return result, nil
}

// ─── Available / Claimable Orders ────────────────────────────────────────────

// paymentLabel classifies a payment as cod / partial_prepayment / full_prepayment.
func paymentLabel(prepayment, totalOrderAmount float64) string {
	if prepayment <= 0 {
		return "cod"
	}
	if prepayment >= totalOrderAmount {
		return "full_prepayment"
	}
	return "partial_prepayment"
}

// derefStr returns the pointed-to string, or "" when the pointer is nil
// (e.g. an order whose creator was deleted or never set).
func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ListAvailableOrders returns confirmed orders with no active assignment.
func (r *Repository) ListAvailableOrders(ctx context.Context, courierID uuid.UUID, p pagination.Params) ([]MyOrderResponse, int, error) {
	enabled, err := r.CourierOrderIntakeEnabled(ctx, courierID)
	if err != nil {
		return nil, 0, err
	}
	if !enabled {
		return []MyOrderResponse{}, 0, nil
	}

	type row struct {
		OrderID              uuid.UUID          `gorm:"column:order_id"`
		OrderNumber          string             `gorm:"column:order_number"`
		Status               orders.OrderStatus `gorm:"column:status"`
		CustomerName         string             `gorm:"column:customer_name"`
		CustomerPhone        string             `gorm:"column:customer_phone"`
		CustomerAddress      *string            `gorm:"column:customer_address"`
		CreatorID            *uuid.UUID         `gorm:"column:creator_id"`
		CreatorName          *string            `gorm:"column:creator_name"`
		CreatorPhone         *string            `gorm:"column:creator_phone"`
		CreatorRole          *string            `gorm:"column:creator_role"`
		CreatorAvatarURL     *string            `gorm:"column:creator_avatar_url"`
		DeliveryMethod       string             `gorm:"column:delivery_method"`
		ProductTotal         float64            `gorm:"column:product_total"`
		DeliveryFee          float64            `gorm:"column:delivery_fee"`
		PrepaymentAmount     float64            `gorm:"column:prepayment_amount"`
		CourierCollectAmount float64            `gorm:"column:courier_collect_amount"`
		ScheduledAt          *time.Time         `gorm:"column:scheduled_at"`
		CreatedAt            time.Time          `gorm:"column:created_at"`
		Notes                *string            `gorm:"column:notes"`
	}

	base := r.db.WithContext(ctx).
		Table("orders o").
		Select(`
			o.id AS order_id, o.order_number, o.status,
			c.full_name AS customer_name,
			c.phone AS customer_phone,
			COALESCE(o.delivery_address, c.address) AS customer_address,
			creator.id AS creator_id,
			creator.full_name AS creator_name,
			creator.phone AS creator_phone,
			creator.role AS creator_role,
			creator.avatar_url AS creator_avatar_url,
			COALESCE(o.delivery_method,'normal') AS delivery_method,
			o.total_amount AS product_total,
			o.delivery_fee,
			o.prepayment_amount,
			GREATEST(0, o.total_amount + o.delivery_fee - o.prepayment_amount) AS courier_collect_amount,
			o.scheduled_at, o.created_at, o.notes
		`).
		Joins("LEFT JOIN customers c ON c.id = o.customer_id").
		Joins("LEFT JOIN users creator ON creator.id = o.seller_id").
		Where(`
			o.status = ? AND o.deleted_at IS NULL AND
			(o.scheduled_at IS NULL OR o.scheduled_at <= NOW()) AND
			NOT EXISTS (
				SELECT 1 FROM order_assignments oa
				WHERE oa.order_id = o.id AND oa.is_active = TRUE
			) AND
			o.city_id IN (
				SELECT cc.city_id FROM courier_cities cc WHERE cc.courier_id = ?
			)
		`, orders.StatusConfirmed, courierID)

	var total int64
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count available orders: %w", err)
	}

	var rows []row
	if err := base.Order("CASE WHEN o.delivery_method IN ('fast','express') THEN 0 ELSE 1 END ASC, o.created_at ASC").
		Limit(p.Limit).Offset(p.Offset()).
		Scan(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list available orders: %w", err)
	}

	result := make([]MyOrderResponse, 0, len(rows))
	for _, rw := range rows {
		totalOrderAmount := rw.ProductTotal + rw.DeliveryFee
		result = append(result, MyOrderResponse{
			ID:          rw.OrderID,
			OrderNumber: rw.OrderNumber,
			Status:      rw.Status,
			Customer: OrderCustomer{
				FullName: rw.CustomerName,
				Phone:    rw.CustomerPhone,
				Address:  rw.CustomerAddress,
			},
			CreatorID:            rw.CreatorID,
			CreatorName:          derefStr(rw.CreatorName),
			CreatorPhone:         derefStr(rw.CreatorPhone),
			CreatorRole:          derefStr(rw.CreatorRole),
			CreatorAvatarURL:     rw.CreatorAvatarURL,
			DeliveryMethod:       rw.DeliveryMethod,
			ProductTotal:         rw.ProductTotal,
			DeliveryFee:          rw.DeliveryFee,
			PrepaymentAmount:     rw.PrepaymentAmount,
			TotalOrderAmount:     totalOrderAmount,
			AmountToCollect:      rw.CourierCollectAmount,
			CourierCollectAmount: rw.CourierCollectAmount,
			PaymentLabel:         paymentLabel(rw.PrepaymentAmount, totalOrderAmount),
			ScheduledAt:          rw.ScheduledAt,
			CreatedAt:            rw.CreatedAt,
			Notes:                rw.Notes,
		})
	}
	return result, int(total), nil
}

// GetOrderByIDForCourier fetches a single order's full detail for a courier.
// Access is granted when the courier is assigned to the order (via courier_id cache)
// OR when the order is confirmed with no active assignment and is in the courier's city.
func (r *Repository) GetOrderByIDForCourier(ctx context.Context, courierID, orderID uuid.UUID) (*MyOrderResponse, error) {
	type row struct {
		OrderID              uuid.UUID          `gorm:"column:order_id"`
		OrderNumber          string             `gorm:"column:order_number"`
		Status               orders.OrderStatus `gorm:"column:status"`
		CustomerName         string             `gorm:"column:customer_name"`
		CustomerPhone        string             `gorm:"column:customer_phone"`
		CustomerAddress      *string            `gorm:"column:customer_address"`
		CreatorID            *uuid.UUID         `gorm:"column:creator_id"`
		CreatorName          *string            `gorm:"column:creator_name"`
		CreatorPhone         *string            `gorm:"column:creator_phone"`
		CreatorRole          *string            `gorm:"column:creator_role"`
		CreatorAvatarURL     *string            `gorm:"column:creator_avatar_url"`
		DeliveryMethod       string             `gorm:"column:delivery_method"`
		ProductTotal         float64            `gorm:"column:product_total"`
		DeliveryFee          float64            `gorm:"column:delivery_fee"`
		CourierPayout        float64            `gorm:"column:courier_payout"`
		PrepaymentAmount     float64            `gorm:"column:prepayment_amount"`
		CourierCollectAmount float64            `gorm:"column:courier_collect_amount"`
		ScheduledAt          *time.Time         `gorm:"column:scheduled_at"`
		AssignedAt           *time.Time         `gorm:"column:assigned_at"`
		CreatedAt            time.Time          `gorm:"column:created_at"`
		Notes                *string            `gorm:"column:notes"`
	}

	var rw row
	err := r.db.WithContext(ctx).
		Table("orders o").
		Select(`
			o.id AS order_id,
			o.order_number,
			o.status,
			c.full_name AS customer_name,
			c.phone AS customer_phone,
			COALESCE(o.delivery_address, c.address) AS customer_address,
			creator.id AS creator_id,
			creator.full_name AS creator_name,
			creator.phone AS creator_phone,
			creator.role AS creator_role,
			creator.avatar_url AS creator_avatar_url,
			COALESCE(o.delivery_method, 'normal') AS delivery_method,
			o.total_amount AS product_total,
			o.delivery_fee,
			o.courier_payout,
			o.prepayment_amount,
			GREATEST(0, o.total_amount + o.delivery_fee - o.prepayment_amount) AS courier_collect_amount,
			o.scheduled_at,
			oa.assigned_at,
			o.created_at,
			o.notes
		`).
		Joins("LEFT JOIN customers c ON c.id = o.customer_id").
		Joins("LEFT JOIN users creator ON creator.id = o.seller_id").
		Joins(`LEFT JOIN order_assignments oa
			ON oa.order_id = o.id
			AND oa.courier_id = ?
			AND oa.assigned_at = (
				SELECT MAX(oa2.assigned_at)
				FROM order_assignments oa2
				WHERE oa2.order_id = o.id AND oa2.courier_id = ?
			)`, courierID, courierID).
		Where(`o.id = ? AND o.deleted_at IS NULL AND (
			o.courier_id = ?
			OR (
				o.status = ? AND
				NOT EXISTS (
					SELECT 1 FROM order_assignments oa3
					WHERE oa3.order_id = o.id AND oa3.is_active = TRUE
				) AND
				o.city_id IN (
					SELECT cc.city_id FROM courier_cities cc WHERE cc.courier_id = ?
				)
			)
		)`, orderID, courierID, orders.StatusConfirmed, courierID).
		Scan(&rw).Error
	if err != nil {
		return nil, fmt.Errorf("get order for courier: %w", err)
	}
	if rw.OrderID == uuid.Nil {
		return nil, apperrors.NotFound("order")
	}

	totalOrderAmount := rw.ProductTotal + rw.DeliveryFee
	result := &MyOrderResponse{
		ID:          rw.OrderID,
		OrderNumber: rw.OrderNumber,
		Status:      rw.Status,
		Customer: OrderCustomer{
			FullName: rw.CustomerName,
			Phone:    rw.CustomerPhone,
			Address:  rw.CustomerAddress,
		},
		CreatorID:            rw.CreatorID,
		CreatorName:          derefStr(rw.CreatorName),
		CreatorPhone:         derefStr(rw.CreatorPhone),
		CreatorRole:          derefStr(rw.CreatorRole),
		CreatorAvatarURL:     rw.CreatorAvatarURL,
		DeliveryMethod:       rw.DeliveryMethod,
		ProductTotal:         rw.ProductTotal,
		DeliveryFee:          rw.DeliveryFee,
		CourierPayout:        rw.CourierPayout,
		PrepaymentAmount:     rw.PrepaymentAmount,
		TotalOrderAmount:     totalOrderAmount,
		AmountToCollect:      rw.CourierCollectAmount,
		CourierCollectAmount: rw.CourierCollectAmount,
		PaymentLabel:         paymentLabel(rw.PrepaymentAmount, totalOrderAmount),
		ScheduledAt:          rw.ScheduledAt,
		AssignedAt:           rw.AssignedAt,
		CreatedAt:            rw.CreatedAt,
		Notes:                rw.Notes,
		Items:                []OrderItemResponse{},
	}

	// Fetch items for this order.
	type itemRow struct {
		ProductID       string  `gorm:"column:product_id"`
		ProductName     string  `gorm:"column:product_name"`
		ProductImageURL *string `gorm:"column:product_image_url"`
		Quantity        int     `gorm:"column:quantity"`
		UnitPrice       float64 `gorm:"column:unit_price"`
		TotalPrice      float64 `gorm:"column:total_price"`
	}
	var itemRows []itemRow
	r.db.WithContext(ctx).
		Table("order_items oi").
		Select("oi.product_id::text, p.name AS product_name, oi.quantity, oi.unit_price, oi.total_price, (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = oi.product_id AND pi.is_primary = true LIMIT 1) AS product_image_url").
		Joins("JOIN products p ON p.id = oi.product_id").
		Where("oi.order_id = ?", orderID).
		Scan(&itemRows)
	for _, ir := range itemRows {
		productUUID, _ := uuid.Parse(ir.ProductID)
		result.Items = append(result.Items, OrderItemResponse{
			ProductID:       productUUID,
			ProductName:     ir.ProductName,
			ProductImageURL: ir.ProductImageURL,
			Quantity:        ir.Quantity,
			UnitPrice:       ir.UnitPrice,
			TotalPrice:      ir.TotalPrice,
		})
	}

	return result, nil
}

// GetOrderForClaim fetches and locks an order for the claim transaction.
func (r *Repository) GetOrderForClaim(tx *gorm.DB, ctx context.Context, orderID uuid.UUID) (*orders.Order, error) {
	var o orders.Order
	err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND deleted_at IS NULL", orderID).
		First(&o).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperrors.NotFound("order")
	}
	if err != nil {
		return nil, fmt.Errorf("lock order for claim: %w", err)
	}
	return &o, nil
}

// AddressChanged atomically returns an order back to confirmed state:
//  1. Verifies the courier has the active assignment.
//  2. Reads actual current status for the timeline entry.
//  3. Deactivates the assignment row.
//  4. Clears courier_id cache, sets status → confirmed.
//  5. Inserts a timeline entry with the new address as comment.
func (r *Repository) AddressChanged(ctx context.Context, courierID, orderID uuid.UUID, newAddress string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := r.verifyActiveAssignment(ctx, orderID, courierID); err != nil {
			return err
		}

		var currentStatus string
		if err := tx.WithContext(ctx).Table("orders").
			Select("status").Where("id = ?", orderID).
			Scan(&currentStatus).Error; err != nil {
			return fmt.Errorf("read order status: %w", err)
		}

		if err := tx.WithContext(ctx).Table("order_assignments").
			Where("order_id = ? AND is_active = TRUE", orderID).
			UpdateColumn("is_active", false).Error; err != nil {
			return fmt.Errorf("deactivate assignment: %w", err)
		}

		updates := map[string]interface{}{
			"courier_id": nil,
			"status":     string(orders.StatusConfirmed),
		}
		if newAddress != "" {
			updates["delivery_address"] = newAddress
		}
		if err := tx.WithContext(ctx).Table("orders").
			Where("id = ?", orderID).
			Updates(updates).Error; err != nil {
			return fmt.Errorf("reset order: %w", err)
		}

		comment := "Смена адреса"
		if newAddress != "" {
			comment = "Смена адреса: " + newAddress
		}
		tl := map[string]interface{}{
			"id":          uuid.New(),
			"order_id":    orderID,
			"from_status": currentStatus,
			"to_status":   string(orders.StatusConfirmed),
			"comment":     comment,
			"created_by":  courierID,
			"created_at":  time.Now().UTC(),
		}
		return tx.WithContext(ctx).Table("order_timeline").Create(&tl).Error
	})
}

// DeferOrder returns an order to confirmed with a future scheduled_at so it
// only appears in ListAvailableOrders once that date arrives.
func (r *Repository) DeferOrder(ctx context.Context, courierID, orderID uuid.UUID, scheduledAt time.Time) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := r.verifyActiveAssignment(ctx, orderID, courierID); err != nil {
			return err
		}

		var currentStatus string
		if err := tx.WithContext(ctx).Table("orders").
			Select("status").Where("id = ?", orderID).
			Scan(&currentStatus).Error; err != nil {
			return fmt.Errorf("read order status: %w", err)
		}

		if err := tx.WithContext(ctx).Table("order_assignments").
			Where("order_id = ? AND is_active = TRUE", orderID).
			UpdateColumn("is_active", false).Error; err != nil {
			return fmt.Errorf("deactivate assignment: %w", err)
		}

		if err := tx.WithContext(ctx).Table("orders").
			Where("id = ?", orderID).
			Updates(map[string]interface{}{
				"courier_id":   nil,
				"status":       string(orders.StatusConfirmed),
				"scheduled_at": scheduledAt.UTC(),
			}).Error; err != nil {
			return fmt.Errorf("defer order: %w", err)
		}

		comment := fmt.Sprintf("Доставить позже: %s", scheduledAt.Format("02.01.2006"))
		tl := map[string]interface{}{
			"id":          uuid.New(),
			"order_id":    orderID,
			"from_status": currentStatus,
			"to_status":   string(orders.StatusConfirmed),
			"comment":     comment,
			"created_by":  courierID,
			"created_at":  time.Now().UTC(),
		}
		return tx.WithContext(ctx).Table("order_timeline").Create(&tl).Error
	})
}

// ClaimOrder atomically:
//  1. Verifies status=confirmed and no active assignment.
//  2. Creates assignment.
//  3. Updates orders.courier_id cache and status=assigned.
//  4. Inserts timeline entry.
func (r *Repository) ClaimOrder(ctx context.Context, courierID, orderID uuid.UUID) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		enabled, err := r.courierOrderIntakeEnabledTx(tx, ctx, courierID)
		if err != nil {
			return err
		}
		if !enabled {
			return apperrors.Forbidden("Приём новых заказов отключён диспетчером")
		}

		o, err := r.GetOrderForClaim(tx, ctx, orderID)
		if err != nil {
			return err
		}
		if o.Status != orders.StatusConfirmed {
			return apperrors.BadRequest(fmt.Sprintf("order is not claimable (status=%q)", o.Status))
		}

		// Enforce payout profile + city service, then freeze the courier payout.
		payout, err := logistics_settings.ResolveAssignmentPayout(tx, courierID, o.CityID, o.DeliveryMethod)
		if err != nil {
			return err
		}

		// Check no active assignment exists.
		var count int64
		if err := tx.WithContext(ctx).Table("order_assignments").
			Where("order_id = ? AND is_active = TRUE", orderID).
			Count(&count).Error; err != nil {
			return fmt.Errorf("check existing assignment: %w", err)
		}
		if count > 0 {
			return apperrors.Conflict("order has already been claimed by another courier")
		}

		// Create assignment.
		if _, err := r.createAssignment(tx, ctx, orderID, courierID, courierID); err != nil {
			return err
		}

		// Update cache + freeze payout + status.
		if err := tx.WithContext(ctx).Table("orders").
			Where("id = ?", orderID).
			Updates(map[string]interface{}{
				"courier_id":     courierID,
				"courier_payout": payout,
				"status":         string(orders.StatusAssigned),
			}).Error; err != nil {
			return fmt.Errorf("set courier cache/payout/status: %w", err)
		}

		// Timeline.
		from := orders.StatusConfirmed
		tl := map[string]interface{}{
			"id":          uuid.New(),
			"order_id":    orderID,
			"from_status": string(from),
			"to_status":   string(orders.StatusAssigned),
			"created_by":  courierID,
			"created_at":  time.Now().UTC(),
		}
		return tx.WithContext(ctx).Table("order_timeline").Create(&tl).Error
	})
}

// ─── Notes ────────────────────────────────────────────────────────────────────

func (r *Repository) CreateNote(ctx context.Context, n *CourierNote) error {
	if err := r.db.WithContext(ctx).Create(n).Error; err != nil {
		return fmt.Errorf("create courier note: %w", err)
	}
	return nil
}

func (r *Repository) ListNotes(ctx context.Context, orderID, courierID uuid.UUID) ([]CourierNote, error) {
	var rows []CourierNote
	if err := r.db.WithContext(ctx).
		Where("order_id = ? AND courier_id = ?", orderID, courierID).
		Order("created_at ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	return rows, nil
}

// ─── Delivery Attempts ────────────────────────────────────────────────────────

// NextAttemptNo returns the next sequential attempt number for an order.
func (r *Repository) NextAttemptNo(ctx context.Context, orderID uuid.UUID) (int, error) {
	var count int64
	if err := r.db.WithContext(ctx).
		Table("delivery_attempts").
		Where("order_id = ?", orderID).
		Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count delivery attempts: %w", err)
	}
	return int(count) + 1, nil
}

func (r *Repository) CreateAttempt(ctx context.Context, a *DeliveryAttempt) error {
	if err := r.db.WithContext(ctx).Create(a).Error; err != nil {
		return fmt.Errorf("create delivery attempt: %w", err)
	}
	return nil
}

// ─── Courier Status ───────────────────────────────────────────────────────────

func (r *Repository) CreateStatusLog(ctx context.Context, s *CourierStatusLog) error {
	if err := r.db.WithContext(ctx).Create(s).Error; err != nil {
		return fmt.Errorf("create status log: %w", err)
	}
	return nil
}

// ─── Cash Handovers ───────────────────────────────────────────────────────────

// FindEligibleHandoverOrders returns delivered orders for this courier
// that are not included in any pending or confirmed handover.
//
// Formula per order:
//
//	courier_collected = total_amount + delivery_fee - prepayment_amount
//	delivery_fee      = courier_payout kept as courier salary
//	courier_returns   = courier_collected - courier_payout
//
// LockCourierForHandover serializes concurrent handover submissions for the
// same courier. A plain row lock on `orders` doesn't work here because the
// orders rows themselves are never written to by a handover — only new rows
// are inserted into cash_handover_orders/cash_handovers — so Postgres has
// nothing to re-check via EvalPlanQual after unblocking, and a second
// transaction's eligibility query still runs against its original
// (pre-commit) snapshot, seeing the same "eligible" orders as the first and
// creating a duplicate handover that double-claims the same cash.
// A session-scoped advisory lock has no row of its own to snapshot: the
// second transaction blocks on this call until the first COMMITS, and only
// then issues its eligibility query as a new statement, which under READ
// COMMITTED takes a fresh snapshot that correctly sees the first transaction's
// now-committed handover-order links.
func (r *Repository) LockCourierForHandover(tx *gorm.DB, ctx context.Context, courierID uuid.UUID) error {
	return tx.WithContext(ctx).Exec("SELECT pg_advisory_xact_lock(hashtext(?))", courierID.String()).Error
}

func (r *Repository) FindEligibleHandoverOrders(tx *gorm.DB, ctx context.Context, courierID uuid.UUID) ([]orders.Order, error) {
	var rows []orders.Order
	err := tx.WithContext(ctx).
		Table("orders").
		Where(`
			courier_id = ?
			AND status = ?
			AND deleted_at IS NULL
			AND id NOT IN (
				SELECT cho.order_id
				FROM cash_handover_orders cho
				JOIN cash_handovers ch ON ch.id = cho.handover_id
				WHERE ch.status IN ('pending', 'confirmed')
			)
		`, courierID, string(orders.StatusDelivered)).
		Find(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("find eligible handover orders: %w", err)
	}
	return rows, nil
}

func (r *Repository) CreateHandover(tx *gorm.DB, ctx context.Context, h *CashHandover) error {
	if err := tx.WithContext(ctx).Create(h).Error; err != nil {
		return fmt.Errorf("create handover: %w", err)
	}
	return nil
}

func (r *Repository) CreateHandoverOrders(tx *gorm.DB, ctx context.Context, lines []CashHandoverOrder) error {
	if len(lines) == 0 {
		return nil
	}
	if err := tx.WithContext(ctx).Create(&lines).Error; err != nil {
		return fmt.Errorf("create handover orders: %w", err)
	}
	return nil
}

func (r *Repository) GetHandoverByID(ctx context.Context, id uuid.UUID) (*CashHandover, error) {
	return getHandoverByID(r.db, ctx, id)
}

// GetHandoverByIDTx reloads a handover inside an open transaction.
// Use this immediately after creating the handover within the same tx so the
// row is visible before the transaction commits.
func (r *Repository) GetHandoverByIDTx(tx *gorm.DB, ctx context.Context, id uuid.UUID) (*CashHandover, error) {
	return getHandoverByID(tx, ctx, id)
}

func getHandoverByID(db *gorm.DB, ctx context.Context, id uuid.UUID) (*CashHandover, error) {
	var h CashHandover
	err := db.WithContext(ctx).
		Preload("Orders").
		Where("id = ?", id).
		First(&h).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperrors.NotFound("handover")
	}
	if err != nil {
		return nil, fmt.Errorf("get handover: %w", err)
	}
	return &h, nil
}

func (r *Repository) UpdateHandover(ctx context.Context, h *CashHandover) error {
	return r.db.WithContext(ctx).Save(h).Error
}

func (r *Repository) ListHandoversByCourier(ctx context.Context, courierID uuid.UUID, p pagination.Params) ([]CashHandover, int, error) {
	var rows []CashHandover
	var total int64

	q := r.db.WithContext(ctx).Model(&CashHandover{}).Where("courier_id = ?", courierID)
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count handovers: %w", err)
	}
	if err := q.Preload("Orders").Order("created_at DESC").
		Limit(p.Limit).Offset(p.Offset()).
		Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list handovers: %w", err)
	}
	return rows, int(total), nil
}

func (r *Repository) ListAllHandovers(ctx context.Context, p pagination.Params) ([]CashHandover, int, error) {
	var rows []CashHandover
	var total int64

	q := r.db.WithContext(ctx).Model(&CashHandover{})
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count all handovers: %w", err)
	}
	if err := q.Preload("Orders").Order("created_at DESC").
		Limit(p.Limit).Offset(p.Offset()).
		Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list all handovers: %w", err)
	}
	return rows, int(total), nil
}

// ─── Push Token ───────────────────────────────────────────────────────────────

// UpsertPushToken inserts or updates the Expo push token for this courier.
func (r *Repository) UpsertPushToken(ctx context.Context, userID uuid.UUID, token, platform string) error {
	now := time.Now().UTC()
	return r.db.WithContext(ctx).Exec(`
		INSERT INTO courier_push_tokens (user_id, token, platform, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (user_id) DO UPDATE
		  SET token = EXCLUDED.token,
		      platform = EXCLUDED.platform,
		      updated_at = EXCLUDED.updated_at
	`, userID, token, platform, now).Error
}

// ─── Cash Summary ─────────────────────────────────────────────────────────────

// GetCashSummary returns today's collection totals for orders not yet in any
// pending/confirmed handover.
func (r *Repository) GetCashSummary(ctx context.Context, courierID uuid.UUID) (*CashSummaryResponse, error) {
	type pendingResult struct {
		Count          int64   `gorm:"column:cnt"`
		TotalFees      float64 `gorm:"column:total_fees"`
		CashToHandover float64 `gorm:"column:cash_to_handover"`
	}
	var pending pendingResult
	// "Нужно вернуть сегодня" (debt) must only drop once a handover is CONFIRMED by
	// the dispatcher. A pending (or disputed) handover must NOT reduce the debt — the
	// money is still physically with the courier until confirmed. So we exclude only
	// orders attached to a CONFIRMED handover here. Pending amounts are surfaced
	// separately (see pending_amount below).
	err := r.db.WithContext(ctx).Raw(`
			SELECT
				COUNT(*) AS cnt,
				COALESCE(SUM(courier_payout), 0) AS total_fees,
				COALESCE(SUM(GREATEST(0, total_amount + delivery_fee - prepayment_amount - courier_payout)), 0) AS cash_to_handover
		FROM orders
		WHERE courier_id = ?
		  AND status = 'delivered'
		  AND deleted_at IS NULL
		  AND id NOT IN (
			  SELECT cho.order_id
			  FROM cash_handover_orders cho
			  JOIN cash_handovers ch ON ch.id = cho.handover_id
			  WHERE ch.status = 'confirmed'
		  )
	`, courierID).Scan(&pending).Error
	if err != nil {
		return nil, fmt.Errorf("cash summary: %w", err)
	}

	// Confirmed-handover shortfall (all-time, signed): when a handover is
	// confirmed with actual_returned below total_to_return, its orders drop
	// out of the debt query above even though part of their cash never
	// arrived — the courier saw "0" while the owner's table showed e.g. −9.
	// The signed sum keeps that residue in the courier's debt until the
	// owner either edits the handover's actual amount up or confirms a
	// later handover with the extra on top (an overpayment there nets the
	// residue back out). NULL actual_returned means "accepted as declared"
	// (same COALESCE rule the owner dashboard uses), i.e. zero difference.
	var shortfall float64
	if err := r.db.WithContext(ctx).Raw(`
		SELECT COALESCE(SUM(total_to_return - COALESCE(actual_returned, total_to_return)), 0)
		FROM cash_handovers
		WHERE courier_id = ?
		  AND status = 'confirmed'
	`, courierID).Scan(&shortfall).Error; err != nil {
		return nil, fmt.Errorf("handover shortfall: %w", err)
	}
	debt := pending.CashToHandover + shortfall
	if debt < 0 {
		debt = 0
	}

	// Split handover totals by status: confirmed (settled today) vs pending
	// (submitted, awaiting dispatcher). Pending is reported separately and must
	// NOT reduce the debt above.
	type handoverTotals struct {
		Confirmed float64 `gorm:"column:confirmed"`
		Pending   float64 `gorm:"column:pending"`
	}
	var ht handoverTotals
	if err := r.db.WithContext(ctx).Raw(`
		SELECT
			COALESCE(SUM(total_to_return) FILTER (WHERE status = 'confirmed'), 0)              AS confirmed,
			COALESCE(SUM(total_to_return) FILTER (WHERE status IN ('pending', 'disputed')), 0) AS pending
		FROM cash_handovers
		WHERE courier_id = ?
		  AND created_at >= CURRENT_DATE
	`, courierID).Scan(&ht).Error; err != nil {
		return nil, fmt.Errorf("handover totals: %w", err)
	}

	return &CashSummaryResponse{
		OrdersCollected:   int(pending.Count),
		CashToHandover:    debt,
		TotalDeliveryFees: pending.TotalFees,
		AlreadyHanded:     ht.Confirmed,
		PendingAmount:     ht.Pending,
		TodayCollected:    pending.CashToHandover,
		CarriedOverDebt:   shortfall,
	}, nil
}

func (r *Repository) GetMe(ctx context.Context, userID uuid.UUID) (*CourierMeResponse, error) {
	var me CourierMeResponse
	err := r.db.WithContext(ctx).Raw(
		`SELECT id,
		        full_name,
		        phone,
		        email,
		        role,
		        avatar_url,
		        courier_order_intake_enabled AS order_intake_enabled,
		        courier_order_intake_reason AS order_intake_reason
		 FROM users
		 WHERE id = ? AND deleted_at IS NULL`,
		userID,
	).Scan(&me).Error
	if err != nil {
		return nil, fmt.Errorf("get courier me: %w", err)
	}

	tariffRepo := courier_tariffs.NewRepository(r.db)
	rules, err := tariffRepo.ListByCourier(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("get courier me: %w", err)
	}
	me.TariffRules = make([]courier_tariffs.TariffRuleResponse, len(rules))
	for i, rule := range rules {
		me.TariffRules[i] = courier_tariffs.ToResponse(&rule)
	}

	return &me, nil
}

func (r *Repository) CourierOrderIntakeEnabled(ctx context.Context, courierID uuid.UUID) (bool, error) {
	return r.courierOrderIntakeEnabledTx(r.db, ctx, courierID)
}

func (r *Repository) courierOrderIntakeEnabledTx(db *gorm.DB, ctx context.Context, courierID uuid.UUID) (bool, error) {
	var enabled bool
	err := db.WithContext(ctx).
		Table("users").
		Select("courier_order_intake_enabled").
		Where("id = ? AND role = 'courier' AND is_active = TRUE AND deleted_at IS NULL", courierID).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Scan(&enabled).Error
	if err != nil {
		return false, fmt.Errorf("check courier order intake: %w", err)
	}

	var count int64
	if err := db.WithContext(ctx).
		Table("users").
		Where("id = ? AND role = 'courier' AND is_active = TRUE AND deleted_at IS NULL", courierID).
		Count(&count).Error; err != nil {
		return false, fmt.Errorf("validate courier order intake target: %w", err)
	}
	if count == 0 {
		return false, apperrors.NotFound("courier")
	}
	return enabled, nil
}
