// Package logistics_settings owns the owner-configurable logistics foundation:
// cities (visibility/assignment only — NOT pricing) and per-courier payout
// tariffs (paid from company margin, fully decoupled from the client delivery fee).
package logistics_settings

import (
	"time"

	"github.com/google/uuid"
)

// ─── Domain models ──────────────────────────────────────────────────────────

// City is an active delivery city. Cities drive order assignment and courier
// app visibility only; they never affect pricing.
type City struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	Name      string    `gorm:"column:name;not null;uniqueIndex"`
	IsActive  bool      `gorm:"column:is_active;not null;default:true"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (City) TableName() string { return "cities" }

// CourierProfile is the per-courier payout tariff. payout_normal / payout_fast
// are paid from company margin when an order is delivered — NOT taken from the
// client delivery fee. is_active gates new assignments.
type CourierProfile struct {
	UserID       uuid.UUID `gorm:"type:uuid;primaryKey;column:user_id"`
	PayoutNormal float64   `gorm:"type:numeric(12,2);not null;default:0;column:payout_normal"`
	PayoutFast   float64   `gorm:"type:numeric(12,2);not null;default:0;column:payout_fast"`
	IsActive     bool      `gorm:"column:is_active;not null;default:true"`
	CreatedAt    time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt    time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (CourierProfile) TableName() string { return "courier_profiles" }

// CourierCity links a courier to a city they serve (many-to-many).
type CourierCity struct {
	CourierID uuid.UUID `gorm:"type:uuid;primaryKey;column:courier_id"`
	CityID    uuid.UUID `gorm:"type:uuid;primaryKey;column:city_id"`
}

func (CourierCity) TableName() string { return "courier_cities" }

// ─── DTOs ───────────────────────────────────────────────────────────────────

type CityResponse struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	IsActive bool      `json:"is_active"`
}

type CreateCityRequest struct {
	Name string `json:"name"`
}

type ToggleCityRequest struct {
	IsActive bool `json:"is_active"`
}

// CourierPayoutResponse is the full per-courier payout config returned to the owner.
type CourierPayoutResponse struct {
	UserID       uuid.UUID   `json:"user_id"`
	PayoutNormal float64     `json:"payout_normal"`
	PayoutFast   float64     `json:"payout_fast"`
	IsActive     bool        `json:"is_active"`
	CityIDs      []uuid.UUID `json:"city_ids"`
}

// UpdateCourierPayoutRequest is the owner-only payout configuration payload.
type UpdateCourierPayoutRequest struct {
	PayoutNormal float64     `json:"payout_normal"`
	PayoutFast   float64     `json:"payout_fast"`
	IsActive     bool        `json:"is_active"`
	CityIDs      []uuid.UUID `json:"city_ids"`
}
