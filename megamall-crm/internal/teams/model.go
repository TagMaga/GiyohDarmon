package teams

import (
	"time"

	"github.com/google/uuid"
)

// Team maps to the teams table.
type Team struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey"`
	Name       string     `gorm:"not null"`
	TeamLeadID *uuid.UUID `gorm:"type:uuid"`
	ManagerID  *uuid.UUID `gorm:"type:uuid"`
	IsActive   bool       `gorm:"default:true;not null"`
	CreatedAt  time.Time  `gorm:"autoCreateTime"`
	UpdatedAt  time.Time  `gorm:"autoUpdateTime"`
	DeletedAt  *time.Time `gorm:"index"`
}

func (Team) TableName() string { return "teams" }
