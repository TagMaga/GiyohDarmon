package warehouse

import (
	"time"

	"github.com/google/uuid"
)

type CreateWarehouseRequest struct {
	Name    string  `json:"name"    validate:"required,max=255"`
	Address *string `json:"address"`
	Notes   *string `json:"notes"`
}

type UpdateWarehouseRequest struct {
	Name     *string `json:"name"     validate:"omitempty,max=255"`
	Address  *string `json:"address"`
	Notes    *string `json:"notes"`
	IsActive *bool   `json:"is_active"`
}

type WarehouseResponse struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Address   *string   `json:"address"`
	Notes     *string   `json:"notes"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func ToWarehouseResponse(w *Warehouse) WarehouseResponse {
	return WarehouseResponse{
		ID:        w.ID,
		Name:      w.Name,
		Address:   w.Address,
		Notes:     w.Notes,
		IsActive:  w.IsActive,
		CreatedAt: w.CreatedAt,
		UpdatedAt: w.UpdatedAt,
	}
}
