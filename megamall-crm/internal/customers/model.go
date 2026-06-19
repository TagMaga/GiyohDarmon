package customers

import (
	"time"

	"github.com/google/uuid"
)

// CustomerSource is the acquisition channel for a customer.
type CustomerSource string

const (
	SourceInstagram   CustomerSource = "instagram"
	SourceFacebook    CustomerSource = "facebook"
	SourceTikTok      CustomerSource = "tiktok"
	SourceWebsite     CustomerSource = "website"
	SourcePhone       CustomerSource = "phone"
	SourceReferral    CustomerSource = "referral"
	SourceMarketplace CustomerSource = "marketplace"
	SourceOther       CustomerSource = "other"
)

func (s CustomerSource) IsValid() bool {
	switch s {
	case SourceInstagram, SourceFacebook, SourceTikTok, SourceWebsite,
		SourcePhone, SourceReferral, SourceMarketplace, SourceOther:
		return true
	}
	return false
}

// Customer is the end-customer who places orders.
// Duplicate phones are intentionally allowed (business rule).
type Customer struct {
	ID             uuid.UUID      `gorm:"type:uuid;primaryKey"`
	FullName       string         `gorm:"not null"`
	Phone          string         `gorm:"not null"`
	PhoneSecondary *string        `gorm:"column:phone_secondary"`
	City           *string
	Region         *string
	Address        *string
	Notes          *string
	Source         *CustomerSource `gorm:"type:customer_source"`
	CreatedBy      *uuid.UUID      `gorm:"type:uuid;column:created_by"`
	CreatedAt      time.Time       `gorm:"autoCreateTime"`
	UpdatedAt      time.Time       `gorm:"autoUpdateTime"`
	DeletedAt      *time.Time      `gorm:"index"`
}

func (Customer) TableName() string { return "customers" }
