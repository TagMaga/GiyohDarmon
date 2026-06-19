package compensation

import (
	"time"

	"github.com/google/uuid"
)

// ─── Actor info (passed from handler to service for audit logging) ─────────────

// ActorInfo carries the authenticated caller's metadata for activity log entries.
type ActorInfo struct {
	ID        uuid.UUID
	IPAddress *string
	UserAgent *string
}

// ─── Commission config request DTOs ───────────────────────────────────────────

// CreateConfigRequest is the body for POST /hr/compensation/configs.
type CreateConfigRequest struct {
	// Scope determines which level this config applies to.
	// Must be one of: "global", "team", "employee".
	Scope string `json:"scope" validate:"required,oneof=global team employee"`

	// TeamID is required when scope = "team". Must be nil for global/employee.
	TeamID *uuid.UUID `json:"team_id"`

	// UserID is required when scope = "employee". Must be nil for global/team.
	UserID *uuid.UUID `json:"user_id"`

	CommissionType CommissionType `json:"commission_type" validate:"required"`

	// Rate must be > 0 and <= 1 (i.e. 0.10 = 10%).
	Rate float64 `json:"rate" validate:"gt=0,lte=1"`

	// EffectiveFrom is the timestamp from which this rate takes effect.
	// Can be a past or future date. Must not be zero.
	EffectiveFrom time.Time `json:"effective_from" validate:"required"`

	// Notes is the mandatory reason for this rate change.
	Notes string `json:"notes" validate:"required,min=1"`
}

// DisableConfigRequest is the body for POST /hr/compensation/configs/:id/disable.
type DisableConfigRequest struct {
	// EffectiveTo is the timestamp at which this config becomes inactive.
	EffectiveTo time.Time `json:"effective_to" validate:"required"`

	// Notes is the mandatory reason for disabling.
	Notes string `json:"notes" validate:"required,min=1"`
}

// ConfigFilter is used to filter commission config list/history queries.
// All fields are optional.
type ConfigFilter struct {
	UserID         *uuid.UUID
	TeamID         *uuid.UUID
	CommissionType *CommissionType
	From           *time.Time
	To             *time.Time
	// Scope: "global", "team", "employee", or "" (all)
	Scope string
}

// ─── Commission config response DTOs ──────────────────────────────────────────

// CommissionConfigResponse is the API representation of a CommissionConfig.
type CommissionConfigResponse struct {
	ID             uuid.UUID      `json:"id"`
	Scope          string         `json:"scope"`
	TeamID         *uuid.UUID     `json:"team_id,omitempty"`
	UserID         *uuid.UUID     `json:"user_id,omitempty"`
	CommissionType CommissionType `json:"commission_type"`
	Rate           float64        `json:"rate"`
	EffectiveFrom  time.Time      `json:"effective_from"`
	EffectiveTo    *time.Time     `json:"effective_to,omitempty"`
	Notes          string         `json:"notes"`
	CreatedBy      *uuid.UUID     `json:"created_by,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	IsActive       bool           `json:"is_active"` // computed: effective_to IS NULL
}

// ToConfigResponse converts a domain model to its response DTO.
func ToConfigResponse(c *CommissionConfig) CommissionConfigResponse {
	return CommissionConfigResponse{
		ID:             c.ID,
		Scope:          c.Scope(),
		TeamID:         c.TeamID,
		UserID:         c.UserID,
		CommissionType: c.CommissionType,
		Rate:           c.Rate,
		EffectiveFrom:  c.EffectiveFrom,
		EffectiveTo:    c.EffectiveTo,
		Notes:          c.Notes,
		CreatedBy:      c.CreatedBy,
		CreatedAt:      c.CreatedAt,
		IsActive:       c.EffectiveTo == nil,
	}
}

// ToConfigResponseList converts a slice of domain models.
func ToConfigResponseList(configs []CommissionConfig) []CommissionConfigResponse {
	out := make([]CommissionConfigResponse, len(configs))
	for i := range configs {
		out[i] = ToConfigResponse(&configs[i])
	}
	return out
}

// GlobalRateEntry is a single entry in the GlobalRatesResponse.
type GlobalRateEntry struct {
	ConfigID      uuid.UUID      `json:"config_id"`
	CommissionType CommissionType `json:"commission_type"`
	Rate          float64        `json:"rate"`
	EffectiveFrom time.Time      `json:"effective_from"`
	Notes         string         `json:"notes"`
}

// GlobalRatesResponse is returned by GET /hr/compensation/global.
type GlobalRatesResponse struct {
	SellerRate            GlobalRateEntry `json:"seller_rate"`
	ManagerTeamRate       GlobalRateEntry `json:"manager_team_rate"`
	ManagerPersonalRate   GlobalRateEntry `json:"manager_personal_rate"`
	TeamLeadPoolRate      GlobalRateEntry `json:"team_lead_pool_rate"`
	CompanyRate           GlobalRateEntry `json:"company_rate"`
}

// ─── Delivery tariff request DTOs ─────────────────────────────────────────────

// TariffRangeInput is one tier range inside CreateTariffRequest.
type TariffRangeInput struct {
	// MinAmount is the lower bound (inclusive, >= 0).
	MinAmount float64 `json:"min_amount" validate:"gte=0"`

	// MaxAmount is the upper bound (exclusive). Null = no upper bound (unlimited).
	MaxAmount *float64 `json:"max_amount"`

	// Fee applied when the order total falls in this range.
	Fee float64 `json:"fee" validate:"gt=0"`
}

// CreateTariffRequest is the body for POST /hr/tariffs.
type CreateTariffRequest struct {
	Name string     `json:"name" validate:"required,min=1"`
	Type TariffType `json:"type" validate:"required,oneof=fixed tiered"`

	// FixedFee is required when type = "fixed". Must be > 0.
	FixedFee *float64 `json:"fixed_fee"`

	// Ranges are required when type = "tiered". Must not overlap.
	Ranges []TariffRangeInput `json:"ranges"`

	// EffectiveFrom is when this tariff takes effect.
	EffectiveFrom time.Time `json:"effective_from" validate:"required"`

	// Notes is the mandatory reason for creating this tariff.
	Notes string `json:"notes" validate:"required,min=1"`
}

// DeactivateTariffRequest is the body for POST /hr/tariffs/:id/deactivate.
type DeactivateTariffRequest struct {
	// EffectiveTo is the timestamp at which this tariff becomes inactive.
	EffectiveTo time.Time `json:"effective_to" validate:"required"`

	// Notes is the mandatory reason for deactivation.
	Notes string `json:"notes" validate:"required,min=1"`
}

// ─── Delivery tariff response DTOs ────────────────────────────────────────────

// TariffRangeResponse is the API representation of a DeliveryTariffRange.
type TariffRangeResponse struct {
	ID        uuid.UUID `json:"id"`
	MinAmount float64   `json:"min_amount"`
	MaxAmount *float64  `json:"max_amount,omitempty"`
	Fee       float64   `json:"fee"`
	SortOrder int       `json:"sort_order"`
}

// DeliveryTariffResponse is the API representation of a DeliveryTariff.
type DeliveryTariffResponse struct {
	ID            uuid.UUID             `json:"id"`
	Name          string                `json:"name"`
	Type          TariffType            `json:"type"`
	FixedFee      *float64              `json:"fixed_fee,omitempty"`
	IsActive      bool                  `json:"is_active"`
	EffectiveFrom time.Time             `json:"effective_from"`
	EffectiveTo   *time.Time            `json:"effective_to,omitempty"`
	Notes         string                `json:"notes"`
	CreatedBy     *uuid.UUID            `json:"created_by,omitempty"`
	CreatedAt     time.Time             `json:"created_at"`
	Ranges        []TariffRangeResponse `json:"ranges,omitempty"`
}

// ToTariffResponse converts a domain model to its response DTO.
func ToTariffResponse(t *DeliveryTariff) DeliveryTariffResponse {
	resp := DeliveryTariffResponse{
		ID:            t.ID,
		Name:          t.Name,
		Type:          t.Type,
		FixedFee:      t.FixedFee,
		IsActive:      t.IsActive && t.EffectiveTo == nil,
		EffectiveFrom: t.EffectiveFrom,
		EffectiveTo:   t.EffectiveTo,
		Notes:         t.Notes,
		CreatedBy:     t.CreatedBy,
		CreatedAt:     t.CreatedAt,
	}
	if len(t.Ranges) > 0 {
		resp.Ranges = make([]TariffRangeResponse, len(t.Ranges))
		for i, r := range t.Ranges {
			resp.Ranges[i] = TariffRangeResponse{
				ID:        r.ID,
				MinAmount: r.MinAmount,
				MaxAmount: r.MaxAmount,
				Fee:       r.Fee,
				SortOrder: r.SortOrder,
			}
		}
	}
	return resp
}

// ToTariffResponseList converts a slice of tariff domain models.
func ToTariffResponseList(tariffs []DeliveryTariff) []DeliveryTariffResponse {
	out := make([]DeliveryTariffResponse, len(tariffs))
	for i := range tariffs {
		out[i] = ToTariffResponse(&tariffs[i])
	}
	return out
}

// ─── Preview DTOs ─────────────────────────────────────────────────────────────

// PreviewQueryParams is bound from GET /hr/compensation/preview query string.
type PreviewQueryParams struct {
	OrderTotal float64   `form:"order_total"`
	OrderType  OrderType `form:"order_type"`
}

// RateInfo holds one resolved rate and its tracing metadata.
type RateInfo struct {
	Rate          float64    `json:"rate"`
	Source        RateSource `json:"source"`
	ConfigID      uuid.UUID  `json:"config_id"`
	EffectiveFrom time.Time  `json:"effective_from"`
}

// TariffInfo holds the resolved delivery tariff details.
type TariffInfo struct {
	TariffID   uuid.UUID  `json:"tariff_id"`
	TariffType TariffType `json:"tariff_type"`
	Fee        float64    `json:"fee"`
}

// ResolvedRatesInfo groups all five resolved rates and the delivery tariff.
type ResolvedRatesInfo struct {
	SellerRate          RateInfo   `json:"seller_rate"`
	ManagerTeamRate     RateInfo   `json:"manager_team_rate"`
	ManagerPersonalRate RateInfo   `json:"manager_personal_rate"`
	TeamLeadPoolRate    RateInfo   `json:"team_lead_pool_rate"`
	CompanyRate         RateInfo   `json:"company_rate"`
	DeliveryTariff      TariffInfo `json:"delivery_tariff"`
}

// CommissionBreakdown shows the calculated amounts per participant.
//
// Which amounts are non-zero depends on the order type:
//   seller_order:           SellerCommission, ManagerTeamCommission, TeamLeadPool, CompanyRevenue
//   manager_personal_order: ManagerPersonalCommission, TeamLeadPool, CompanyRevenue
//                           (ManagerTeamCommission = 0: manager can't double-pay himself)
//   team_lead_personal_order: ManagerTeamCommission, TeamLeadPool, CompanyRevenue
type CommissionBreakdown struct {
	SellerCommission          float64 `json:"seller_commission"`
	ManagerTeamCommission     float64 `json:"manager_team_commission"`
	ManagerPersonalCommission float64 `json:"manager_personal_commission"`
	TeamLeadPool              float64 `json:"team_lead_pool"`
	CompanyRevenue            float64 `json:"company_revenue"`
	CourierFee                float64 `json:"courier_fee"` // = tariff_fee
}

// PreviewResponse is returned by GET /hr/compensation/preview.
type PreviewResponse struct {
	OrderType   OrderType         `json:"order_type"`
	OrderTotal  float64           `json:"order_total"`
	DeliveryFee float64           `json:"delivery_fee"`
	NetRevenue  float64           `json:"net_revenue"`
	Rates       ResolvedRatesInfo `json:"rates"`
	Breakdown   CommissionBreakdown `json:"breakdown"`
}

// ─── Employee compensation (fixed salary) DTOs ────────────────────────────────

// SetCompensationRequest is the body for POST /hr/compensation/employees/:user_id/salary.
type SetCompensationRequest struct {
	CompensationType CompensationKind `json:"compensation_type" validate:"required"`
	CommissionRate   *float64         `json:"commission_rate"`  // decimal 0-1
	FixedSalary      *float64         `json:"fixed_salary"`     // monthly amount
	Currency         string           `json:"currency"`
	EffectiveFrom    time.Time        `json:"effective_from" validate:"required"`
	Notes            string           `json:"notes" validate:"required,min=1"`
}

// EmployeeCompensationResponse is the API response for one compensation record.
type EmployeeCompensationResponse struct {
	ID               uuid.UUID        `json:"id"`
	UserID           uuid.UUID        `json:"user_id"`
	CompensationType CompensationKind `json:"compensation_type"`
	CommissionRate   *float64         `json:"commission_rate,omitempty"`
	FixedSalary      *float64         `json:"fixed_salary,omitempty"`
	Currency         string           `json:"currency"`
	EffectiveFrom    time.Time        `json:"effective_from"`
	EffectiveTo      *time.Time       `json:"effective_to,omitempty"`
	IsActive         bool             `json:"is_active"`
	Notes            string           `json:"notes"`
	CreatedAt        time.Time        `json:"created_at"`
}

// ToCompensationResponse maps an EmployeeCompensation domain model to the API DTO.
func ToCompensationResponse(ec *EmployeeCompensation) EmployeeCompensationResponse {
	if ec == nil {
		return EmployeeCompensationResponse{}
	}
	return EmployeeCompensationResponse{
		ID:               ec.ID,
		UserID:           ec.UserID,
		CompensationType: ec.CompensationType,
		CommissionRate:   ec.CommissionRate,
		FixedSalary:      ec.FixedSalary,
		Currency:         ec.Currency,
		EffectiveFrom:    ec.EffectiveFrom,
		EffectiveTo:      ec.EffectiveTo,
		IsActive:         ec.IsActive,
		Notes:            ec.Notes,
		CreatedAt:        ec.CreatedAt,
	}
}

// isValid returns true if the CompensationKind is a known value.
func (k CompensationKind) isValid() bool {
	switch k {
	case CompensationKindPercent, CompensationKindFixed, CompensationKindMixed, CompensationKindNone:
		return true
	}
	return false
}
