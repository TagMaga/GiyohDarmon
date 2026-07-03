package payouts

import "github.com/google/uuid"

// CreatePayoutItem is one row of a bulk "Выплатить" action.
type CreatePayoutItem struct {
	PayeeID uuid.UUID `json:"payee_id" validate:"required,uuid4"`
	Amount  float64   `json:"amount"   validate:"required,gt=0"`
}

// CreatePayoutsRequest bulk-creates payouts in one transaction — matches the
// mockup's multi-select → one confirm sheet → one POST flow.
//
// IdempotencyKey is required: the client generates one UUID per submission
// attempt (not per row) and resends the same value on a retry. The server
// dedupes on (payer_id, idempotency_key) via payout_batches — a retried
// request replays the original result instead of creating a second batch.
type CreatePayoutsRequest struct {
	Items          []CreatePayoutItem `json:"items"           validate:"required,min=1,dive"`
	PeriodStart    string             `json:"period_start"    validate:"required"` // YYYY-MM-DD
	PeriodEnd      string             `json:"period_end"      validate:"required"` // YYYY-MM-DD
	Method         string             `json:"method"          validate:"omitempty,oneof=cash bank_transfer card"`
	Note           string             `json:"note"`
	IdempotencyKey string             `json:"idempotency_key" validate:"required,min=8,max=100"`
}

// VoidPayoutRequest reverses a payout — a status flag + audit trail, never a
// hard delete, so the ledger stays append-only.
type VoidPayoutRequest struct {
	Reason string `json:"reason" validate:"required,min=3"`
}

// PayableMember is one row of the Team Lead "Кому выплатить" payables list.
type PayableMember struct {
	PayeeID     uuid.UUID `json:"payee_id"`
	FullName    string    `json:"full_name"`
	Role        string    `json:"role"`
	OrdersCount int       `json:"orders_count"`
	GrossAmount float64   `json:"gross_amount"` // "Сумма заказов"
	Earned      float64   `json:"earned"`       // "Доход" — from financial_events
	AlreadyPaid float64   `json:"already_paid"` // sum(payouts) this payer already made this payee, this period
	Remaining   float64   `json:"remaining"`    // Earned - AlreadyPaid, floored at 0
}

// PayablesResponse backs the Team Lead "Финансы" payables list + hero card.
type PayablesResponse struct {
	TeamLeadID     uuid.UUID       `json:"team_lead_id"`
	PeriodStart    string          `json:"period_start"`
	PeriodEnd      string          `json:"period_end"`
	TeamEarned     float64         `json:"team_earned"`     // sum of all members' Earned
	TeamPaid       float64         `json:"team_paid"`       // sum of all members' AlreadyPaid
	TeamRemaining  float64         `json:"team_remaining"`  // TeamEarned - TeamPaid
	PersonalPool   float64         `json:"personal_pool"`   // team_lead_pool_earned for the team lead themselves
	PersonalNet    float64         `json:"personal_net"`    // PersonalPool - sum(payouts the team lead made, this period)
	Members        []PayableMember `json:"members"`
}
