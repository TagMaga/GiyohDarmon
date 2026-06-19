package hierarchy

import (
	"time"

	"github.com/google/uuid"
)

// UserHierarchy maps to the user_hierarchy table.
// One row per user — represents their current team and parent.
type UserHierarchy struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex"`
	ParentID  *uuid.UUID `gorm:"type:uuid"`
	TeamID    *uuid.UUID `gorm:"type:uuid"`
	CreatedAt time.Time  `gorm:"autoCreateTime"`
}

func (UserHierarchy) TableName() string { return "user_hierarchy" }
