package inventory

import (
	"time"

	"github.com/google/uuid"
)

// ─── Inventory ────────────────────────────────────────────────────────────────

type InventoryResponse struct {
	ID                uuid.UUID `json:"id"`
	ProductID         uuid.UUID `json:"product_id"`
	Quantity          int       `json:"quantity"`
	ReservedQuantity  int       `json:"reserved_quantity"`
	BlockedQuantity   int       `json:"blocked_quantity"`
	AvailableQuantity int       `json:"available_quantity"`
	LowStockThreshold int       `json:"low_stock_threshold"`
	IsLowStock        bool      `json:"is_low_stock"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func ToInventoryResponse(inv *Inventory) InventoryResponse {
	return InventoryResponse{
		ID:                inv.ID,
		ProductID:         inv.ProductID,
		Quantity:          inv.Quantity,
		ReservedQuantity:  inv.ReservedQuantity,
		BlockedQuantity:   inv.BlockedQuantity,
		AvailableQuantity: inv.AvailableQuantity,
		LowStockThreshold: inv.LowStockThreshold,
		IsLowStock:        inv.AvailableQuantity <= inv.LowStockThreshold,
		UpdatedAt:         inv.UpdatedAt,
	}
}

// ─── Receiving (FEFO batch receipt) ──────────────────────────────────────────

// ExpiryDateLayout is the wire format for every expiry_date /
// received_at DATE field: a bare calendar date, no time-of-day or timezone
// conversion (matches the underlying Postgres DATE column).
const ExpiryDateLayout = "2006-01-02"

type CreateReceivingRequest struct {
	ProductID uuid.UUID `json:"product_id"   validate:"required"`
	// max=1000000 is a fat-finger/overflow guard, not a real stock limit.
	Quantity  int     `json:"quantity"      validate:"required,min=1,max=1000000"`
	UnitCost  float64 `json:"unit_cost"     validate:"min=0,max=10000000"`
	InvoiceNo *string `json:"invoice_no"`
	Notes     *string `json:"notes"`
	// ExpiryDate is YYYY-MM-DD, required for every new receipt. Historical
	// batches (created before this field existed) are the only rows where
	// it may be NULL — never for a batch created through this endpoint.
	ExpiryDate string `json:"expiry_date" validate:"required"`
}

type ReceivingResponse struct {
	MovementID uuid.UUID     `json:"movement_id"`
	Batch      BatchResponse `json:"batch"`
}

type UpdateReceivingRequest struct {
	ProductID uuid.UUID `json:"product_id" validate:"required"`
	Quantity  int       `json:"quantity" validate:"required,min=1,max=1000000"`
	UnitCost  float64   `json:"unit_cost" validate:"min=0,max=10000000"`
	Notes     *string   `json:"notes"`
	// ExpiryDate is YYYY-MM-DD. Required when editing a receiving (purchase)
	// movement; ignored for a writeoff edit (writeoffs have no batch of
	// their own to date).
	ExpiryDate string `json:"expiry_date"`
}

// ─── Goods receipt (multi-line receiving invoice) ────────────────────────────

type CreateGoodsReceiptItem struct {
	ProductID uuid.UUID `json:"product_id" validate:"required"`
	Quantity  int       `json:"quantity"   validate:"required,min=1,max=1000000"`
	UnitCost  float64   `json:"unit_cost"  validate:"min=0,max=10000000"`
	// SalePrice is optional; when set it patches products.sale_price.
	SalePrice *float64 `json:"sale_price" validate:"omitempty,min=0,max=10000000"`
	// ExpiryDate is YYYY-MM-DD, required for every line.
	ExpiryDate string `json:"expiry_date" validate:"required"`
}

type CreateGoodsReceiptRequest struct {
	InvoiceNo  string                   `json:"invoice_no"  validate:"required,max=100"`
	ReceivedAt string                   `json:"received_at" validate:"required"`
	Notes      *string                  `json:"notes"`
	Items      []CreateGoodsReceiptItem `json:"items" validate:"required,min=1,dive"`
}

type GoodsReceiptLineResponse struct {
	MovementID uuid.UUID     `json:"movement_id"`
	Batch      BatchResponse `json:"batch"`
}

type GoodsReceiptResponse struct {
	ID         uuid.UUID                  `json:"id"`
	InvoiceNo  string                     `json:"invoice_no"`
	ReceivedAt string                     `json:"received_at"`
	Notes      *string                    `json:"notes"`
	CreatedBy  uuid.UUID                  `json:"created_by"`
	CreatedAt  time.Time                  `json:"created_at"`
	Lines      []GoodsReceiptLineResponse `json:"lines"`
	ItemCount  int                        `json:"item_count"`
	TotalUnits int                        `json:"total_units"`
	TotalValue float64                    `json:"total_value"`
}

type ReceivingEditResponse struct {
	ID             uuid.UUID `json:"id"`
	MovementID     uuid.UUID `json:"movement_id"`
	EditedBy       uuid.UUID `json:"edited_by"`
	EditorName     string    `json:"editor_name"`
	OldProductID   uuid.UUID `json:"old_product_id"`
	NewProductID   uuid.UUID `json:"new_product_id"`
	OldProductName string    `json:"old_product_name"`
	NewProductName string    `json:"new_product_name"`
	OldQuantity    int       `json:"old_quantity"`
	NewQuantity    int       `json:"new_quantity"`
	OldUnitCost    float64   `json:"old_unit_cost"`
	NewUnitCost    float64   `json:"new_unit_cost"`
	OldNote        string    `json:"old_note"`
	NewNote        string    `json:"new_note"`
	OldExpiryDate  *string   `json:"old_expiry_date"`
	NewExpiryDate  *string   `json:"new_expiry_date"`
	EditedAt       time.Time `json:"edited_at"`
}

func ToReceivingEditResponse(row *ReceivingEditRow) ReceivingEditResponse {
	return ReceivingEditResponse{
		ID:             row.ID,
		MovementID:     row.MovementID,
		EditedBy:       row.EditedBy,
		EditorName:     row.EditorName,
		OldProductID:   row.OldProductID,
		NewProductID:   row.NewProductID,
		OldProductName: row.OldProductName,
		NewProductName: row.NewProductName,
		OldQuantity:    row.OldQuantity,
		NewQuantity:    row.NewQuantity,
		OldUnitCost:    row.OldUnitCost,
		NewUnitCost:    row.NewUnitCost,
		OldNote:        row.OldNote,
		NewNote:        row.NewNote,
		OldExpiryDate:  formatDatePtr(row.OldExpiryDate),
		NewExpiryDate:  formatDatePtr(row.NewExpiryDate),
		EditedAt:       row.EditedAt,
	}
}

func formatDatePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(ExpiryDateLayout)
	return &s
}

// ─── Batch ────────────────────────────────────────────────────────────────────

type BatchResponse struct {
	ID                uuid.UUID `json:"id"`
	ProductID         uuid.UUID `json:"product_id"`
	ReceivedQuantity  int       `json:"received_quantity"`
	RemainingQuantity int       `json:"remaining_quantity"`
	UnitCost          float64   `json:"unit_cost"`
	ReceivedAt        time.Time `json:"received_at"`
	// ExpiryDate is YYYY-MM-DD, or nil for historical batches predating this feature.
	ExpiryDate     *string    `json:"expiry_date"`
	GoodsReceiptID *uuid.UUID `json:"goods_receipt_id,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

func ToBatchResponse(b *Batch) BatchResponse {
	return BatchResponse{
		ID:                b.ID,
		ProductID:         b.ProductID,
		ReceivedQuantity:  b.ReceivedQuantity,
		RemainingQuantity: b.RemainingQuantity,
		UnitCost:          b.UnitCost,
		ReceivedAt:        b.ReceivedAt,
		ExpiryDate:        formatDatePtr(b.ExpiryDate),
		GoodsReceiptID:    b.GoodsReceiptID,
		CreatedAt:         b.CreatedAt,
	}
}

type BatchListFilter struct {
	ProductID string `form:"product_id"`
}

// ─── Integrity ────────────────────────────────────────────────────────────────

type InventoryIntegrityDiscrepancy struct {
	InventoryID       uuid.UUID `json:"inventory_id"`
	ProductID         uuid.UUID `json:"product_id"`
	InventoryQuantity int       `json:"inventory_quantity"`
	BatchQuantity     int       `json:"batch_quantity"`
	Difference        int       `json:"difference"`
}

// ─── Adjustment ───────────────────────────────────────────────────────────────

type CreateAdjustmentRequest struct {
	ProductID   uuid.UUID `json:"product_id"   validate:"required"`
	NewQuantity int       `json:"new_quantity"  validate:"min=0,max=1000000"`
	Reason      string    `json:"reason"        validate:"required,max=500"`
	// UnitCost is used when the adjustment increases stock (creates a batch).
	// Defaults to 0 when omitted.
	UnitCost *float64 `json:"unit_cost" validate:"omitempty,min=0,max=10000000"`
}

type AdjustmentResponse struct {
	ID               uuid.UUID `json:"id"`
	ProductID        uuid.UUID `json:"product_id"`
	PreviousQuantity int       `json:"previous_quantity"`
	NewQuantity      int       `json:"new_quantity"`
	Reason           string    `json:"reason"`
	CreatedBy        uuid.UUID `json:"created_by"`
	CreatedAt        time.Time `json:"created_at"`
}

func ToAdjustmentResponse(a *Adjustment) AdjustmentResponse {
	return AdjustmentResponse{
		ID:               a.ID,
		ProductID:        a.ProductID,
		PreviousQuantity: a.PreviousQuantity,
		NewQuantity:      a.NewQuantity,
		Reason:           a.Reason,
		CreatedBy:        a.CreatedBy,
		CreatedAt:        a.CreatedAt,
	}
}

// ─── Writeoff ─────────────────────────────────────────────────────────────────

type CreateWriteoffRequest struct {
	ProductID  uuid.UUID  `json:"product_id"   validate:"required"`
	Quantity   int        `json:"quantity"      validate:"required,min=1,max=1000000"`
	Reason     string     `json:"reason"        validate:"required,max=500"`
	ApprovedBy *uuid.UUID `json:"approved_by"`
}

type WriteoffResponse struct {
	ID         uuid.UUID  `json:"id"`
	ProductID  uuid.UUID  `json:"product_id"`
	Quantity   int        `json:"quantity"`
	Reason     string     `json:"reason"`
	ApprovedBy *uuid.UUID `json:"approved_by"`
	CreatedBy  uuid.UUID  `json:"created_by"`
	CreatedAt  time.Time  `json:"created_at"`
}

func ToWriteoffResponse(w *Writeoff) WriteoffResponse {
	return WriteoffResponse{
		ID:         w.ID,
		ProductID:  w.ProductID,
		Quantity:   w.Quantity,
		Reason:     w.Reason,
		ApprovedBy: w.ApprovedBy,
		CreatedBy:  w.CreatedBy,
		CreatedAt:  w.CreatedAt,
	}
}

// ─── Movement ─────────────────────────────────────────────────────────────────

type MovementResponse struct {
	ID                uuid.UUID    `json:"id"`
	ProductID         uuid.UUID    `json:"product_id"`
	MovementType      MovementType `json:"movement_type"`
	Quantity          int          `json:"quantity"`
	PreviousQuantity  int          `json:"previous_quantity"`
	NewQuantity       int          `json:"new_quantity"`
	Reason            *string      `json:"reason"`
	ReferenceID       *uuid.UUID   `json:"reference_id"`
	CreatedBy         uuid.UUID    `json:"created_by"`
	CreatedByName     string       `json:"created_by_name"`
	CreatedAt         time.Time    `json:"created_at"`
	BatchID           *uuid.UUID   `json:"batch_id,omitempty"`
	BatchUnitCost     *float64     `json:"batch_unit_cost,omitempty"`
	BatchReceivedQty  *int         `json:"batch_received_quantity,omitempty"`
	BatchRemainingQty *int         `json:"batch_remaining_quantity,omitempty"`
	BatchExpiryDate   *string      `json:"batch_expiry_date,omitempty"`
	EditCount         int          `json:"edit_count"`
	OrderID           *uuid.UUID   `json:"order_id,omitempty"`
	OrderNumber       string       `json:"order_number,omitempty"`
	OrderStatus       string       `json:"order_status,omitempty"`
	CustomerName      string       `json:"customer_name,omitempty"`
	CustomerPhone     string       `json:"customer_phone,omitempty"`
	DeliveryAddress   string       `json:"delivery_address,omitempty"`
	CourierName       string       `json:"courier_name,omitempty"`
	SellerName        string       `json:"seller_name,omitempty"`
	TotalAmount       *float64     `json:"total_amount,omitempty"`
	DeliveryFee       *float64     `json:"delivery_fee,omitempty"`
	TotalOrderAmount  *float64     `json:"total_order_amount,omitempty"`
	SaleUnitCost      *float64     `json:"sale_unit_cost,omitempty"`
	SaleUnitPrice     *float64     `json:"sale_unit_price,omitempty"`
}

func ToMovementResponse(row *MovementRow) MovementResponse {
	return MovementResponse{
		ID:                row.ID,
		ProductID:         row.ProductID,
		MovementType:      row.MovementType,
		Quantity:          row.Quantity,
		PreviousQuantity:  row.PreviousQuantity,
		NewQuantity:       row.NewQuantity,
		Reason:            row.Reason,
		ReferenceID:       row.ReferenceID,
		CreatedBy:         row.CreatedBy,
		CreatedByName:     row.CreatedByName,
		CreatedAt:         row.CreatedAt,
		BatchID:           row.BatchID,
		BatchUnitCost:     row.BatchUnitCost,
		BatchReceivedQty:  row.BatchReceivedQty,
		BatchRemainingQty: row.BatchRemainingQty,
		BatchExpiryDate:   formatDatePtr(row.BatchExpiryDate),
		EditCount:         row.EditCount,
		OrderID:           row.OrderID,
		OrderNumber:       row.OrderNumber,
		OrderStatus:       row.OrderStatus,
		CustomerName:      row.CustomerName,
		CustomerPhone:     row.CustomerPhone,
		DeliveryAddress:   row.DeliveryAddress,
		CourierName:       row.CourierName,
		SellerName:        row.SellerName,
		TotalAmount:       row.TotalAmount,
		DeliveryFee:       row.DeliveryFee,
		TotalOrderAmount:  row.TotalOrderAmount,
		SaleUnitCost:      row.SaleUnitCost,
		SaleUnitPrice:     row.SaleUnitPrice,
	}
}

// ─── Filters ──────────────────────────────────────────────────────────────────

type ListInventoryFilter struct{}

type ListMovementsFilter struct {
	ProductID    string `form:"product_id"`
	MovementType string `form:"movement_type"`
	// DateFrom / DateTo accept YYYY-MM-DD and filter on created_at (inclusive).
	DateFrom string `form:"date_from"`
	DateTo   string `form:"date_to"`
}

type ListProductSalesFilter struct {
	// DateFrom / DateTo accept YYYY-MM-DD and filter on created_at (inclusive).
	// Both empty means all-time.
	DateFrom string `form:"date_from"`
	DateTo   string `form:"date_to"`
}

type ListSlowMovingFilter struct {
	// DateFrom / DateTo accept YYYY-MM-DD and bound the "zero sales" window.
	// Both empty means all-time.
	DateFrom string `form:"date_from"`
	DateTo   string `form:"date_to"`
}

// ─── Reports ──────────────────────────────────────────────────────────────────

type ProductSalesReportResponse struct {
	ProductID    uuid.UUID `json:"product_id"`
	ProductName  string    `json:"product_name"`
	SKU          string    `json:"sku"`
	QuantitySold int       `json:"quantity_sold"`
	Revenue      float64   `json:"revenue"`
	COGS         float64   `json:"cogs"`
	Profit       float64   `json:"profit"`
}

func ToProductSalesReportResponse(r *ProductSalesRow) ProductSalesReportResponse {
	return ProductSalesReportResponse{
		ProductID:    r.ProductID,
		ProductName:  r.ProductName,
		SKU:          r.SKU,
		QuantitySold: r.QuantitySold,
		Revenue:      r.Revenue,
		COGS:         r.COGS,
		Profit:       r.Revenue - r.COGS,
	}
}

// SlowMovingReportResponse is one row of the slow-moving stock report:
// products that still have stock on hand but sold zero units within the
// given date range. LastSoldAt is all-time (not bounded by the report
// range) so the owner can see how long a product has actually been sitting.
type SlowMovingReportResponse struct {
	ProductID   uuid.UUID  `json:"product_id"`
	ProductName string     `json:"product_name"`
	SKU         string     `json:"sku"`
	StockQty    int        `json:"stock_qty"`
	StockValue  float64    `json:"stock_value"`
	LastSoldAt  *time.Time `json:"last_sold_at"`
}

func ToSlowMovingReportResponse(r *SlowMovingRow) SlowMovingReportResponse {
	return SlowMovingReportResponse{
		ProductID:   r.ProductID,
		ProductName: r.ProductName,
		SKU:         r.SKU,
		StockQty:    r.StockQty,
		StockValue:  r.StockValue,
		LastSoldAt:  r.LastSoldAt,
	}
}

// ─── Expiry alerts ────────────────────────────────────────────────────────────

type ExpiryStatus string

const (
	ExpiryStatusExpiringSoon ExpiryStatus = "expiring_soon" // 1-14 days left
	ExpiryStatusExpiresToday ExpiryStatus = "expires_today"
	ExpiryStatusExpired      ExpiryStatus = "expired"
)

// ExpiryAlertRow is one active batch (remaining_quantity > 0) whose expiry
// date is today, within the next 14 days, or already in the past, as of the
// Asia/Dushanbe business date.
type ExpiryAlertRow struct {
	BatchID           uuid.UUID `gorm:"column:batch_id"`
	ProductID         uuid.UUID `gorm:"column:product_id"`
	ProductName       string    `gorm:"column:product_name"`
	SKU               string    `gorm:"column:sku"`
	InvoiceNo         string    `gorm:"column:invoice_no"`
	ExpiryDate        time.Time `gorm:"column:expiry_date"`
	RemainingQuantity int       `gorm:"column:remaining_quantity"`
	ReceivedAt        time.Time `gorm:"column:received_at"`
}

type ExpiryAlertResponse struct {
	BatchID           uuid.UUID    `json:"batch_id"`
	ProductID         uuid.UUID    `json:"product_id"`
	ProductName       string       `json:"product_name"`
	SKU               string       `json:"sku"`
	InvoiceNo         string       `json:"invoice_no"`
	ExpiryDate        string       `json:"expiry_date"`
	DaysUntilExpiry   int          `json:"days_until_expiry"` // negative when already expired
	RemainingQuantity int          `json:"remaining_quantity"`
	Status            ExpiryStatus `json:"status"`
	ReceivedAt        string       `json:"received_at"`
}

// ToExpiryAlertResponse converts a row into its API shape. businessDate is
// the current calendar date (no time component) in the app's business
// timezone (Asia/Dushanbe) — used to compute days_until_expiry and status.
func ToExpiryAlertResponse(r *ExpiryAlertRow, businessDate time.Time) ExpiryAlertResponse {
	days := daysBetween(businessDate, r.ExpiryDate)
	status := ExpiryStatusExpiringSoon
	switch {
	case days < 0:
		status = ExpiryStatusExpired
	case days == 0:
		status = ExpiryStatusExpiresToday
	}
	return ExpiryAlertResponse{
		BatchID:           r.BatchID,
		ProductID:         r.ProductID,
		ProductName:       r.ProductName,
		SKU:               r.SKU,
		InvoiceNo:         r.InvoiceNo,
		ExpiryDate:        r.ExpiryDate.Format(ExpiryDateLayout),
		DaysUntilExpiry:   days,
		RemainingQuantity: r.RemainingQuantity,
		Status:            status,
		ReceivedAt:        r.ReceivedAt.Format(ExpiryDateLayout),
	}
}

func daysBetween(from, to time.Time) int {
	from = time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC)
	to = time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, time.UTC)
	return int(to.Sub(from).Hours() / 24)
}

type ExpiryAlertsMeta struct {
	Total         int `json:"total"`
	ExpiredCount  int `json:"expired_count"`
	ExpiredUnits  int `json:"expired_units"`
	ExpiringCount int `json:"expiring_count"`
	ExpiringUnits int `json:"expiring_units"`
}
