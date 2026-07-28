package pharmacies

import (
	"time"

	"github.com/google/uuid"
)

type Pharmacy struct {
	ID                  uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	Name                string     `json:"name"`
	Address             string     `json:"address"`
	OwnerName           string     `gorm:"column:owner_name" json:"owner_name"`
	OwnerPhone          string     `gorm:"column:owner_phone" json:"owner_phone"`
	ContactDetails      *string    `gorm:"column:contact_details" json:"contact_details"`
	Comment             *string    `json:"comment"`
	ResponsibleSellerID uuid.UUID  `gorm:"column:responsible_seller_id" json:"responsible_seller_id"`
	ArchivedAt          *time.Time `gorm:"column:archived_at" json:"archived_at"`
	ArchivedBy          *uuid.UUID `gorm:"column:archived_by" json:"archived_by"`
	CreatedBy           uuid.UUID  `gorm:"column:created_by" json:"created_by"`
	CreatedAt           time.Time  `gorm:"column:created_at" json:"created_at"`
	UpdatedAt           time.Time  `gorm:"column:updated_at" json:"updated_at"`
}

func (Pharmacy) TableName() string { return "pharmacies" }

type Invoice struct {
	ID                  uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	InvoiceNumber       string     `gorm:"column:invoice_number" json:"invoice_number"`
	PharmacyID          uuid.UUID  `gorm:"column:pharmacy_id" json:"pharmacy_id"`
	ResponsibleSellerID uuid.UUID  `gorm:"column:responsible_seller_id" json:"responsible_seller_id"`
	ManagerID           *uuid.UUID `gorm:"column:manager_id" json:"manager_id"`
	TeamLeadID          *uuid.UUID `gorm:"column:team_lead_id" json:"team_lead_id"`
	Status              string     `json:"status"`
	TotalAmount         float64    `gorm:"column:total_amount" json:"total_amount"`
	PaidAmount          float64    `gorm:"column:paid_amount" json:"paid_amount"`
	ReturnedAmount      float64    `gorm:"column:returned_amount" json:"returned_amount"`
	Comment             *string    `json:"comment"`
	RejectionReason     *string    `gorm:"column:rejection_reason" json:"rejection_reason"`
	CreatedBy           uuid.UUID  `gorm:"column:created_by" json:"created_by"`
	AcceptedAt          *time.Time `gorm:"column:accepted_at" json:"accepted_at"`
	RejectedAt          *time.Time `gorm:"column:rejected_at" json:"rejected_at"`
	CreatedAt           time.Time  `gorm:"column:created_at" json:"created_at"`
}

func (Invoice) TableName() string { return "pharmacy_invoices" }

type InvoiceItem struct {
	ID             uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	InvoiceID      uuid.UUID `gorm:"column:invoice_id" json:"invoice_id"`
	ProductID      uuid.UUID `gorm:"column:product_id" json:"product_id"`
	Quantity       int       `json:"quantity"`
	UnitPrice      float64   `gorm:"column:unit_price" json:"unit_price"`
	DiscountAmount float64   `gorm:"column:discount_amount" json:"discount_amount"`
	NetUnitPrice   float64   `gorm:"column:net_unit_price" json:"net_unit_price"`
	UnitCost       float64   `gorm:"column:unit_cost" json:"-"`
	LineTotal      float64   `gorm:"column:line_total" json:"line_total"`
	ProductName    string    `gorm:"->;column:product_name" json:"product_name,omitempty"`
	SKU            string    `gorm:"->;column:sku" json:"sku,omitempty"`
	ImageURL       string    `gorm:"->;column:image_url" json:"image_url,omitempty"`
}

func (InvoiceItem) TableName() string { return "pharmacy_invoice_items" }

type FinancialSnapshot struct {
	ID               uuid.UUID  `gorm:"type:uuid;primaryKey"`
	InvoiceID        uuid.UUID  `gorm:"column:invoice_id"`
	SellerRate       float64    `gorm:"column:seller_rate"`
	ManagerTeamRate  float64    `gorm:"column:manager_team_rate"`
	TeamLeadPoolRate float64    `gorm:"column:team_lead_pool_rate"`
	CompanyRate      float64    `gorm:"column:company_rate"`
	SellerConfigID   *uuid.UUID `gorm:"column:seller_config_id"`
	ManagerConfigID  *uuid.UUID `gorm:"column:manager_config_id"`
	TeamLeadConfigID *uuid.UUID `gorm:"column:team_lead_config_id"`
	CompanyConfigID  *uuid.UUID `gorm:"column:company_config_id"`
	SnapshotJSON     []byte     `gorm:"type:jsonb;column:snapshot_json"`
	CreatedAt        time.Time  `gorm:"column:created_at"`
}

func (FinancialSnapshot) TableName() string { return "pharmacy_financial_snapshots" }

type Payment struct {
	ID                  uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	PaymentNumber       string     `gorm:"column:payment_number" json:"payment_number"`
	PharmacyID          uuid.UUID  `gorm:"column:pharmacy_id" json:"pharmacy_id"`
	ResponsibleSellerID uuid.UUID  `gorm:"column:responsible_seller_id" json:"responsible_seller_id"`
	Amount              float64    `json:"amount"`
	Method              string     `json:"method"`
	Status              string     `json:"status"`
	Comment             *string    `json:"comment"`
	RejectionReason     *string    `gorm:"column:rejection_reason" json:"rejection_reason"`
	CreatedBy           uuid.UUID  `gorm:"column:created_by" json:"created_by"`
	ConfirmedBy         *uuid.UUID `gorm:"column:confirmed_by" json:"confirmed_by"`
	ConfirmedAt         *time.Time `gorm:"column:confirmed_at" json:"confirmed_at"`
	RejectedBy          *uuid.UUID `gorm:"column:rejected_by" json:"rejected_by"`
	RejectedAt          *time.Time `gorm:"column:rejected_at" json:"rejected_at"`
	CreatedAt           time.Time  `gorm:"column:created_at" json:"created_at"`
}

func (Payment) TableName() string { return "pharmacy_payments" }

type PharmacyReturn struct {
	ID                  uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	ReturnNumber        string     `gorm:"column:return_number" json:"return_number"`
	PharmacyID          uuid.UUID  `gorm:"column:pharmacy_id" json:"pharmacy_id"`
	ResponsibleSellerID uuid.UUID  `gorm:"column:responsible_seller_id" json:"responsible_seller_id"`
	Status              string     `json:"status"`
	Reason              string     `json:"reason"`
	RejectionReason     *string    `gorm:"column:rejection_reason" json:"rejection_reason"`
	CreatedBy           uuid.UUID  `gorm:"column:created_by" json:"created_by"`
	ProcessedBy         *uuid.UUID `gorm:"column:processed_by" json:"processed_by"`
	ProcessedAt         *time.Time `gorm:"column:processed_at" json:"processed_at"`
	CreatedAt           time.Time  `gorm:"column:created_at" json:"created_at"`
}

func (PharmacyReturn) TableName() string { return "pharmacy_returns" }

type ReturnItem struct {
	ID                uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	ReturnID          uuid.UUID `gorm:"column:return_id" json:"return_id"`
	ProductID         uuid.UUID `gorm:"column:product_id" json:"product_id"`
	RequestedQuantity int       `gorm:"column:requested_quantity" json:"requested_quantity"`
	AcceptedQuantity  int       `gorm:"column:accepted_quantity" json:"accepted_quantity"`
	UnitDebtValue     float64   `gorm:"column:unit_debt_value" json:"unit_debt_value"`
	ReturnedAmount    float64   `gorm:"column:returned_amount" json:"returned_amount"`
	ProductName       string    `gorm:"->;column:product_name" json:"product_name,omitempty"`
}

func (ReturnItem) TableName() string { return "pharmacy_return_items" }

type Actor struct {
	ID   uuid.UUID
	Role string
}
