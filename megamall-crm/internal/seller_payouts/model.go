package seller_payouts

import (
	"time"

	"github.com/google/uuid"
)

// SellerPayout records a cash-out event when an owner/manager pays a seller.
type SellerPayout struct {
	ID           uuid.UUID  `gorm:"type:uuid;primaryKey"`
	SellerID     uuid.UUID  `gorm:"type:uuid;not null;column:seller_id"`
	Amount       float64    `gorm:"type:numeric(12,2);not null;column:amount"`
	PeriodStart  time.Time  `gorm:"type:date;not null;column:period_start"`
	PeriodEnd    time.Time  `gorm:"type:date;not null;column:period_end"`
	Method       *string    `gorm:"column:method"`
	Status       string     `gorm:"column:status;not null;default:paid"`
	PaidByUserID *uuid.UUID `gorm:"type:uuid;column:paid_by_user_id"`
	PaidAt       *time.Time `gorm:"column:paid_at"`
	Note         *string    `gorm:"type:text;column:note"`
	CreatedAt    time.Time  `gorm:"autoCreateTime"`
	UpdatedAt    time.Time  `gorm:"autoUpdateTime"`
}

func (SellerPayout) TableName() string { return "seller_payouts" }

// SellerPayoutResponse is the JSON shape returned to the seller.
type SellerPayoutResponse struct {
	ID          uuid.UUID  `json:"id"`
	SellerID    uuid.UUID  `json:"seller_id"`
	Amount      float64    `json:"amount"`
	PeriodStart string     `json:"period_start"` // YYYY-MM-DD
	PeriodEnd   string     `json:"period_end"`   // YYYY-MM-DD
	Method      *string    `json:"method"`
	Status      string     `json:"status"`
	PaidAt      *time.Time `json:"paid_at"`
	Note        *string    `json:"note"`
	CreatedAt   time.Time  `json:"created_at"`
}

func ToResponse(p *SellerPayout) SellerPayoutResponse {
	return SellerPayoutResponse{
		ID:          p.ID,
		SellerID:    p.SellerID,
		Amount:      p.Amount,
		PeriodStart: p.PeriodStart.Format("2006-01-02"),
		PeriodEnd:   p.PeriodEnd.Format("2006-01-02"),
		Method:      p.Method,
		Status:      p.Status,
		PaidAt:      p.PaidAt,
		Note:        p.Note,
		CreatedAt:   p.CreatedAt,
	}
}
