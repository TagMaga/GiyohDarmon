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
	CreatedByName string `gorm:"column:created_by_name"`
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
	if f.WarehouseID != "" {
		q = q.Where("warehouse_id = ?", f.WarehouseID)
	}
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count inventory: %w", err)
	}
	if err := q.Order("updated_at DESC").Limit(p.Limit).Offset(p.Offset()).Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list inventory: %w", err)
	}
	return rows, int(total), nil
}

func (r *Repository) GetByWarehouse(ctx context.Context, warehouseID uuid.UUID, p pagination.Params) ([]Inventory, int, error) {
	var rows []Inventory
	var total int64

	q := r.db.WithContext(ctx).Model(&Inventory{}).Where("warehouse_id = ?", warehouseID)
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count inventory by warehouse: %w", err)
	}
	if err := q.Order("updated_at DESC").Limit(p.Limit).Offset(p.Offset()).Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list inventory by warehouse: %w", err)
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

// GetOrCreateForUpdate fetches the inventory row for (warehouse, product)
// with a SELECT FOR UPDATE lock and creates it (quantity=0) if it doesn't exist.
// Must be called inside a transaction.
func (r *Repository) GetOrCreateForUpdate(tx *gorm.DB, ctx context.Context, warehouseID, productID uuid.UUID) (*Inventory, error) {
	var inv Inventory
	err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("warehouse_id = ? AND product_id = ?", warehouseID, productID).
		First(&inv).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		inv = Inventory{
			ID:          uuid.New(),
			WarehouseID: warehouseID,
			ProductID:   productID,
			Quantity:    0,
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
		Joins("LEFT JOIN users ON users.id = inventory_movements.created_by AND users.deleted_at IS NULL")

	if f.WarehouseID != "" {
		base = base.Where("inventory_movements.warehouse_id = ?", f.WarehouseID)
	}
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
		Select("inventory_movements.*, COALESCE(users.full_name, '') AS created_by_name").
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
// warehouse+product, ordered oldest first, with row-level locks.
// Must be called inside a transaction.
func (r *Repository) GetBatchesForFIFO(tx *gorm.DB, ctx context.Context, warehouseID, productID uuid.UUID) ([]*Batch, error) {
	var batches []*Batch
	err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("warehouse_id = ? AND product_id = ? AND remaining_quantity > 0", warehouseID, productID).
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

// ConsumeFIFO deducts qty units from the oldest available batches for the given
// warehouse+product. It locks the batch rows, updates remaining_quantity, inserts
// BatchConsumption records, and returns them so callers can inspect per-batch costs
// (useful for transfers that need to mirror source batches at destination).
// Must be called inside a transaction. The caller must already hold the inventory row lock.
func (r *Repository) ConsumeFIFO(tx *gorm.DB, ctx context.Context, warehouseID, productID uuid.UUID, qty int, movementID uuid.UUID) ([]*BatchConsumption, error) {
	batches, err := r.GetBatchesForFIFO(tx, ctx, warehouseID, productID)
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

// ListBatches returns batches optionally filtered by warehouse and/or product,
// ordered newest received first (for display). Excludes fully consumed batches when
// onlyActive is true.
func (r *Repository) ListBatches(ctx context.Context, warehouseID, productID string, onlyActive bool) ([]*Batch, error) {
	q := r.db.WithContext(ctx).Model(&Batch{})
	if warehouseID != "" {
		q = q.Where("warehouse_id = ?", warehouseID)
	}
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
			i.warehouse_id,
			i.product_id,
			i.quantity AS inventory_quantity,
			COALESCE(SUM(b.remaining_quantity), 0)::int AS batch_quantity,
			(i.quantity - COALESCE(SUM(b.remaining_quantity), 0))::int AS difference
		FROM inventory i
		LEFT JOIN inventory_batches b
			ON b.warehouse_id = i.warehouse_id
		   AND b.product_id = i.product_id
		GROUP BY i.id, i.warehouse_id, i.product_id, i.quantity
		HAVING i.quantity <> COALESCE(SUM(b.remaining_quantity), 0)
		ORDER BY ABS(i.quantity - COALESCE(SUM(b.remaining_quantity), 0)) DESC,
		         i.updated_at DESC
	`).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("inventory integrity check: %w", err)
	}
	return rows, nil
}
