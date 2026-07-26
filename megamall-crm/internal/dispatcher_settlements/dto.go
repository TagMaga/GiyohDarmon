package dispatcher_settlements

import (
	"time"

	"github.com/google/uuid"
)

// Summary backs the four KPI boxes shown on both the owner logistics cash
// tab and the dispatcher cash tab:
//   - CourierDebt: total outstanding cash couriers still owe (not yet
//     handed over / not yet confirmed), same formula as logistics.ListCouriers'
//     shortfall math.
//   - Received: total confirmed cash_handovers.actual_returned dispatchers
//     have collected from couriers.
//   - Paid: total confirmed dispatcher_settlements.amount remitted to the
//     company.
//   - DispatcherDebt: Received - Paid (money dispatchers currently hold
//     that is owed to the company).
type Summary struct {
	CourierDebt    float64 `json:"courier_debt"`
	Received       float64 `json:"received"`
	Paid           float64 `json:"paid"`
	DispatcherDebt float64 `json:"dispatcher_debt"`
}

// SummaryFilter scopes the KPI summary and the settlement history list.
// Nil DispatcherID means all dispatchers (owner-only view).
type SummaryFilter struct {
	From         *time.Time
	To           *time.Time
	DispatcherID *uuid.UUID
}

type ListFilter struct {
	From         *time.Time
	To           *time.Time
	DispatcherID *uuid.UUID
	Status       string
}

// Row is one settlement history entry.
type Row struct {
	ID              uuid.UUID  `json:"id"`
	DispatcherID    uuid.UUID  `json:"dispatcher_id"`
	DispatcherName  string     `json:"dispatcher_name"`
	Amount          float64    `json:"amount"`
	Status          string     `json:"status"`
	Comment         *string    `json:"comment"`
	RejectionReason *string    `json:"rejection_reason"`
	ReviewedBy      *uuid.UUID `json:"reviewed_by"`
	ReviewedByName  *string    `json:"reviewed_by_name"`
	ReviewedAt      *time.Time `json:"reviewed_at"`
	CreatedAt       time.Time  `json:"created_at"`
}

// CreateRequest submits a "pay all received money to company" settlement.
// Amount is always the dispatcher's current outstanding debt at submission
// time, computed server-side (not client-supplied), so it can't drift from
// what the owner sees when reviewing it.
type CreateRequest struct {
	Comment *string `json:"comment"`
}

type RejectRequest struct {
	Reason string `json:"reason" validate:"required,min=1"`
}
