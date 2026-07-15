package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Repository handles all order persistence.
type Repository struct {
	db  *gorm.DB
	loc *time.Location // for interpreting bare YYYY-MM-DD params as local midnight
}

func NewRepository(db *gorm.DB, loc *time.Location) *Repository {
	if loc == nil {
		loc = time.UTC
	}
	return &Repository{db: db, loc: loc}
}

// Stats returns the order-health breakdown for the owner dashboard.
// from/to are optional [from, to] created_at bounds; nil means unbounded (all time).
func (r *Repository) Stats(ctx context.Context, from, to *time.Time) (*OrderStatsResponse, error) {
	applyRange := func(q *gorm.DB) *gorm.DB {
		q = q.Where("deleted_at IS NULL")
		if from != nil {
			q = q.Where("created_at >= ?", *from)
		}
		if to != nil {
			q = q.Where("created_at <= ?", *to)
		}
		return q
	}

	// Counts grouped by status.
	type statusCount struct {
		Status string `gorm:"column:status"`
		Count  int    `gorm:"column:count"`
	}
	var rows []statusCount
	if err := applyRange(r.db.WithContext(ctx).Table("orders")).
		Select("status::text AS status, COUNT(*) AS count").
		Group("status").Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("order stats by status: %w", err)
	}

	out := &OrderStatsResponse{ByStatus: map[string]int{}}
	for _, r := range rows {
		out.ByStatus[r.Status] = r.Count
		out.Total += r.Count
	}

	// Unassigned = confirmed orders with no active assignment.
	var unassigned int64
	uq := applyRange(r.db.WithContext(ctx).Table("orders o")).
		Where("o.status = ?", string(StatusConfirmed)).
		Where(`NOT EXISTS (SELECT 1 FROM order_assignments oa WHERE oa.order_id = o.id AND oa.is_active = TRUE)`)
	if err := uq.Count(&unassigned).Error; err != nil {
		return nil, fmt.Errorf("order stats unassigned: %w", err)
	}
	out.Unassigned = int(unassigned)

	// Scheduled = future scheduled_at, not in a terminal state.
	var scheduled int64
	sq := applyRange(r.db.WithContext(ctx).Table("orders")).
		Where("scheduled_at IS NOT NULL AND scheduled_at > now()").
		Where("status NOT IN ?", []string{string(StatusDelivered), string(StatusReturned), string(StatusCancelled)})
	if err := sq.Count(&scheduled).Error; err != nil {
		return nil, fmt.Errorf("order stats scheduled: %w", err)
	}
	out.Scheduled = int(scheduled)

	return out, nil
}

// ─── Orders ───────────────────────────────────────────────────────────────────

func (r *Repository) List(ctx context.Context, f ListOrdersFilter, actorID uuid.UUID, actorRole string, p pagination.Params) ([]Order, int, error) {
	var rows []Order
	var total int64

	q := r.db.WithContext(ctx).Model(&Order{}).Where("orders.deleted_at IS NULL")

	// Role-based row visibility.
	// Only roles in orderRoles (routes.go) can reach this function, so
	// warehouse_manager and courier will never appear as actorRole here.
	switch actorRole {
	case "seller":
		q = q.Where("seller_id = ?", actorID)
	case "manager":
		q = q.Where("manager_id = ? OR seller_id = ?", actorID, actorID)
	case "sales_team_lead":
		q = q.Where("team_lead_id = ? OR seller_id = ?", actorID, actorID)
		// dispatcher and owner see all orders — no extra WHERE clause.
		// warehouse_manager is NOT in orderRoles (Phase 24 P0 fix) and will never reach here.
	}

	if f.Status != "" {
		q = q.Where("status = ?", f.Status)
	}
	if f.SellerID != "" {
		q = q.Where("seller_id = ?", f.SellerID)
	}
	if f.ManagerID != "" {
		q = q.Where("manager_id = ?", f.ManagerID)
	}
	if f.TeamLeadID != "" {
		q = q.Where("team_lead_id = ?", f.TeamLeadID)
	}
	if f.CustomerID != "" {
		q = q.Where("customer_id = ?", f.CustomerID)
	}
	if f.NoCourier {
		q = q.
			Where("orders.courier_id IS NULL").
			Where(`NOT EXISTS (
				SELECT 1 FROM order_assignments oa
				WHERE oa.order_id = orders.id AND oa.is_active = TRUE
			)`)
	} else if f.CourierID != "" {
		q = q.Where(`orders.courier_id = ? OR EXISTS (
			SELECT 1 FROM order_assignments oa
			WHERE oa.order_id = orders.id AND oa.courier_id = ?
		)`, f.CourierID, f.CourierID)
	}
	if f.OrderType != "" {
		q = q.Where("order_type = ?", f.OrderType)
	}
	if f.City != "" {
		// Join customers to filter by city.
		q = q.Joins("JOIN customers ON customers.id = orders.customer_id").
			Where("customers.city ILIKE ?", "%"+f.City+"%")
	}
	if f.Search != "" {
		// Subqueries (not joins) so this composes with the City filter's own
		// unaliased `customers` join without alias collisions.
		like := "%" + f.Search + "%"
		q = q.Where(`
			orders.order_number ILIKE ? OR
			EXISTS (SELECT 1 FROM customers c WHERE c.id = orders.customer_id AND (c.full_name ILIKE ? OR c.phone ILIKE ?)) OR
			EXISTS (SELECT 1 FROM users u WHERE u.id = orders.seller_id AND u.full_name ILIKE ?)
		`, like, like, like, like)
	}
	// Resolve date aliases: "from"/"to" (frontend convention) fall back when
	// explicit "date_from"/"date_to" are absent. date_from takes precedence.
	dateFrom := f.DateFrom
	if dateFrom == "" {
		dateFrom = f.From
	}
	dateTo := f.DateTo
	if dateTo == "" {
		dateTo = f.To
	}

	if dateFrom != "" {
		if t, err := parseLocalDate(dateFrom, r.loc); err == nil {
			q = q.Where("orders.created_at >= ?", t.UTC())
		}
	}
	if dateTo != "" {
		if t, err := parseLocalDate(dateTo, r.loc); err == nil {
			q = q.Where("orders.created_at < ?", t.Add(24*time.Hour).UTC())
		}
	}

	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count orders: %w", err)
	}
	itemPreload := func(db *gorm.DB) *gorm.DB {
		return db.
			Select("order_items.*, p.name as product_name, (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = order_items.product_id AND pi.is_primary = true LIMIT 1) as product_image_url").
			Joins("LEFT JOIN products p ON p.id = order_items.product_id")
	}
	if err := q.Preload("Customer").Preload("Seller").Preload("Items", itemPreload).Order("orders.created_at DESC").
		Limit(p.Limit).Offset(p.Offset()).Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list orders: %w", err)
	}
	return rows, int(total), nil
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*Order, error) {
	var o Order
	itemPreloadFn := func(db *gorm.DB) *gorm.DB {
		return db.
			Select("order_items.*, p.name as product_name, (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = order_items.product_id AND pi.is_primary = true LIMIT 1) as product_image_url").
			Joins("LEFT JOIN products p ON p.id = order_items.product_id")
	}
	err := r.db.WithContext(ctx).
		Preload("Customer").
		Preload("Seller").
		Preload("Items", itemPreloadFn).
		Preload("Attachments").
		First(&o, "id = ? AND deleted_at IS NULL", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get order: %w", err)
	}
	return &o, nil
}

// GetByIDForUpdate fetches the order with a row-level lock inside a transaction.
func (r *Repository) GetByIDForUpdate(tx *gorm.DB, ctx context.Context, id uuid.UUID) (*Order, error) {
	var o Order
	itemPreloadFn2 := func(db *gorm.DB) *gorm.DB {
		return db.
			Select("order_items.*, p.name as product_name, (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = order_items.product_id AND pi.is_primary = true LIMIT 1) as product_image_url").
			Joins("LEFT JOIN products p ON p.id = order_items.product_id")
	}
	err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Preload("Customer").
		Preload("Seller").
		Preload("Items", itemPreloadFn2).
		Preload("Attachments").
		First(&o, "id = ? AND deleted_at IS NULL", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lock order: %w", err)
	}
	return &o, nil
}

func (r *Repository) Create(ctx context.Context, tx *gorm.DB, o *Order) error {
	if err := tx.WithContext(ctx).Create(o).Error; err != nil {
		return fmt.Errorf("create order: %w", err)
	}
	return nil
}

func (r *Repository) Update(ctx context.Context, tx *gorm.DB, o *Order) error {
	// Omit associations: Save() would otherwise upsert CustomerInfo/SellerInfo into
	// their respective tables (customers, users), triggering INSERT paths that violate
	// NOT NULL constraints (password_hash, role). Scalar order columns are still saved.
	if err := tx.WithContext(ctx).Omit(clause.Associations).Save(o).Error; err != nil {
		return fmt.Errorf("update order: %w", err)
	}
	return nil
}

// UpdateStatus writes only the status column (inside a transaction).
func (r *Repository) UpdateStatus(ctx context.Context, tx *gorm.DB, id uuid.UUID, status OrderStatus) error {
	result := tx.WithContext(ctx).
		Model(&Order{}).
		Where("id = ?", id).
		UpdateColumn("status", status)
	if result.Error != nil {
		return fmt.Errorf("update order status: %w", result.Error)
	}
	return nil
}

// GetCourierInfo resolves courier identities for a batch of orders from
// order_assignments joined with users. For each order it returns:
//   - the ACTIVE assignment's courier (is_active = TRUE), if any;
//   - the LAST assignment's courier (most recent by assigned_at, any state) — so a
//     delivered order whose assignment was later deactivated still resolves the
//     courier who delivered it.
//
// Single query, no N+1. Orders with no assignment are simply absent from the map.
func (r *Repository) GetCourierInfo(ctx context.Context, orderIDs []uuid.UUID) (map[uuid.UUID]CourierInfo, error) {
	out := make(map[uuid.UUID]CourierInfo, len(orderIDs))
	if len(orderIDs) == 0 {
		return out, nil
	}

	type row struct {
		OrderID         uuid.UUID  `gorm:"column:order_id"`
		ActiveCourierID *uuid.UUID `gorm:"column:active_courier_id"`
		ActiveName      *string    `gorm:"column:active_name"`
		LastCourierID   *uuid.UUID `gorm:"column:last_courier_id"`
		LastName        *string    `gorm:"column:last_name"`
	}
	var rows []row
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			o.id AS order_id,
			ac.courier_id AS active_courier_id,
			au.full_name  AS active_name,
			lc.courier_id AS last_courier_id,
			lu.full_name  AS last_name
		FROM orders o
		LEFT JOIN LATERAL (
			SELECT a.courier_id FROM order_assignments a
			WHERE a.order_id = o.id AND a.is_active = TRUE
			ORDER BY a.assigned_at DESC LIMIT 1
		) ac ON TRUE
		LEFT JOIN users au ON au.id = ac.courier_id
		LEFT JOIN LATERAL (
			SELECT a.courier_id FROM order_assignments a
			WHERE a.order_id = o.id
			ORDER BY a.assigned_at DESC LIMIT 1
		) lc ON TRUE
		LEFT JOIN users lu ON lu.id = lc.courier_id
		WHERE o.id IN ?
	`, orderIDs).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("get courier info: %w", err)
	}
	for _, rw := range rows {
		out[rw.OrderID] = CourierInfo{
			ActiveCourierID:   rw.ActiveCourierID,
			ActiveCourierName: rw.ActiveName,
			LastCourierID:     rw.LastCourierID,
			LastCourierName:   rw.LastName,
		}
	}
	return out, nil
}

func (r *Repository) HasCourierAssignment(ctx context.Context, orderID, courierID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Table("order_assignments").
		Where("order_id = ? AND courier_id = ?", orderID, courierID).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check courier assignment: %w", err)
	}
	return count > 0, nil
}

// ReleaseAssignment deactivates any active courier assignment for the order and
// clears the orders.courier_id cache, inside the caller's transaction.
//
// Root-cause fix for the "zombie order" bug (C1): when an order is moved backward
// to `confirmed` or `new`, the courier no longer holds it, so the active assignment
// row (order_assignments.is_active) and the courier_id cache must be released
// atomically with the status change. Otherwise the order becomes un-assignable
// (assign → 409) and un-startable (courier transition blocked), stuck forever.
//
// Idempotent: a no-op when no active assignment / courier_id exists, so it is safe
// to call on every transition into confirmed/new (e.g. plain new→confirmed).
// Returns the number of assignment rows deactivated so callers can audit-log only
// when an actual release happened.
func (r *Repository) ReleaseAssignment(ctx context.Context, tx *gorm.DB, orderID uuid.UUID) (int64, error) {
	now := time.Now().UTC()
	res := tx.WithContext(ctx).
		Table("order_assignments").
		Where("order_id = ? AND is_active = TRUE", orderID).
		Updates(map[string]interface{}{
			"is_active":     false,
			"unassigned_at": now,
		})
	if res.Error != nil {
		return 0, fmt.Errorf("deactivate assignment: %w", res.Error)
	}

	if err := tx.WithContext(ctx).
		Model(&Order{}).
		Where("id = ?", orderID).
		UpdateColumn("courier_id", nil).Error; err != nil {
		return 0, fmt.Errorf("clear courier cache: %w", err)
	}
	return res.RowsAffected, nil
}

// UpdatePrepaymentAmount adds delta to prepayment_amount (inside a transaction).
func (r *Repository) UpdatePrepaymentAmount(ctx context.Context, tx *gorm.DB, id uuid.UUID, delta float64) error {
	result := tx.WithContext(ctx).
		Model(&Order{}).
		Where("id = ?", id).
		UpdateColumn("prepayment_amount", gorm.Expr("prepayment_amount + ?", delta))
	if result.Error != nil {
		return fmt.Errorf("update prepayment amount: %w", result.Error)
	}
	return nil
}

// UpdateSnapshotID sets snapshot_id and financial fields after snapshot is built.
func (r *Repository) UpdateFinancials(ctx context.Context, tx *gorm.DB, id uuid.UUID, snapshotID uuid.UUID, deliveryFee, netRevenue float64) error {
	result := tx.WithContext(ctx).
		Model(&Order{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"snapshot_id":  snapshotID,
			"delivery_fee": deliveryFee,
			"net_revenue":  netRevenue,
		})
	if result.Error != nil {
		return fmt.Errorf("update order financials: %w", result.Error)
	}
	return nil
}

// ─── Order Items ──────────────────────────────────────────────────────────────

func (r *Repository) CreateItems(ctx context.Context, tx *gorm.DB, items []OrderItem) error {
	if len(items) == 0 {
		return nil
	}
	if err := tx.WithContext(ctx).Create(&items).Error; err != nil {
		return fmt.Errorf("create order items: %w", err)
	}
	return nil
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

func (r *Repository) CreateTimelineEntry(ctx context.Context, tx *gorm.DB, entry *OrderTimeline) error {
	if err := tx.WithContext(ctx).Create(entry).Error; err != nil {
		return fmt.Errorf("create timeline entry: %w", err)
	}
	return nil
}

func (r *Repository) GetTimeline(ctx context.Context, orderID uuid.UUID) ([]OrderTimeline, error) {
	var rows []OrderTimeline
	if err := r.db.WithContext(ctx).
		Select("order_timeline.*, COALESCE(u.full_name, '') as actor_name").
		Joins("LEFT JOIN users u ON u.id = order_timeline.created_by").
		Where("order_timeline.order_id = ?", orderID).
		Order("order_timeline.created_at ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("get order timeline: %w", err)
	}
	return rows, nil
}

// ─── Prepayments ──────────────────────────────────────────────────────────────

func (r *Repository) CreatePrepayment(ctx context.Context, tx *gorm.DB, p *OrderPrepayment) error {
	if err := tx.WithContext(ctx).Create(p).Error; err != nil {
		return fmt.Errorf("create prepayment: %w", err)
	}
	return nil
}

func (r *Repository) ListPrepayments(ctx context.Context, orderID uuid.UUID) ([]OrderPrepayment, error) {
	var rows []OrderPrepayment
	if err := r.db.WithContext(ctx).
		Where("order_id = ?", orderID).
		Order("created_at ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list prepayments: %w", err)
	}
	return rows, nil
}

// SumPrepayments returns the total verified + unverified prepayment amount for an order.
func (r *Repository) SumPrepayments(ctx context.Context, tx *gorm.DB, orderID uuid.UUID) (float64, error) {
	var total float64
	err := tx.WithContext(ctx).
		Model(&OrderPrepayment{}).
		Where("order_id = ?", orderID).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&total).Error
	if err != nil {
		return 0, fmt.Errorf("sum prepayments: %w", err)
	}
	return total, nil
}

// parseLocalDate interprets a bare YYYY-MM-DD string as midnight in loc.
// RFC3339 timestamps retain their embedded timezone.
func parseLocalDate(s string, loc *time.Location) (time.Time, error) {
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc), nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	return time.Time{}, fmt.Errorf("parseLocalDate: unrecognised format %q", s)
}
