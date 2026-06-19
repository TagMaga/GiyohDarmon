package compensation

import (
	"time"

	"github.com/google/uuid"
)

// ─── Commission type ───────────────────────────────────────────────────────────

// CommissionType is the kind of commission this config controls.
// Maps to the commission_type PostgreSQL ENUM.
type CommissionType string

const (
	CommissionTypeSellerRate          CommissionType = "seller_rate"
	CommissionTypeManagerTeamRate     CommissionType = "manager_team_rate"
	CommissionTypeManagerPersonalRate CommissionType = "manager_personal_rate"
	CommissionTypeTeamLeadPoolRate    CommissionType = "team_lead_pool_rate"
	CommissionTypeCompanyRate         CommissionType = "company_rate"
)

// AllCommissionTypes lists all valid commission types.
var AllCommissionTypes = []CommissionType{
	CommissionTypeSellerRate,
	CommissionTypeManagerTeamRate,
	CommissionTypeManagerPersonalRate,
	CommissionTypeTeamLeadPoolRate,
	CommissionTypeCompanyRate,
}

// IsValid returns true if the CommissionType is a known value.
func (ct CommissionType) IsValid() bool {
	for _, v := range AllCommissionTypes {
		if ct == v {
			return true
		}
	}
	return false
}

// ─── Rate source ──────────────────────────────────────────────────────────────

// RateSource describes which scope level resolved a commission rate.
// Maps to the rate_source PostgreSQL ENUM.
type RateSource string

const (
	RateSourceEmployee RateSource = "employee"
	RateSourceTeam     RateSource = "team"
	RateSourceGlobal   RateSource = "global"
)

// ─── Tariff type ──────────────────────────────────────────────────────────────

// TariffType describes the pricing model of a delivery tariff.
// Maps to the tariff_type PostgreSQL ENUM.
type TariffType string

const (
	TariffTypeFixed  TariffType = "fixed"
	TariffTypeTiered TariffType = "tiered"
)

// ─── Order type ───────────────────────────────────────────────────────────────

// OrderType mirrors the orders.order_type ENUM (Phase 4).
// Defined here so the compensation module can apply commission rules
// in Preview without importing the orders package.
//
// COMMISSION RULES BY ORDER TYPE
// ──────────────────────────────────────────────────────────────────────────────
//   seller_order:
//     seller_commission          = net_revenue × seller_rate
//     manager_team_commission    = net_revenue × manager_team_rate
//     manager_personal_commission = 0
//     team_lead_pool             = net_revenue × team_lead_pool_rate
//     company_revenue            = net_revenue × company_rate
//
//   manager_personal_order:
//     seller_commission          = 0
//     manager_team_commission    = 0     ← manager cannot double-pay himself
//     manager_personal_commission = net_revenue × manager_personal_rate
//     team_lead_pool             = net_revenue × team_lead_pool_rate
//     company_revenue            = net_revenue × company_rate
//
//   team_lead_personal_order:
//     seller_commission          = 0
//     manager_team_commission    = net_revenue × manager_team_rate
//     manager_personal_commission = 0
//     team_lead_pool             = net_revenue × team_lead_pool_rate
//     company_revenue            = net_revenue × company_rate
// ──────────────────────────────────────────────────────────────────────────────
type OrderType string

const (
	OrderTypeSellerOrder           OrderType = "seller_order"
	OrderTypeManagerPersonalOrder  OrderType = "manager_personal_order"
	OrderTypeTeamLeadPersonalOrder OrderType = "team_lead_personal_order"
)

// AllOrderTypes lists all valid order types.
var AllOrderTypes = []OrderType{
	OrderTypeSellerOrder,
	OrderTypeManagerPersonalOrder,
	OrderTypeTeamLeadPersonalOrder,
}

// IsValid returns true if the OrderType is a known value.
func (ot OrderType) IsValid() bool {
	for _, v := range AllOrderTypes {
		if ot == v {
			return true
		}
	}
	return false
}

// ─── Financial event type ─────────────────────────────────────────────────────

// FinancialEventType is the kind of ledger event.
// Maps to the financial_event_type PostgreSQL ENUM.
type FinancialEventType string

const (
	EventSellerCommissionEarned             FinancialEventType = "seller_commission_earned"
	EventSellerCommissionConfirmed          FinancialEventType = "seller_commission_confirmed"
	EventSellerCommissionCancelled          FinancialEventType = "seller_commission_cancelled"
	EventManagerTeamCommissionEarned        FinancialEventType = "manager_team_commission_earned"
	EventManagerTeamCommissionConfirmed     FinancialEventType = "manager_team_commission_confirmed"
	EventManagerPersonalCommissionEarned    FinancialEventType = "manager_personal_commission_earned"
	EventManagerPersonalCommissionConfirmed FinancialEventType = "manager_personal_commission_confirmed"
	EventTeamLeadPoolEarned                 FinancialEventType = "team_lead_pool_earned"
	EventTeamLeadPoolConfirmed              FinancialEventType = "team_lead_pool_confirmed"
	EventCourierFeeEarned                   FinancialEventType = "courier_fee_earned"
	EventCourierFeeConfirmed                FinancialEventType = "courier_fee_confirmed"
	EventCompanyRevenueEarned               FinancialEventType = "company_revenue_earned"
	EventCompanyRevenueConfirmed            FinancialEventType = "company_revenue_confirmed"
	EventCashCollected                      FinancialEventType = "cash_collected"
	EventCashHandedOver                     FinancialEventType = "cash_handed_over"
)

// ─── Domain models ────────────────────────────────────────────────────────────

// CommissionConfig is one immutable commission rate record.
//
// Rows are NEVER updated (except effective_to, set once to close the window).
// A rate change creates a new row and closes the previous one.
// History is preserved by row accumulation.
type CommissionConfig struct {
	ID             uuid.UUID      `gorm:"type:uuid;primaryKey"`
	TeamID         *uuid.UUID     `gorm:"type:uuid"`
	UserID         *uuid.UUID     `gorm:"type:uuid"`
	CommissionType CommissionType `gorm:"type:commission_type;not null"`
	Rate           float64        `gorm:"type:numeric(6,5);not null"`
	EffectiveFrom  time.Time      `gorm:"not null"`
	EffectiveTo    *time.Time     // NULL = currently open
	Notes          string         `gorm:"not null"`
	CreatedBy      *uuid.UUID     `gorm:"type:uuid"`
	CreatedAt      time.Time      `gorm:"autoCreateTime"`
	// NO UpdatedAt. NO DeletedAt.
}

func (CommissionConfig) TableName() string { return "commission_configs" }

// Scope returns a human-readable scope label for display/logging.
func (c *CommissionConfig) Scope() string {
	if c.UserID != nil {
		return "employee"
	}
	if c.TeamID != nil {
		return "team"
	}
	return "global"
}

// DeliveryTariff is an immutable tariff header.
// Changes create a new record (same immutability principle as CommissionConfig).
type DeliveryTariff struct {
	ID            uuid.UUID  `gorm:"type:uuid;primaryKey"`
	Name          string     `gorm:"not null"`
	Type          TariffType `gorm:"type:tariff_type;not null"`
	FixedFee      *float64   `gorm:"type:numeric(12,2)"` // set when Type == fixed
	IsActive      bool       `gorm:"default:true;not null"`
	EffectiveFrom time.Time  `gorm:"not null"`
	EffectiveTo   *time.Time // NULL = currently open
	Notes         string     `gorm:"not null"`
	CreatedBy     *uuid.UUID `gorm:"type:uuid"`
	CreatedAt     time.Time  `gorm:"autoCreateTime"`

	Ranges []DeliveryTariffRange `gorm:"foreignKey:TariffID"`
}

func (DeliveryTariff) TableName() string { return "delivery_tariffs" }

// DeliveryTariffRange is one tier in a tiered delivery tariff.
type DeliveryTariffRange struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	TariffID  uuid.UUID `gorm:"type:uuid;not null"`
	MinAmount float64   `gorm:"type:numeric(12,2);not null"`
	MaxAmount *float64  `gorm:"type:numeric(12,2)"` // NULL = no upper bound
	Fee       float64   `gorm:"type:numeric(12,2);not null"`
	SortOrder int       `gorm:"default:0;not null"`
}

func (DeliveryTariffRange) TableName() string { return "delivery_tariff_ranges" }

// OrderFinancialSnapshot is the immutable rate snapshot frozen at order creation.
//
// Created once per order inside the order creation transaction (Phase 4).
// The Financial Engine reads ONLY from this table — never from commission_configs
// or delivery_tariffs during commission calculations.
//
// Phase 4 adds the FK: ALTER TABLE order_financial_snapshots
//   ADD CONSTRAINT fk_snapshot_order FOREIGN KEY (order_id) REFERENCES orders(id).
type OrderFinancialSnapshot struct {
	ID      uuid.UUID  `gorm:"type:uuid;primaryKey"`
	OrderID *uuid.UUID `gorm:"type:uuid;uniqueIndex"` // FK to orders added in Phase 4

	// Frozen resolved rates
	SellerRate          float64 `gorm:"type:numeric(6,5);not null"`
	ManagerTeamRate     float64 `gorm:"type:numeric(6,5);not null"`
	ManagerPersonalRate float64 `gorm:"type:numeric(6,5);not null"`
	TeamLeadPoolRate    float64 `gorm:"type:numeric(6,5);not null"`
	CompanyRate         float64 `gorm:"type:numeric(6,5);not null"`

	// Frozen delivery tariff
	TariffID   *uuid.UUID `gorm:"type:uuid"`
	TariffType TariffType `gorm:"type:tariff_type;not null"`
	TariffFee  float64    `gorm:"type:numeric(12,2);not null"`

	// Rate source tracing (for audit/reporting)
	SellerRateSource          RateSource `gorm:"type:rate_source;not null"`
	ManagerTeamRateSource     RateSource `gorm:"type:rate_source;not null"`
	ManagerPersonalRateSource RateSource `gorm:"type:rate_source;not null"`
	TeamLeadPoolRateSource    RateSource `gorm:"type:rate_source;not null"`
	CompanyRateSource         RateSource `gorm:"type:rate_source;not null"`

	// Config ID references for full traceability
	SellerConfigID          *uuid.UUID `gorm:"type:uuid"`
	ManagerTeamConfigID     *uuid.UUID `gorm:"type:uuid"`
	ManagerPersonalConfigID *uuid.UUID `gorm:"type:uuid"`
	TeamLeadPoolConfigID    *uuid.UUID `gorm:"type:uuid"`
	CompanyConfigID         *uuid.UUID `gorm:"type:uuid"`

	// Full denormalized JSON backup (human-readable, includes all resolution inputs)
	SnapshotJSON []byte `gorm:"type:jsonb;not null"`

	CreatedAt time.Time `gorm:"autoCreateTime"`
	// NO UpdatedAt. NEVER modified after creation.
}

func (OrderFinancialSnapshot) TableName() string { return "order_financial_snapshots" }

// FinancialEvent is one immutable ledger entry.
// Written by the Financial Engine (Phase 4) on order status transitions.
//
// Phase 25 hardening:
//   OrderID is now a value type (uuid.UUID, not *uuid.UUID) matching the
//   NOT NULL DB constraint added in migration 00036.  A zero UUID is rejected
//   by the DB FK; Go-level enforcement happens in emitFinancialEvents (orders/financial.go).
type FinancialEvent struct {
	ID         uuid.UUID          `gorm:"type:uuid;primaryKey"`
	OrderID    uuid.UUID          `gorm:"type:uuid;not null"` // Phase 25: NOT NULL, ON DELETE RESTRICT
	SnapshotID *uuid.UUID         `gorm:"type:uuid"`
	EventType  FinancialEventType `gorm:"type:financial_event_type;not null"`
	UserID     *uuid.UUID         `gorm:"type:uuid"`
	Amount     float64            `gorm:"type:numeric(12,2);not null"`
	Metadata   *[]byte            `gorm:"type:jsonb"`
	CreatedAt  time.Time          `gorm:"autoCreateTime"`
	// Immutable — no updated_at.
}

func (FinancialEvent) TableName() string { return "financial_events" }

// ─── Employee compensation ─────────────────────────────────────────────────────

// CompensationKind describes the pay structure for an employee.
// Maps to the compensation_kind PostgreSQL ENUM (migration 00044).
type CompensationKind string

const (
	CompensationKindPercent CompensationKind = "percent"
	CompensationKindFixed   CompensationKind = "fixed"
	CompensationKindMixed   CompensationKind = "mixed"
	CompensationKindNone    CompensationKind = "none"
)

// EmployeeCompensation is an immutable versioned pay record.
// A change creates a new active row and closes the previous one.
type EmployeeCompensation struct {
	ID               uuid.UUID        `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID           uuid.UUID        `gorm:"type:uuid;not null"`
	CompensationType CompensationKind `gorm:"type:compensation_kind;not null"`
	CommissionRate   *float64         `gorm:"type:numeric(6,5)"`   // decimal 0-1, used for percent/mixed
	FixedSalary      *float64         `gorm:"type:numeric(12,2)"`  // monthly amount in Currency
	Currency         string           `gorm:"type:varchar(10);not null;default:'TJS'"`
	EffectiveFrom    time.Time        `gorm:"not null"`
	EffectiveTo      *time.Time       // NULL = currently active
	IsActive         bool             `gorm:"not null;default:true"`
	Notes            string           `gorm:"not null;default:''"`
	CreatedBy        *uuid.UUID       `gorm:"type:uuid"`
	CreatedAt        time.Time        `gorm:"autoCreateTime"`
}

func (EmployeeCompensation) TableName() string { return "employee_compensations" }
