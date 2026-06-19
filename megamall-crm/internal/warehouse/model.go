package warehouse

import (
	"time"

	"github.com/google/uuid"
)

// Warehouse represents a physical storage location.
type Warehouse struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	Name      string    `gorm:"not null"`
	Address   *string
	Notes     *string
	IsActive  bool      `gorm:"column:is_active;default:true;not null"`
	CreatedAt time.Time `gorm:"autoCreateTime"`
	UpdatedAt time.Time `gorm:"autoUpdateTime"`
}

func (Warehouse) TableName() string { return "warehouses" }
