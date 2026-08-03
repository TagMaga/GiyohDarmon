package warehouses

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
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

// ─── Warehouses ───────────────────────────────────────────────────────────────

func (r *Repository) ListWarehouses(ctx context.Context, typeFilter string) ([]Warehouse, error) {
	q := r.db.WithContext(ctx).Model(&Warehouse{}).Where("is_active = true")
	if typeFilter != "" {
		q = q.Where("type = ?", typeFilter)
	}
	var rows []Warehouse
	if err := q.Order("created_at ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list warehouses: %w", err)
	}
	return rows, nil
}

func (r *Repository) GetWarehouse(ctx context.Context, id uuid.UUID) (*Warehouse, error) {
	var w Warehouse
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&w).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get warehouse: %w", err)
	}
	return &w, nil
}

func (r *Repository) GetWarehouseForUpdate(tx *gorm.DB, ctx context.Context, id uuid.UUID) (*Warehouse, error) {
	var w Warehouse
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", id).First(&w).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock warehouse: %w", err)
	}
	return &w, nil
}

func (r *Repository) CreateWarehouse(ctx context.Context, w *Warehouse) error {
	if err := r.db.WithContext(ctx).Create(w).Error; err != nil {
		return fmt.Errorf("create warehouse: %w", err)
	}
	return nil
}

// GetOrCreateCourierWarehouseForUpdate lazily creates a courier's personal
// warehouse on first use and returns it locked. Must run inside a transaction.
func (r *Repository) GetOrCreateCourierWarehouseForUpdate(tx *gorm.DB, ctx context.Context, courierID uuid.UUID, courierName string) (*Warehouse, error) {
	var w Warehouse
	err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("type = ? AND courier_id = ?", WarehouseTypeCourier, courierID).
		First(&w).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		w = Warehouse{
			ID:        uuid.New(),
			Type:      WarehouseTypeCourier,
			Name:      "Склад курьера: " + courierName,
			CourierID: &courierID,
			IsActive:  true,
		}
		if err := tx.WithContext(ctx).Create(&w).Error; err != nil {
			return nil, fmt.Errorf("create courier warehouse: %w", err)
		}
		return &w, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lock courier warehouse: %w", err)
	}
	return &w, nil
}

func (r *Repository) GetCourierWarehouse(ctx context.Context, courierID uuid.UUID) (*Warehouse, error) {
	var w Warehouse
	err := r.db.WithContext(ctx).
		Where("type = ? AND courier_id = ?", WarehouseTypeCourier, courierID).
		First(&w).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get courier warehouse: %w", err)
	}
	return &w, nil
}

// ─── Courier inventory ────────────────────────────────────────────────────────

func (r *Repository) GetOrCreateCourierInventoryForUpdate(tx *gorm.DB, ctx context.Context, warehouseID, productID uuid.UUID) (*CourierInventory, error) {
	var ci CourierInventory
	err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("warehouse_id = ? AND product_id = ?", warehouseID, productID).
		First(&ci).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		ci = CourierInventory{ID: uuid.New(), WarehouseID: warehouseID, ProductID: productID}
		if err := tx.WithContext(ctx).Create(&ci).Error; err != nil {
			return nil, fmt.Errorf("create courier inventory row: %w", err)
		}
		if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", ci.ID).First(&ci).Error; err != nil {
			return nil, fmt.Errorf("re-fetch courier inventory row: %w", err)
		}
		return &ci, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lock courier inventory row: %w", err)
	}
	return &ci, nil
}

func (r *Repository) UpdateCourierInventory(tx *gorm.DB, ctx context.Context, id uuid.UUID, quantity, reserved, blocked int) error {
	res := tx.WithContext(ctx).Model(&CourierInventory{}).Where("id = ?", id).
		Updates(map[string]interface{}{"quantity": quantity, "reserved_quantity": reserved, "blocked_quantity": blocked})
	if res.Error != nil {
		return fmt.Errorf("update courier inventory: %w", res.Error)
	}
	return nil
}

func (r *Repository) ListCourierInventory(ctx context.Context, warehouseID uuid.UUID) ([]CourierInventory, error) {
	var rows []CourierInventory
	if err := r.db.WithContext(ctx).Where("warehouse_id = ? AND quantity > 0", warehouseID).
		Order("updated_at DESC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list courier inventory: %w", err)
	}
	return rows, nil
}

func (r *Repository) InsertCourierMovement(tx *gorm.DB, ctx context.Context, m *CourierInventoryMovement) error {
	if err := tx.WithContext(ctx).Create(m).Error; err != nil {
		return fmt.Errorf("insert courier movement: %w", err)
	}
	return nil
}

// ─── Courier inventory batches (cost lots) ─────────────────────────────────────

// InsertCourierInventoryBatches creates one cost lot per batch consumed on
// the courier's behalf when a transfer is accepted. Must be in a transaction.
func (r *Repository) InsertCourierInventoryBatches(tx *gorm.DB, ctx context.Context, batches []*CourierInventoryBatch) error {
	if len(batches) == 0 {
		return nil
	}
	if err := tx.WithContext(ctx).Create(&batches).Error; err != nil {
		return fmt.Errorf("insert courier inventory batches: %w", err)
	}
	return nil
}

// GetCourierBatchesForFIFO loads all cost lots with remaining_quantity > 0
// for (warehouseID, productID), oldest first (FIFO), with row-level locks.
// Must be called inside a transaction.
func (r *Repository) GetCourierBatchesForFIFO(tx *gorm.DB, ctx context.Context, warehouseID, productID uuid.UUID) ([]*CourierInventoryBatch, error) {
	var batches []*CourierInventoryBatch
	err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("warehouse_id = ? AND product_id = ? AND remaining_quantity > 0", warehouseID, productID).
		Order("created_at ASC, id ASC").
		Find(&batches).Error
	if err != nil {
		return nil, fmt.Errorf("lock courier batches for fifo: %w", err)
	}
	return batches, nil
}

// UpdateCourierBatchRemaining sets a courier cost lot's remaining_quantity.
// Must be in a transaction.
func (r *Repository) UpdateCourierBatchRemaining(tx *gorm.DB, ctx context.Context, batchID uuid.UUID, remaining int) error {
	res := tx.WithContext(ctx).Model(&CourierInventoryBatch{}).Where("id = ?", batchID).
		UpdateColumn("remaining_quantity", remaining)
	if res.Error != nil {
		return fmt.Errorf("update courier batch remaining: %w", res.Error)
	}
	return nil
}

// InsertCourierBatchConsumptions inserts multiple consumption records in one
// call. Must be called inside a transaction.
func (r *Repository) InsertCourierBatchConsumptions(tx *gorm.DB, ctx context.Context, cs []*CourierBatchConsumption) error {
	if len(cs) == 0 {
		return nil
	}
	if err := tx.WithContext(ctx).Create(&cs).Error; err != nil {
		return fmt.Errorf("insert courier batch consumptions: %w", err)
	}
	return nil
}

// GetProductPurchasePrice returns a product's purchase_price, or 0 when it
// is unset. Used as the fallback unit cost for delivered units that have no
// courier cost lot (see Service.ConsumeCourierFIFO). Runs on the caller's
// tx rather than the pool: it is called mid-transaction while FIFO row
// locks are held, and borrowing a second connection there risks blocking on
// a pool this transaction is itself holding a slot in.
func (r *Repository) GetProductPurchasePrice(tx *gorm.DB, ctx context.Context, productID uuid.UUID) (float64, error) {
	var price *float64
	row := tx.WithContext(ctx).Raw(`SELECT purchase_price FROM products WHERE id = ?`, productID).Row()
	if err := row.Scan(&price); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		return 0, fmt.Errorf("load product purchase price: %w", err)
	}
	if price == nil {
		return 0, nil
	}
	return *price, nil
}

// ─── Transfers ────────────────────────────────────────────────────────────────

func (r *Repository) CreateTransfer(tx *gorm.DB, ctx context.Context, t *InventoryTransfer, items []InventoryTransferItem) error {
	if err := tx.WithContext(ctx).Create(t).Error; err != nil {
		return fmt.Errorf("create transfer: %w", err)
	}
	for i := range items {
		items[i].TransferID = t.ID
	}
	if err := tx.WithContext(ctx).Create(&items).Error; err != nil {
		return fmt.Errorf("create transfer items: %w", err)
	}
	return nil
}

func (r *Repository) GetTransferForUpdate(tx *gorm.DB, ctx context.Context, id uuid.UUID) (*InventoryTransfer, error) {
	var t InventoryTransfer
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", id).First(&t).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock transfer: %w", err)
	}
	var items []InventoryTransferItem
	if err := tx.WithContext(ctx).Where("transfer_id = ?", id).Find(&items).Error; err != nil {
		return nil, fmt.Errorf("load transfer items: %w", err)
	}
	t.Items = items
	return &t, nil
}

func (r *Repository) UpdateTransferStatus(tx *gorm.DB, ctx context.Context, id uuid.UUID, status TransferStatus, toWarehouseID *uuid.UUID, decidedBy uuid.UUID) error {
	now := time.Now().UTC()
	res := tx.WithContext(ctx).Model(&InventoryTransfer{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"status":          status,
			"to_warehouse_id": toWarehouseID,
			"decided_by":      decidedBy,
			"decided_at":      now,
		})
	if res.Error != nil {
		return fmt.Errorf("update transfer status: %w", res.Error)
	}
	return nil
}

type TransferRow struct {
	InventoryTransfer
	FromWarehouseName string `gorm:"column:from_warehouse_name"`
	CourierName       string `gorm:"column:courier_name"`
	CreatedByName     string `gorm:"column:created_by_name"`
}

func (r *Repository) ListTransfers(ctx context.Context, status string, courierID *uuid.UUID, p pagination.Params) ([]TransferRow, int, error) {
	q := r.db.WithContext(ctx).Table("inventory_transfers").
		Joins("LEFT JOIN warehouses fw ON fw.id = inventory_transfers.from_warehouse_id").
		Joins("LEFT JOIN users courier ON courier.id = inventory_transfers.to_courier_id").
		Joins("LEFT JOIN users creator ON creator.id = inventory_transfers.created_by")
	if status != "" {
		q = q.Where("inventory_transfers.status = ?", status)
	}
	if courierID != nil {
		q = q.Where("inventory_transfers.to_courier_id = ?", *courierID)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count transfers: %w", err)
	}
	var rows []TransferRow
	err := q.Select(`
		inventory_transfers.*,
		COALESCE(fw.name, '') AS from_warehouse_name,
		COALESCE(courier.full_name, '') AS courier_name,
		COALESCE(creator.full_name, '') AS created_by_name
	`).Order("inventory_transfers.created_at DESC").
		Limit(p.Limit).Offset(p.Offset()).
		Find(&rows).Error
	if err != nil {
		return nil, 0, fmt.Errorf("list transfers: %w", err)
	}
	for i := range rows {
		var items []InventoryTransferItem
		if err := r.db.WithContext(ctx).Where("transfer_id = ?", rows[i].ID).Find(&items).Error; err != nil {
			return nil, 0, fmt.Errorf("load transfer items: %w", err)
		}
		rows[i].Items = items
	}
	return rows, int(total), nil
}

// ─── Returns ──────────────────────────────────────────────────────────────────

func (r *Repository) CreateReturn(tx *gorm.DB, ctx context.Context, ret *CourierReturn, items []CourierReturnItem) error {
	if err := tx.WithContext(ctx).Create(ret).Error; err != nil {
		return fmt.Errorf("create return: %w", err)
	}
	for i := range items {
		items[i].ReturnID = ret.ID
	}
	if len(items) > 0 {
		if err := tx.WithContext(ctx).Create(&items).Error; err != nil {
			return fmt.Errorf("create return items: %w", err)
		}
	}
	return nil
}

func (r *Repository) GetReturnForUpdate(tx *gorm.DB, ctx context.Context, id uuid.UUID) (*CourierReturn, error) {
	var ret CourierReturn
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", id).First(&ret).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock return: %w", err)
	}
	var items []CourierReturnItem
	if err := tx.WithContext(ctx).Where("return_id = ?", id).Find(&items).Error; err != nil {
		return nil, fmt.Errorf("load return items: %w", err)
	}
	ret.Items = items
	return &ret, nil
}

func (r *Repository) UpdateReturnStatus(tx *gorm.DB, ctx context.Context, id uuid.UUID, status ReturnStatus, decidedBy uuid.UUID) error {
	now := time.Now().UTC()
	res := tx.WithContext(ctx).Model(&CourierReturn{}).Where("id = ?", id).
		Updates(map[string]interface{}{"status": status, "decided_by": decidedBy, "decided_at": now})
	if res.Error != nil {
		return fmt.Errorf("update return status: %w", res.Error)
	}
	return nil
}

type ReturnRow struct {
	CourierReturn
	CourierName string `gorm:"column:courier_name"`
}

func (r *Repository) ListReturns(ctx context.Context, status string, p pagination.Params) ([]ReturnRow, int, error) {
	q := r.db.WithContext(ctx).Table("courier_returns").
		Joins("LEFT JOIN users ON users.id = courier_returns.courier_id")
	if status != "" {
		q = q.Where("courier_returns.status = ?", status)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count returns: %w", err)
	}
	var rows []ReturnRow
	err := q.Select(`courier_returns.*, COALESCE(users.full_name, '') AS courier_name`).
		Order("courier_returns.created_at DESC").
		Limit(p.Limit).Offset(p.Offset()).
		Find(&rows).Error
	if err != nil {
		return nil, 0, fmt.Errorf("list returns: %w", err)
	}
	for i := range rows {
		var items []CourierReturnItem
		if err := r.db.WithContext(ctx).Where("return_id = ?", rows[i].ID).Find(&items).Error; err != nil {
			return nil, 0, fmt.Errorf("load return items: %w", err)
		}
		rows[i].Items = items
	}
	return rows, int(total), nil
}

func (r *Repository) HasOpenReturn(ctx context.Context, courierID uuid.UUID) (bool, error) {
	var count int64
	if err := r.db.WithContext(ctx).Model(&CourierReturn{}).
		Where("courier_id = ? AND status = ?", courierID, ReturnRequested).
		Count(&count).Error; err != nil {
		return false, fmt.Errorf("check open return: %w", err)
	}
	return count > 0, nil
}

// ─── Aggregate summary (owner dashboard / inventory tab) ───────────────────────

type InventorySummary struct {
	MainQuantity       int `json:"main_quantity"`
	MainReserved       int `json:"main_reserved"`
	MainBlocked        int `json:"main_blocked"`
	CourierQuantity    int `json:"courier_quantity"`
	CourierReserved    int `json:"courier_reserved"`
	PendingTransfers   int `json:"pending_transfers"`
	PendingReturns     int `json:"pending_returns"`
	PendingLostReports int `json:"pending_lost_reports"`
}

// CourierBrief is the minimal courier info exposed to the transfer-issuance
// courier picker — no workload/cash data, unlike dispatch's overview
// endpoint (which warehouse_manager isn't permitted to call).
type CourierBrief struct {
	ID       uuid.UUID `json:"id"`
	FullName string    `json:"full_name"`
}

func (r *Repository) ListCouriers(ctx context.Context) ([]CourierBrief, error) {
	var rows []CourierBrief
	err := r.db.WithContext(ctx).Table("users").
		Select("id, full_name").
		Where("role = ? AND is_active = true AND deleted_at IS NULL", "courier").
		Order("full_name ASC").
		Find(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("list couriers: %w", err)
	}
	return rows, nil
}

func (r *Repository) GetInventorySummary(ctx context.Context) (*InventorySummary, error) {
	var s InventorySummary
	// Two separate destination structs, not one shared struct reused across
	// Raw().Scan() calls: GORM's Scan resets the destination before
	// populating it, so a second Scan into the same struct silently zeroes
	// whatever the first query set (verified live — main_quantity/reserved/
	// blocked came back 0 despite real stock on hand).
	var mainStats struct {
		MainQuantity int `json:"main_quantity"`
		MainReserved int `json:"main_reserved"`
		MainBlocked  int `json:"main_blocked"`
	}
	if err := r.db.WithContext(ctx).Raw(`
		SELECT
			COALESCE(SUM(quantity), 0)::int AS main_quantity,
			COALESCE(SUM(reserved_quantity), 0)::int AS main_reserved,
			COALESCE(SUM(blocked_quantity), 0)::int AS main_blocked
		FROM inventory
	`).Scan(&mainStats).Error; err != nil {
		return nil, fmt.Errorf("main inventory summary: %w", err)
	}
	var courierStats struct {
		CourierQuantity int `json:"courier_quantity"`
		CourierReserved int `json:"courier_reserved"`
	}
	if err := r.db.WithContext(ctx).Raw(`
		SELECT
			COALESCE(SUM(quantity), 0)::int AS courier_quantity,
			COALESCE(SUM(reserved_quantity), 0)::int AS courier_reserved
		FROM courier_inventory
	`).Scan(&courierStats).Error; err != nil {
		return nil, fmt.Errorf("courier inventory summary: %w", err)
	}
	s.MainQuantity = mainStats.MainQuantity
	s.MainReserved = mainStats.MainReserved
	s.MainBlocked = mainStats.MainBlocked
	s.CourierQuantity = courierStats.CourierQuantity
	s.CourierReserved = courierStats.CourierReserved

	var pendingTransfers, pendingReturns, pendingLost int64
	r.db.WithContext(ctx).Model(&InventoryTransfer{}).Where("status = ?", TransferIssued).Count(&pendingTransfers)
	r.db.WithContext(ctx).Model(&CourierReturn{}).Where("status = ?", ReturnRequested).Count(&pendingReturns)
	r.db.WithContext(ctx).Model(&LostProductReport{}).Where("status = ?", LostReportPending).Count(&pendingLost)
	s.PendingTransfers = int(pendingTransfers)
	s.PendingReturns = int(pendingReturns)
	s.PendingLostReports = int(pendingLost)
	return &s, nil
}

// GetInventoryDistribution returns the normalized per-product balances used by
// the inventory page's warehouse filter and "Распределение" column.
//
// The pre-warehouse inventory table is still the source of truth for the one
// main pool, so it is mapped to DefaultMainWarehouseID. Courier balances are
// already warehouse-scoped in courier_inventory.
func (r *Repository) GetInventoryDistribution(ctx context.Context) (*InventoryDistributionResponse, error) {
	result := &InventoryDistributionResponse{
		Locations: []InventoryLocationResponse{},
		Items:     []InventoryDistributionItemResponse{},
	}

	if err := r.db.WithContext(ctx).Raw(`
		SELECT id, type, name, courier_id
		FROM warehouses
		WHERE is_active = true
		  AND (id = ? OR type = ?)
		ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, name ASC
	`, DefaultMainWarehouseID, WarehouseTypeCourier, DefaultMainWarehouseID).
		Scan(&result.Locations).Error; err != nil {
		return nil, fmt.Errorf("list inventory locations: %w", err)
	}

	// A defensive fallback keeps the main location selectable if a development
	// database was created without the migration's seeded warehouse row.
	hasMain := false
	for _, location := range result.Locations {
		if location.ID == DefaultMainWarehouseID {
			hasMain = true
			break
		}
	}
	if !hasMain {
		result.Locations = append([]InventoryLocationResponse{{
			ID: DefaultMainWarehouseID, Type: WarehouseTypeMain, Name: "Главный склад",
		}}, result.Locations...)
	}

	if err := r.db.WithContext(ctx).Raw(`
		SELECT
			i.product_id,
			?::uuid AS warehouse_id,
			i.quantity,
			i.reserved_quantity,
			i.blocked_quantity,
			i.available_quantity
		FROM inventory i

		UNION ALL

		SELECT
			ci.product_id,
			ci.warehouse_id,
			ci.quantity,
			ci.reserved_quantity,
			ci.blocked_quantity,
			ci.available_quantity
		FROM courier_inventory ci
		JOIN warehouses w ON w.id = ci.warehouse_id
		WHERE w.is_active = true
		  AND w.type = ?

		ORDER BY product_id, warehouse_id
	`, DefaultMainWarehouseID, WarehouseTypeCourier).
		Scan(&result.Items).Error; err != nil {
		return nil, fmt.Errorf("list inventory distribution: %w", err)
	}

	return result, nil
}

// ─── Lost reports ─────────────────────────────────────────────────────────────

func (r *Repository) CreateLostReport(ctx context.Context, rep *LostProductReport) error {
	if err := r.db.WithContext(ctx).Create(rep).Error; err != nil {
		return fmt.Errorf("create lost report: %w", err)
	}
	return nil
}

func (r *Repository) GetLostReportForUpdate(tx *gorm.DB, ctx context.Context, id uuid.UUID) (*LostProductReport, error) {
	var rep LostProductReport
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", id).First(&rep).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock lost report: %w", err)
	}
	return &rep, nil
}

func (r *Repository) UpdateLostReportStatus(tx *gorm.DB, ctx context.Context, id uuid.UUID, status LostReportStatus, decidedBy uuid.UUID) error {
	now := time.Now().UTC()
	res := tx.WithContext(ctx).Model(&LostProductReport{}).Where("id = ?", id).
		Updates(map[string]interface{}{"status": status, "decided_by": decidedBy, "decided_at": now})
	if res.Error != nil {
		return fmt.Errorf("update lost report status: %w", res.Error)
	}
	return nil
}

func (r *Repository) ListLostReports(ctx context.Context, status string, courierID *uuid.UUID, p pagination.Params) ([]LostProductReport, int, error) {
	q := r.db.WithContext(ctx).Model(&LostProductReport{})
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if courierID != nil {
		q = q.Where("courier_id = ?", *courierID)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count lost reports: %w", err)
	}
	var rows []LostProductReport
	if err := q.Order("created_at DESC").Limit(p.Limit).Offset(p.Offset()).Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list lost reports: %w", err)
	}
	return rows, int(total), nil
}
