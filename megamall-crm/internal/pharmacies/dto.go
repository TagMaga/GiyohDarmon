package pharmacies

import (
	"time"

	"github.com/google/uuid"
)

type CreatePharmacyRequest struct {
	Name                string    `json:"name" validate:"required,min=2,max=255"`
	Address             string    `json:"address" validate:"required,min=2"`
	OwnerName           string    `json:"owner_name" validate:"required,min=2,max=255"`
	OwnerPhone          string    `json:"owner_phone" validate:"required,min=5,max=30"`
	ContactDetails      *string   `json:"contact_details"`
	Comment             *string   `json:"comment"`
	ResponsibleSellerID uuid.UUID `json:"responsible_seller_id" validate:"required"`
}

type UpdatePharmacyRequest struct {
	Name           string  `json:"name" validate:"required,min=2,max=255"`
	Address        string  `json:"address" validate:"required,min=2"`
	OwnerName      string  `json:"owner_name" validate:"required,min=2,max=255"`
	OwnerPhone     string  `json:"owner_phone" validate:"required,min=5,max=30"`
	ContactDetails *string `json:"contact_details"`
	Comment        *string `json:"comment"`
}

type TransferResponsibilityRequest struct {
	SellerID uuid.UUID `json:"seller_id" validate:"required"`
	Comment  *string   `json:"comment"`
}

type InvoiceItemRequest struct {
	ProductID      uuid.UUID `json:"product_id" validate:"required"`
	Quantity       int       `json:"quantity" validate:"required,min=1"`
	UnitPrice      *float64  `json:"unit_price" validate:"omitempty,min=0"`
	DiscountAmount float64   `json:"discount_amount" validate:"min=0"`
}

type CreateInvoiceRequest struct {
	PharmacyID uuid.UUID            `json:"pharmacy_id" validate:"required"`
	Items      []InvoiceItemRequest `json:"items" validate:"required,min=1,dive"`
	Comment    *string              `json:"comment"`
}

type RejectRequest struct {
	Reason string `json:"reason" validate:"required,min=2"`
}

type CreatePaymentRequest struct {
	PharmacyID uuid.UUID `json:"pharmacy_id" validate:"required"`
	Amount     float64   `json:"amount" validate:"required,gt=0"`
	Method     string    `json:"method" validate:"required,oneof=cash cashless"`
	Comment    *string   `json:"comment"`
}

type CorrectPaymentRequest struct {
	Amount  float64 `json:"amount" validate:"required,gt=0"`
	Method  string  `json:"method" validate:"required,oneof=cash cashless"`
	Comment *string `json:"comment"`
}

type ReturnItemRequest struct {
	ProductID uuid.UUID `json:"product_id" validate:"required"`
	Quantity  int       `json:"quantity" validate:"required,min=1"`
}

type CreateReturnRequest struct {
	PharmacyID uuid.UUID           `json:"pharmacy_id" validate:"required"`
	Reason     string              `json:"reason" validate:"required,min=2"`
	Items      []ReturnItemRequest `json:"items" validate:"required,min=1,dive"`
}

type ProcessReturnItemRequest struct {
	ItemID           uuid.UUID `json:"item_id" validate:"required"`
	AcceptedQuantity int       `json:"accepted_quantity" validate:"min=0"`
}

type ProcessReturnRequest struct {
	Items           []ProcessReturnItemRequest `json:"items" validate:"required,min=1,dive"`
	RejectionReason *string                    `json:"rejection_reason"`
}

type Dashboard struct {
	ActivePharmacies int     `json:"active_pharmacies"`
	GoodsQuantity    int     `json:"goods_quantity"`
	TotalDebt        float64 `json:"total_debt"`
	PaidInPeriod     float64 `json:"paid_in_period"`
}

type PharmacyListRow struct {
	Pharmacy
	ResponsibleSellerName string  `gorm:"column:responsible_seller_name" json:"responsible_seller_name"`
	StockQuantity         int     `gorm:"column:stock_quantity" json:"stock_quantity"`
	IssuedAmount          float64 `gorm:"column:issued_amount" json:"issued_amount"`
	CurrentDebt           float64 `gorm:"column:current_debt" json:"current_debt"`
	CreditBalance         float64 `gorm:"column:credit_balance" json:"credit_balance"`
	Status                string  `gorm:"column:debt_status" json:"status"`
}

type StockRow struct {
	ProductID   uuid.UUID `gorm:"column:product_id" json:"product_id"`
	ProductName string    `gorm:"column:product_name" json:"product_name"`
	SKU         string    `gorm:"column:sku" json:"sku"`
	ImageURL    string    `gorm:"column:image_url" json:"image_url"`
	Quantity    int       `gorm:"column:quantity" json:"quantity"`
}

type TimelineRow struct {
	ID         uuid.UUID `json:"id"`
	EntityType string    `gorm:"column:entity_type" json:"entity_type"`
	EntityID   uuid.UUID `gorm:"column:entity_id" json:"entity_id"`
	EventType  string    `gorm:"column:event_type" json:"event_type"`
	ActorName  string    `gorm:"column:actor_name" json:"actor_name"`
	Metadata   []byte    `gorm:"type:jsonb" json:"metadata"`
	CreatedAt  time.Time `gorm:"column:created_at" json:"created_at"`
}

type DetailResponse struct {
	Pharmacy PharmacyListRow `json:"pharmacy"`
	Stock    []StockRow      `json:"stock"`
	Invoices []InvoiceDetail `json:"invoices"`
	Payments []Payment       `json:"payments"`
	Returns  []ReturnDetail  `json:"returns"`
	Timeline []TimelineRow   `json:"timeline"`
}

type InvoiceDetail struct {
	Invoice
	Items []InvoiceItem `json:"items"`
}

type ReturnDetail struct {
	PharmacyReturn
	Items []ReturnItem `json:"items"`
}
