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
//   - Paid: total confirmed dispatcher_settlements' actually-received amount
//     (falls back to the declared amount for older rows with no
//     actual_received) remitted to the company.
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
	ID             uuid.UUID `json:"id"`
	DispatcherID   uuid.UUID `json:"dispatcher_id"`
	DispatcherName string    `json:"dispatcher_name"`
	// OwnerName is always the destination account's name — set on every
	// row regardless of review status, since the money is always headed to
	// the same (single) owner account. See Repository.PrimaryOwnerName.
	OwnerName       string     `json:"owner_name"`
	Amount          float64    `json:"amount"`
	ActualReceived  *float64   `json:"actual_received"`
	Status          string     `json:"status"`
	Comment         *string    `json:"comment"`
	AdminNote       *string    `json:"admin_note"`
	RejectionReason *string    `json:"rejection_reason"`
	ReviewedBy      *uuid.UUID `json:"reviewed_by"`
	ReviewedByName  *string    `json:"reviewed_by_name"`
	ReviewedAt      *time.Time `json:"reviewed_at"`
	CreatedAt       time.Time  `json:"created_at"`
	// CurrentDebt is the dispatcher's overall outstanding debt to the
	// company *right now* (same figure as the KPI box), not a historical
	// running balance as of this particular row — dispatcher_settlements
	// rows aren't interleaved with the cash_handovers events that grow the
	// debt, so a true per-row running balance isn't reconstructable the way
	// cash_handovers.courier_debt_after is. Same value repeats across all of
	// one dispatcher's rows.
	CurrentDebt float64 `json:"current_debt"`
	// MediaAssets is resolved fresh at request time (never scanned from
	// SQL) via the media pipeline adapters — mirrors
	// internal/courier.Service.ToHandoverResponse's MediaAssets doc
	// comment. Left nil (omitted) when the pipeline is disabled.
	MediaAssets []MediaAssetView `json:"media_assets,omitempty"`
}

// MediaAssetView is one resolved settlement proof image — same shape as
// internal/logistics.HandoverMediaAsset.
type MediaAssetView struct {
	ID       uuid.UUID `json:"id"`
	URL      string    `json:"url"`
	ThumbURL string    `json:"thumb_url,omitempty"`
	Width    *int      `json:"width,omitempty"`
	Height   *int      `json:"height,omitempty"`
}

// CreateRequest submits a "pay all received money to company" settlement.
// Amount is always the dispatcher's current outstanding debt at submission
// time, computed server-side (not client-supplied), so it can't drift from
// what the owner sees when reviewing it.
type CreateRequest struct {
	Comment *string `json:"comment"`
	// ProofAssetID is a previously-uploaded (POST /media, category
	// cash_handover_proof) media asset the dispatcher optionally attaches
	// as a receipt/cash photo — same claim-by-ID flow as
	// courier.SubmitHandoverRequest.MediaAssetIDs, just a single asset
	// instead of up to 5.
	ProofAssetID *uuid.UUID `json:"proof_asset_id"`
}

// ConfirmRequest is the owner's decision to accept a pending settlement —
// ActualReceived is what the owner actually counted, which may differ from
// the dispatcher's declared Amount (mirrors
// logistics.ConfirmHandoverRequest.ActualReturned's shortfall pattern).
type ConfirmRequest struct {
	// max=1000000 is a fat-finger/overflow guard on cash-in-hand, not a
	// real business ceiling — mirrors the same bound used elsewhere for
	// handover amounts.
	ActualReceived float64 `json:"actual_received" validate:"min=0,max=1000000"`
	AdminNote      *string `json:"admin_note"`
}

type RejectRequest struct {
	Reason string `json:"reason" validate:"required,min=1"`
}

// EditRequest corrects an already-finalized (confirmed/rejected) settlement
// — mirrors logistics.EditHandoverReq exactly. Every applied change is
// recorded in dispatcher_settlement_edits with the optional Reason.
type EditRequest struct {
	Status         *string  `json:"status" validate:"omitempty,oneof=confirmed rejected"`
	ActualReceived *float64 `json:"actual_received" validate:"omitempty,min=0,max=1000000"`
	AdminNote      *string  `json:"admin_note"`
	Reason         *string  `json:"reason"`
}

// EditRow is one append-only entry of a settlement's edit history — the
// initial confirm/reject decision plus every later correction.
type EditRow struct {
	ID                uuid.UUID  `json:"id"`
	SettlementID      uuid.UUID  `json:"settlement_id"`
	EditorID          *uuid.UUID `json:"editor_id"`
	EditorName        *string    `json:"editor_name"`
	Action            string     `json:"action"` // confirm | reject | edit
	OldStatus         *string    `json:"old_status"`
	NewStatus         *string    `json:"new_status"`
	OldActualReceived *float64   `json:"old_actual_received"`
	NewActualReceived *float64   `json:"new_actual_received"`
	OldAdminNote      *string    `json:"old_admin_note"`
	NewAdminNote      *string    `json:"new_admin_note"`
	Reason            *string    `json:"reason"`
	CreatedAt         time.Time  `json:"created_at"`
}
