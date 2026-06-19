package delivery_settings

import (
	"time"

	"github.com/google/uuid"
)

// Settings is a singleton row (id=1) storing the owner-configured CLIENT delivery
// fee. This is the single source of truth for what the client pays for delivery.
//   • NormalFee — normal delivery; default 0 (free for the client).
//   • FastFee   — fast delivery; owner-configurable.
// Courier payout is a SEPARATE concept (see internal/logistics_settings) and is
// never derived from these fees.
type Settings struct {
	ID        int        `gorm:"column:id;primaryKey"`
	NormalFee float64    `gorm:"column:normal_fee;not null;default:0"`
	FastFee   float64    `gorm:"column:fast_fee;not null;default:0"`
	UpdatedBy *uuid.UUID `gorm:"column:updated_by;type:uuid"`
	UpdatedAt time.Time  `gorm:"column:updated_at;autoUpdateTime"`
}

func (Settings) TableName() string { return "delivery_settings" }

// ─── DTOs ─────────────────────────────────────────────────────────────────────

type Response struct {
	NormalFee float64 `json:"normal_fee"`
	FastFee   float64 `json:"fast_fee"`
}

type UpdateRequest struct {
	NormalFee float64 `json:"normal_fee" validate:"min=0"`
	FastFee   float64 `json:"fast_fee"   validate:"min=0"`
}
