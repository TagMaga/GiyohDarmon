package payouts

import (
	"time"

	"github.com/google/uuid"
)

// Payout records a cash-out event: payer pays payee an amount for a period.
// Generalizes the old seller-only payout table — a Team Lead can pay a Manager
// or a Seller, and (symmetrically) an Owner can pay a Team Lead, through the
// same shape.
type Payout struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	PayeeID     uuid.UUID `gorm:"type:uuid;not null;column:payee_id"`
	PayeeRole   string    `gorm:"type:user_role;not null;column:payee_role"`
	PayerID     uuid.UUID `gorm:"type:uuid;not null;column:payer_id"`
	PayerRole   string    `gorm:"type:user_role;not null;column:payer_role"`
	Amount      float64   `gorm:"type:numeric(12,2);not null;column:amount"`
	PeriodStart time.Time `gorm:"type:date;not null;column:period_start"`
	PeriodEnd   time.Time `gorm:"type:date;not null;column:period_end"`
	Method      *string   `gorm:"column:method"`
	Status      string    `gorm:"column:status;not null;default:paid"`
	Note        *string   `gorm:"type:text;column:note"`
	CreatedAt   time.Time `gorm:"autoCreateTime"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime"`
}

func (Payout) TableName() string { return "payouts" }

// PayoutResponse is the JSON shape returned to clients.
type PayoutResponse struct {
	ID          uuid.UUID  `json:"id"`
	PayeeID     uuid.UUID  `json:"payee_id"`
	PayeeRole   string     `json:"payee_role"`
	PayerID     uuid.UUID  `json:"payer_id"`
	PayerRole   string     `json:"payer_role"`
	Amount      float64    `json:"amount"`
	PeriodStart string     `json:"period_start"` // YYYY-MM-DD
	PeriodEnd   string     `json:"period_end"`   // YYYY-MM-DD
	Method      *string    `json:"method"`
	Status      string     `json:"status"`
	PaidAt      *time.Time `json:"paid_at"`
	Note        *string    `json:"note"`
	CreatedAt   time.Time  `json:"created_at"`
}

func ToResponse(p *Payout) PayoutResponse {
	var paidAt *time.Time
	if p.Status == "paid" {
		t := p.CreatedAt
		paidAt = &t
	}
	return PayoutResponse{
		ID:          p.ID,
		PayeeID:     p.PayeeID,
		PayeeRole:   p.PayeeRole,
		PayerID:     p.PayerID,
		PayerRole:   p.PayerRole,
		Amount:      p.Amount,
		PeriodStart: p.PeriodStart.Format("2006-01-02"),
		PeriodEnd:   p.PeriodEnd.Format("2006-01-02"),
		Method:      p.Method,
		Status:      p.Status,
		PaidAt:      paidAt,
		Note:        p.Note,
		CreatedAt:   p.CreatedAt,
	}
}
