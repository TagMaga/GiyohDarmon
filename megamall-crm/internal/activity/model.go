package activity

import (
	"time"

	"github.com/google/uuid"
)

// Log is the domain model for an immutable audit log entry.
// Maps to the activity_logs table. Never updated or deleted.
type Log struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey"`
	ActorID     *uuid.UUID `gorm:"type:uuid"`
	Action      string     `gorm:"not null"`
	EntityType  string     `gorm:"not null"`
	EntityID    *uuid.UUID `gorm:"type:uuid"`
	BeforeState *[]byte    `gorm:"type:jsonb"`
	AfterState  *[]byte    `gorm:"type:jsonb"`
	IPAddress   *string    `gorm:"type:inet"`
	UserAgent   *string
	Reason      *string
	CreatedAt   time.Time `gorm:"autoCreateTime"`
}

func (Log) TableName() string { return "activity_logs" }

// Entry is the input type used to build a Log.
type Entry struct {
	ActorID     *uuid.UUID
	Action      string
	EntityType  string
	EntityID    *uuid.UUID
	BeforeState interface{}
	AfterState  interface{}
	IPAddress   *string
	UserAgent   *string
	Reason      *string
}
