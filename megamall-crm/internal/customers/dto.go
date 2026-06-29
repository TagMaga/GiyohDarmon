package customers

import (
	"time"

	"github.com/google/uuid"
)

// ─── CRUD ─────────────────────────────────────────────────────────────────────

type CreateCustomerRequest struct {
	FullName       string          `json:"full_name"        validate:"omitempty,max=255"`
	Phone          string          `json:"phone"            validate:"required,max=20"`
	PhoneSecondary *string         `json:"phone_secondary"`
	City           *string         `json:"city"`
	Region         *string         `json:"region"`
	Address        *string         `json:"address"`
	Notes          *string         `json:"notes"`
	Source         *CustomerSource `json:"source"`
}

type UpdateCustomerRequest struct {
	FullName       *string         `json:"full_name"        validate:"omitempty,max=255"`
	Phone          *string         `json:"phone"            validate:"omitempty,max=20"`
	PhoneSecondary *string         `json:"phone_secondary"`
	City           *string         `json:"city"`
	Region         *string         `json:"region"`
	Address        *string         `json:"address"`
	Notes          *string         `json:"notes"`
	Source         *CustomerSource `json:"source"`
}

type CustomerResponse struct {
	ID             uuid.UUID       `json:"id"`
	FullName       string          `json:"full_name"`
	Phone          string          `json:"phone"`
	PhoneSecondary *string         `json:"phone_secondary"`
	City           *string         `json:"city"`
	Region         *string         `json:"region"`
	Address        *string         `json:"address"`
	Notes          *string         `json:"notes"`
	Source         *CustomerSource `json:"source"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

func ToCustomerResponse(c *Customer) CustomerResponse {
	return CustomerResponse{
		ID:             c.ID,
		FullName:       c.FullName,
		Phone:          c.Phone,
		PhoneSecondary: c.PhoneSecondary,
		City:           c.City,
		Region:         c.Region,
		Address:        c.Address,
		Notes:          c.Notes,
		Source:         c.Source,
		CreatedAt:      c.CreatedAt,
		UpdatedAt:      c.UpdatedAt,
	}
}

// ─── Customer History ─────────────────────────────────────────────────────────

// CustomerHistory is the aggregated order summary for one customer.
type CustomerHistory struct {
	Customer        CustomerResponse `json:"customer"`
	TotalOrders     int              `json:"total_orders"`
	TotalSpent      float64          `json:"total_spent"`
	DeliveredCount  int              `json:"delivered_count"`
	CancelledCount  int              `json:"cancelled_count"`
	ReturnedCount   int              `json:"returned_count"`
	AverageOrder    float64          `json:"average_order_value"`
	LastOrderAt     *time.Time       `json:"last_order_at"`
}

// ─── Filter ───────────────────────────────────────────────────────────────────

type ListCustomersFilter struct {
	Search string `form:"search"`
	City   string `form:"city"`
	Source string `form:"source"`
}
