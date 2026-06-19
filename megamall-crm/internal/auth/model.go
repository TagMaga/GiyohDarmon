package auth

import (
	"time"

	"github.com/google/uuid"
)

// RefreshToken maps to the refresh_tokens table.
// token_hash is SHA-256 of the raw token — raw token is never stored.
type RefreshToken struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey"`
	UserID     uuid.UUID `gorm:"type:uuid;not null"`
	TokenHash  string    `gorm:"not null;uniqueIndex"`
	FamilyID   uuid.UUID `gorm:"type:uuid;not null"`
	DeviceInfo *string
	IPAddress  *string   `gorm:"type:inet"`
	ExpiresAt  time.Time `gorm:"not null"`
	RevokedAt  *time.Time
	CreatedAt  time.Time `gorm:"autoCreateTime"`
}

func (RefreshToken) TableName() string { return "refresh_tokens" }

// IsValid returns true if the token is not expired and not revoked.
func (t *RefreshToken) IsValid() bool {
	return t.RevokedAt == nil && time.Now().UTC().Before(t.ExpiresAt)
}
