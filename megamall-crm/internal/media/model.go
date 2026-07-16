// Package media owns the centralized upload pipeline: validation,
// processing (thumbnail/card/detail/WebP variants via libvips), storage,
// classification (public/private), and secure delivery (signed URLs for
// private media). It is additive alongside the existing internal/uploads
// package — domain modules (products, orders, users, courier) migrate to
// it endpoint by endpoint rather than in one atomic cutover; see the P0
// remediation plan (megamall-audits/megamall-p0-remediation-plan-20260716.md)
// for the phased design this implements.
package media

import (
	"time"

	"github.com/google/uuid"
)

type Visibility string

const (
	VisibilityPublic  Visibility = "public"
	VisibilityPrivate Visibility = "private"
)

type Category string

const (
	CategoryProductImage      Category = "product_image"
	CategoryAvatar            Category = "avatar"
	CategoryOrderAttachment   Category = "order_attachment"
	CategoryPrepaymentProof   Category = "prepayment_proof"
	CategoryUserDocument      Category = "user_document"
	CategoryCashHandoverProof Category = "cash_handover_proof"
)

// DefaultVisibility returns the mandated visibility for a category — the
// classification policy is fixed here, in code, not left to the caller, so
// a handler can never accidentally mark a private category public. Product
// images are the sole public category; everything else defaults private
// per the P0 remediation plan §3 classification table.
func (c Category) DefaultVisibility() Visibility {
	if c == CategoryProductImage {
		return VisibilityPublic
	}
	return VisibilityPrivate
}

// Valid reports whether c is one of the recognized categories. Any upload
// without an explicit recognized category must be rejected outright (never
// defaulted to public, never silently accepted) — see Service.Create.
func (c Category) Valid() bool {
	switch c {
	case CategoryProductImage, CategoryAvatar, CategoryOrderAttachment,
		CategoryPrepaymentProof, CategoryUserDocument, CategoryCashHandoverProof:
		return true
	}
	return false
}

type ProcessingStatus string

const (
	StatusPending    ProcessingStatus = "pending"
	StatusProcessing ProcessingStatus = "processing"
	StatusReady      ProcessingStatus = "ready"
	StatusFailed     ProcessingStatus = "failed"
)

// Variant describes one derived image (thumbnail/card/detail/webp master).
// Stored inside Asset.VariantMetadata as a JSON object keyed by variant
// name — never as a signed URL (signed URLs are minted per-request at
// delivery time, never persisted; see Service.SignedURL).
type Variant struct {
	StorageKey string `json:"storage_key"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Bytes      int    `json:"bytes"`
}

// Asset is the GORM mapping for media_assets (migration 00075).
type Asset struct {
	ID uuid.UUID `gorm:"type:uuid;primaryKey"`

	StorageKey        string `gorm:"column:storage_key;not null"`
	OriginalFilename  string `gorm:"column:original_filename;not null"`
	DetectedMimeType  string `gorm:"column:detected_mime_type;not null"`
	OriginalSizeBytes int64  `gorm:"column:original_size_bytes;not null"`
	Width             *int   `gorm:"column:width"`
	Height            *int   `gorm:"column:height"`
	ChecksumSHA256    string `gorm:"column:checksum_sha256;not null"`

	Visibility Visibility `gorm:"column:visibility;not null"`
	Category   Category   `gorm:"column:category;not null"`

	OwnerEntityType *string    `gorm:"column:owner_entity_type"`
	OwnerEntityID   *uuid.UUID `gorm:"column:owner_entity_id;type:uuid"`

	UploadedByUserID uuid.UUID `gorm:"column:uploaded_by_user_id;type:uuid;not null"`

	ProcessingStatus    ProcessingStatus `gorm:"column:processing_status;not null;default:pending"`
	OriginalStorageKey  string           `gorm:"column:original_storage_key;not null"`
	VariantMetadataJSON []byte           `gorm:"column:variant_metadata;type:jsonb"`

	CreatedAt     time.Time  `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt     time.Time  `gorm:"column:updated_at;autoUpdateTime"`
	DeletedAt     *time.Time `gorm:"column:deleted_at"`
	QuarantinedAt *time.Time `gorm:"column:quarantined_at"`
}

func (Asset) TableName() string { return "media_assets" }
