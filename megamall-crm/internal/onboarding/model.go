package onboarding

import (
	"time"

	"github.com/google/uuid"
)

// Status constants matching the worker_applications.status column
// (migration 00086). There is deliberately no "rejected" value — a rejected
// application is deleted outright rather than kept around in a terminal
// state, so the only states an existing row can be in are pending or
// approved. See Service.Reject.
type Status string

const (
	StatusPending  Status = "pending"
	StatusApproved Status = "approved"
)

// WorkerApplication is the domain model. Maps to the worker_applications
// table — a holding area for a public /new submission until an owner
// approves (promotes it into a real users row, see Service.Approve) or
// rejects (deletes it, see Service.Reject) it.
type WorkerApplication struct {
	ID              uuid.UUID `gorm:"type:uuid;primaryKey"`
	Phone           string    `gorm:"not null"`
	Email           *string
	PasswordHash    string `gorm:"not null"`
	FullName        string `gorm:"not null"`
	Surname         *string
	DesiredPosition *string    `gorm:"column:desired_position"`
	DateOfBirth     *time.Time `gorm:"column:date_of_birth;type:date"`
	Address         *string
	Status          Status     `gorm:"not null;default:'pending'"`
	ReviewedBy      *uuid.UUID `gorm:"column:reviewed_by;type:uuid"`
	ReviewedAt      *time.Time `gorm:"column:reviewed_at"`
	CreatedUserID   *uuid.UUID `gorm:"column:created_user_id;type:uuid"`
	CreatedAt       time.Time  `gorm:"autoCreateTime"`
	UpdatedAt       time.Time  `gorm:"autoUpdateTime"`
}

func (WorkerApplication) TableName() string { return "worker_applications" }

// WorkerApplicationDocument is a file (passport, etc.) an applicant attached
// at submission time — always backed by the centralized media pipeline
// (media_asset_id), never the legacy public /uploads endpoint. See
// migration 00087 and Service.Create/Approve/Reject.
type WorkerApplicationDocument struct {
	ID               uuid.UUID  `gorm:"type:uuid;primaryKey"`
	ApplicationID    uuid.UUID  `gorm:"column:application_id;type:uuid;not null;index"`
	MediaAssetID     *uuid.UUID `gorm:"column:media_asset_id;type:uuid"`
	OriginalFilename string     `gorm:"column:original_filename;not null"`
	ContentType      *string    `gorm:"column:content_type"`
	SizeBytes        *int64     `gorm:"column:size_bytes"`
	DocumentType     string     `gorm:"column:document_type;not null;default:'other'"`
	Width            *int       `gorm:"column:width"`
	Height           *int       `gorm:"column:height"`
	CreatedAt        time.Time  `gorm:"autoCreateTime"`
}

func (WorkerApplicationDocument) TableName() string { return "worker_application_documents" }
