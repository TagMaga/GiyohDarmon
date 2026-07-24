package inventory

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

// MovementRow is returned by ListMovements and augments Movement with the
// actor's display name resolved via a LEFT JOIN on the users table.
type MovementRow struct {
	Movement
	CreatedByName     string     `gorm:"column:created_by_name"`
	BatchID           *uuid.UUID `gorm:"column:batch_id"`
	BatchUnitCost     *float64   `gorm:"column:batch_unit_cost"`
	BatchReceivedQty  *int       `gorm:"column:batch_received_quantity"`
	BatchRemainingQty *int       `gorm:"column:batch_remaining_quantity"`
	EditCount         int        `gorm:"column:edit_count"`
	OrderID           *uuid.UUID `gorm:"column:order_id"`
	OrderNumber       string     `gorm:"column:order_number"`
	OrderStatus       string     `gorm:"column:order_status"`
	CustomerName      string     `gorm:"column:customer_name"`
	CustomerPhone     string     `gorm:"column:customer_phone"`
	DeliveryAddress   string     `gorm:"column:delivery_address"`
	CourierName       string     `gorm:"column:courier_name"`
	SellerName        string     `gorm:"column:seller_name"`
	TotalAmount       *float64   `gorm:"column:total_amount"`
	DeliveryFee       *float64   `gorm:"column:delivery_fee"`
	TotalOrderAmount  *float64   `gorm:"column:total_order_amount"`
	SaleUnitCost      *float64   `gorm:"column:sale_unit_cost"`
	SaleUnitPrice     *float64   `gorm:"column:sale_unit_price"`
}

type ReceivingEditRow struct {
	ReceivingEdit
	EditorName     string `gorm:"column:editor_name"`
	OldProductName string `gorm:"column:old_product_name"`
	NewProductName string `gorm:"column:new_product_name"`
}

// Repository handles all inventory persistence.
// Mutation methods that touch inventory_movements must always be called
// inside a transaction — callers in service.go enforce this contract.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// ─── Inventory ────────────────────────────────────────────────────────────────

func (r *Repository) ListInventory(ctx context.Context, f ListInventoryFilter, p pagination.Params) ([]Inventory, int, error) {
	var rows []Inventory
	var total int64

	q := r.db.WithContext(ctx).Model(&Inventory{})
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count inventory: %w", err)
	}
	if err := q.Order("updated_at DESC").Limit(p.Limit).Offset(p.Offset()).Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list inventory: %w", err)
	}
	return rows, int(total), nil
}

func (r *Repository) GetByProduct(ctx context.Context, productID uuid.UUID, p pagination.Params) ([]Inventory, int, error) {
	var rows []Inventory
	var total int64

	q := r.db.WithContext(ctx).Model(&Inventory{}).Where("product_id = ?", productID)
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count inventory by product: %w", err)
	}
	if err := q.Order("updated_at DESC").Limit(p.Limit).Offset(p.Offset()).Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list inventory by product: %w", err)
	}
	return rows, int(total), nil
}

// GetOrCreateForUpdate fetches the inventory row for a product with a
// SELECT FOR UPDATE lock and creates it (quantity=0) if it doesn't exist.
// Must be called inside a transaction.
func (r *Repository) GetOrCreateForUpdate(tx *gorm.DB, ctx context.Context, productID uuid.UUID) (*Inventory, error) {
	var inv Inventory
	err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("product_id = ?", productID).
		First(&inv).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		inv = Inventory{
			ID:        uuid.New(),
			ProductID: productID,
			Quantity:  0,
		}
		if err := tx.WithContext(ctx).Create(&inv).Error; err != nil {
			return nil, fmt.Errorf("create inventory row: %w", err)
		}
		// Re-fetch to populate generated column.
		if err := tx.WithContext(ctx).
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", inv.ID).
			First(&inv).Error; err != nil {
			return nil, fmt.Errorf("re-fetch inventory row: %w", err)
		}
		return &inv, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lock inventory row: %w", err)
	}
	return &inv, nil
}

// UpdateQuantity writes the new quantity back.
// Must be called inside a transaction.
func (r *Repository) UpdateQuantity(tx *gorm.DB, ctx context.Context, id uuid.UUID, newQuantity int) error {
	result := tx.WithContext(ctx).
		Model(&Inventory{}).
		Where("id = ?", id).
		UpdateColumn("quantity", newQuantity)
	if result.Error != nil {
		return fmt.Errorf("update inventory quantity: %w", result.Error)
	}
	return nil
}

// InsertMovement appends an immutable movement record.
// Must be called inside a transaction.
func (r *Repository) InsertMovement(tx *gorm.DB, ctx context.Context, m *Movement) error {
	if err := tx.WithContext(ctx).Create(m).Error; err != nil {
		return fmt.Errorf("insert movement: %w", err)
	}
	return nil
}

func (r *Repository) GetMovementForUpdate(tx *gorm.DB, ctx context.Context, id uuid.UUID) (*Movement, error) {
	var m Movement
	if err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", id).
		First(&m).Error; err != nil {
		return nil, fmt.Errorf("lock movement: %w", err)
	}
	return &m, nil
}

func (r *Repository) UpdateMovement(tx *gorm.DB, ctx context.Context, m *Movement) error {
	if err := tx.WithContext(ctx).Save(m).Error; err != nil {
		return fmt.Errorf("update movement: %w", err)
	}
	return nil
}

// InsertWriteoff appends a writeoff record.
// Must be called inside a transaction.
func (r *Repository) InsertWriteoff(tx *gorm.DB, ctx context.Context, w *Writeoff) error {
	if err := tx.WithContext(ctx).Create(w).Error; err != nil {
		return fmt.Errorf("insert writeoff: %w", err)
	}
	return nil
}

// InsertAdjustment appends an adjustment record.
// Must be called inside a transaction.
func (r *Repository) InsertAdjustment(tx *gorm.DB, ctx context.Context, a *Adjustment) error {
	if err := tx.WithContext(ctx).Create(a).Error; err != nil {
		return fmt.Errorf("insert adjustment: %w", err)
	}
	return nil
}

// ─── Movements ────────────────────────────────────────────────────────────────

func (r *Repository) ListMovements(ctx context.Context, f ListMovementsFilter, p pagination.Params) ([]MovementRow, int, error) {
	// Base query with LEFT JOIN to resolve the actor's display name.
	base := r.db.WithContext(ctx).
		Table("inventory_movements").
		Joins("LEFT JOIN users ON users.id = inventory_movements.created_by AND users.deleted_at IS NULL").
		Joins("LEFT JOIN inventory_batches ON inventory_batches.movement_id = inventory_movements.id").
		Joins("LEFT JOIN orders ON orders.id = inventory_movements.reference_id AND orders.deleted_at IS NULL").
		Joins("LEFT JOIN customers ON customers.id = orders.customer_id").
		Joins("LEFT JOIN users seller_user ON seller_user.id = orders.seller_id AND seller_user.deleted_at IS NULL").
		Joins("LEFT JOIN users courier_user ON courier_user.id = orders.courier_id AND courier_user.deleted_at IS NULL").
		Joins(`LEFT JOIN (
			SELECT movement_id, SUM(quantity * unit_cost) / NULLIF(SUM(quantity), 0) AS avg_unit_cost
			FROM inventory_batch_consumptions
			GROUP BY movement_id
		) sale_cost ON sale_cost.movement_id = inventory_movements.id`).
		Joins(`LEFT JOIN (
			SELECT order_id, product_id, SUM(total_price) / NULLIF(SUM(quantity), 0) AS unit_price
			FROM order_items
			GROUP BY order_id, product_id
		) sale_price ON sale_price.order_id = inventory_movements.reference_id AND sale_price.product_id = inventory_movements.product_id`)

	if f.ProductID != "" {
		base = base.Where("inventory_movements.product_id = ?", f.ProductID)
	}
	if f.MovementType != "" {
		base = base.Where("inventory_movements.movement_type = ?", f.MovementType)
	}
	if f.DateFrom != "" {
		if t, err := time.Parse("2006-01-02", f.DateFrom); err == nil {
			base = base.Where("inventory_movements.created_at >= ?", t.UTC())
		}
	}
	if f.DateTo != "" {
		if t, err := time.Parse("2006-01-02", f.DateTo); err == nil {
			// Include the full day by using the start of the next day as exclusive upper bound.
			base = base.Where("inventory_movements.created_at < ?", t.AddDate(0, 0, 1).UTC())
		}
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count movements: %w", err)
	}

	var rows []MovementRow
	err := base.
		Select(`
			inventory_movements.*,
			COALESCE(users.full_name, '') AS created_by_name,
			inventory_batches.id AS batch_id,
			inventory_batches.unit_cost AS batch_unit_cost,
			inventory_batches.received_quantity AS batch_received_quantity,
			inventory_batches.remaining_quantity AS batch_remaining_quantity,
			(
				SELECT COUNT(*)
				FROM inventory_receiving_edits ire
				WHERE ire.movement_id = inventory_movements.id
			)::int AS edit_count,
			orders.id AS order_id,
			COALESCE(orders.order_number, '') AS order_number,
			COALESCE(orders.status::text, '') AS order_status,
			COALESCE(customers.full_name, '') AS customer_name,
			COALESCE(customers.phone, '') AS customer_phone,
			COALESCE(orders.delivery_address, '') AS delivery_address,
			COALESCE(courier_user.full_name, '') AS courier_name,
			COALESCE(seller_user.full_name, '') AS seller_name,
			orders.total_amount AS total_amount,
			orders.delivery_fee AS delivery_fee,
			(orders.total_amount + orders.delivery_fee) AS total_order_amount,
			sale_cost.avg_unit_cost AS sale_unit_cost,
			sale_price.unit_price AS sale_unit_price
		`).
		Order("inventory_movements.created_at DESC").
		Limit(p.Limit).Offset(p.Offset()).
		Find(&rows).Error
	if err != nil {
		return nil, 0, fmt.Errorf("list movements: %w", err)
	}
	return rows, int(total), nil
}

// UpdateReservedQuantity sets reserved_quantity for an inventory row inside a transaction.
// Must be called after GetOrCreateForUpdate to ensure the row is locked.
// Used by the orders module for reservation and release operations.
func (r *Repository) UpdateReservedQuantity(tx *gorm.DB, ctx context.Context, id uuid.UUID, newReserved int) error {
	result := tx.WithContext(ctx).
		Model(&Inventory{}).
		Where("id = ?", id).
		UpdateColumn("reserved_quantity", newReserved)
	if result.Error != nil {
		return fmt.Errorf("update reserved quantity: %w", result.Error)
	}
	return nil
}

// DB exposes the underlying *gorm.DB so the service can open transactions.
func (r *Repository) DB() *gorm.DB {
	return r.db
}

// ─── Batches ──────────────────────────────────────────────────────────────────

// CreateBatch inserts a new inventory batch. Must be called inside a transaction.
func (r *Repository) CreateBatch(tx *gorm.DB, ctx context.Context, b *Batch) error {
	if err := tx.WithContext(ctx).Create(b).Error; err != nil {
		return fmt.Errorf("create batch: %w", err)
	}
	return nil
}

// GetBatchesForFIFO loads all batches with remaining_quantity > 0 for a
// product, ordered oldest first, with row-level locks.
// Must be called inside a transaction.
func (r *Repository) GetBatchesForFIFO(tx *gorm.DB, ctx context.Context, productID uuid.UUID) ([]*Batch, error) {
	var batches []*Batch
	err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("product_id = ? AND remaining_quantity > 0", productID).
		Order("received_at ASC").
		Find(&batches).Error
	if err != nil {
		return nil, fmt.Errorf("lock batches for FIFO: %w", err)
	}
	return batches, nil
}

// UpdateBatchRemaining sets a batch's remaining_quantity. Must be in a transaction.
func (r *Repository) UpdateBatchRemaining(tx *gorm.DB, ctx context.Context, batchID uuid.UUID, remaining int) error {
	result := tx.WithContext(ctx).
		Model(&Batch{}).
		Where("id = ?", batchID).
		UpdateColumn("remaining_quantity", remaining)
	if result.Error != nil {
		return fmt.Errorf("update batch remaining: %w", result.Error)
	}
	return nil
}

func (r *Repository) GetBatchByMovementForUpdate(tx *gorm.DB, ctx context.Context, movementID uuid.UUID) (*Batch, error) {
	var b Batch
	if err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("movement_id = ?", movementID).
		First(&b).Error; err != nil {
		return nil, fmt.Errorf("lock receiving batch: %w", err)
	}
	return &b, nil
}

func (r *Repository) UpdateBatch(tx *gorm.DB, ctx context.Context, b *Batch) error {
	if err := tx.WithContext(ctx).Save(b).Error; err != nil {
		return fmt.Errorf("update batch: %w", err)
	}
	return nil
}

func (r *Repository) GetBatchForUpdate(tx *gorm.DB, ctx context.Context, id uuid.UUID) (*Batch, error) {
	var b Batch
	if err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", id).
		First(&b).Error; err != nil {
		return nil, fmt.Errorf("lock batch: %w", err)
	}
	return &b, nil
}

func (r *Repository) InsertReceivingEdit(tx *gorm.DB, ctx context.Context, e *ReceivingEdit) error {
	if err := tx.WithContext(ctx).Create(e).Error; err != nil {
		return fmt.Errorf("insert receiving edit: %w", err)
	}
	return nil
}

func (r *Repository) ListReceivingEdits(ctx context.Context, movementID uuid.UUID) ([]ReceivingEditRow, error) {
	var rows []ReceivingEditRow
	err := r.db.WithContext(ctx).
		Table("inventory_receiving_edits").
		Joins("LEFT JOIN users ON users.id = inventory_receiving_edits.edited_by AND users.deleted_at IS NULL").
		Joins("LEFT JOIN products old_products ON old_products.id = inventory_receiving_edits.old_product_id").
		Joins("LEFT JOIN products new_products ON new_products.id = inventory_receiving_edits.new_product_id").
		Select(`
			inventory_receiving_edits.*,
			COALESCE(users.full_name, '') AS editor_name,
			COALESCE(old_products.name, '') AS old_product_name,
			COALESCE(new_products.name, '') AS new_product_name
		`).
		Where("inventory_receiving_edits.movement_id = ?", movementID).
		Order("inventory_receiving_edits.edited_at DESC").
		Find(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("list receiving edits: %w", err)
	}
	return rows, nil
}

// InsertBatchConsumptions inserts multiple consumption records in one call.
// Must be called inside a transaction.
func (r *Repository) InsertBatchConsumptions(tx *gorm.DB, ctx context.Context, cs []*BatchConsumption) error {
	if len(cs) == 0 {
		return nil
	}
	if err := tx.WithContext(ctx).Create(&cs).Error; err != nil {
		return fmt.Errorf("insert batch consumptions: %w", err)
	}
	return nil
}

func (r *Repository) ListBatchConsumptionsForMovementForUpdate(tx *gorm.DB, ctx context.Context, movementID uuid.UUID) ([]*BatchConsumption, error) {
	var rows []*BatchConsumption
	err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("movement_id = ?", movementID).
		Order("created_at DESC").
		Find(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("lock batch consumptions: %w", err)
	}
	return rows, nil
}

func (r *Repository) DeleteBatchConsumptionsByMovement(tx *gorm.DB, ctx context.Context, movementID uuid.UUID) error {
	if err := tx.WithContext(ctx).
		Where("movement_id = ?", movementID).
		Delete(&BatchConsumption{}).Error; err != nil {
		return fmt.Errorf("delete batch consumptions: %w", err)
	}
	return nil
}

// ConsumeFIFO deducts qty units from the oldest available batches for the given
// product. It locks the batch rows, updates remaining_quantity, inserts
// BatchConsumption records, and returns them so callers can inspect per-batch costs.
// Must be called inside a transaction. The caller must already hold the inventory row lock.
func (r *Repository) ConsumeFIFO(tx *gorm.DB, ctx context.Context, productID uuid.UUID, qty int, movementID uuid.UUID) ([]*BatchConsumption, error) {
	batches, err := r.GetBatchesForFIFO(tx, ctx, productID)
	if err != nil {
		return nil, err
	}

	remaining := qty
	var consumptions []*BatchConsumption

	for _, b := range batches {
		if remaining == 0 {
			break
		}
		take := remaining
		if b.RemainingQuantity < take {
			take = b.RemainingQuantity
		}
		consumptions = append(consumptions, &BatchConsumption{
			ID:         uuid.New(),
			BatchID:    b.ID,
			MovementID: movementID,
			Quantity:   take,
			UnitCost:   b.UnitCost,
		})
		if err := r.UpdateBatchRemaining(tx, ctx, b.ID, b.RemainingQuantity-take); err != nil {
			return nil, err
		}
		remaining -= take
	}

	if remaining > 0 {
		return nil, fmt.Errorf("insufficient batch stock: need %d more units (FIFO batches exhausted)", remaining)
	}

	if err := r.InsertBatchConsumptions(tx, ctx, consumptions); err != nil {
		return nil, err
	}

	return consumptions, nil
}

// ListBatches returns batches optionally filtered by product, ordered newest
// received first (for display). Excludes fully consumed batches when
// onlyActive is true.
func (r *Repository) ListBatches(ctx context.Context, productID string, onlyActive bool) ([]*Batch, error) {
	q := r.db.WithContext(ctx).Model(&Batch{})
	if productID != "" {
		q = q.Where("product_id = ?", productID)
	}
	if onlyActive {
		q = q.Where("remaining_quantity > 0")
	}
	var batches []*Batch
	if err := q.Order("received_at DESC").Find(&batches).Error; err != nil {
		return nil, fmt.Errorf("list batches: %w", err)
	}
	return batches, nil
}

// InventoryIntegrityCheck returns rows where inventory.quantity differs from
// the sum of active FIFO batch remaining quantities. It is intended for manual
// audits or scheduled jobs, not for every request.
func (r *Repository) InventoryIntegrityCheck(ctx context.Context) ([]InventoryIntegrityDiscrepancy, error) {
	var rows []InventoryIntegrityDiscrepancy
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			i.id AS inventory_id,
			i.product_id,
			i.quantity AS inventory_quantity,
			COALESCE(SUM(b.remaining_quantity), 0)::int AS batch_quantity,
			(i.quantity - COALESCE(SUM(b.remaining_quantity), 0))::int AS difference
		FROM inventory i
		LEFT JOIN inventory_batches b
			ON b.product_id = i.product_id
		GROUP BY i.id, i.product_id, i.quantity
		HAVING i.quantity <> COALESCE(SUM(b.remaining_quantity), 0)
		ORDER BY ABS(i.quantity - COALESCE(SUM(b.remaining_quantity), 0)) DESC,
		         i.updated_at DESC
	`).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("inventory integrity check: %w", err)
	}
	return rows, nil
}
