package media

import (
	"time"

	"github.com/google/uuid"
)

// CreateParams is everything Service.Create needs, already parsed off the
// multipart request by handler.go. Category/OwnerEntityType/OwnerEntityID
// are caller-supplied form fields; the file bytes are validated inside
// Create, never trusted beforehand.
type CreateParams struct {
	Category         Category
	OwnerEntityType  string // optional, empty for upload-then-attach flows
	OwnerEntityID    *uuid.UUID
	UploadedByUserID uuid.UUID
	OriginalFilename string
	DeclaredSize     int64
}

// VariantResponse is one derived (or original) file's public shape —
// note "url" is always minted fresh per response, never persisted.
type VariantResponse struct {
	Variant string `json:"variant"`
	URL     string `json:"url"`
	Width   int    `json:"width,omitempty"`
	Height  int    `json:"height,omitempty"`
	Bytes   int    `json:"bytes,omitempty"`
}

// AssetResponse is the API shape returned after upload / on lookup.
// Deliberately excludes original_filename-as-path, storage internals, and
// never includes a permanently-cacheable signed URL for private assets.
type AssetResponse struct {
	ID                uuid.UUID         `json:"id"`
	Category          Category          `json:"category"`
	Visibility        Visibility        `json:"visibility"`
	ProcessingStatus  ProcessingStatus  `json:"processing_status"`
	Width             int               `json:"width,omitempty"`
	Height            int               `json:"height,omitempty"`
	OriginalSizeBytes int64             `json:"original_size_bytes"`
	Variants          []VariantResponse `json:"variants,omitempty"`
	CreatedAt         time.Time         `json:"created_at"`
}

// SignedURLResponse is returned by the signed-URL-mint endpoint. Never
// persisted by the caller beyond its own in-memory lifetime — the frontend
// must re-request when ExpiresAt passes, per the "don't store signed URLs
// permanently" requirement.
type SignedURLResponse struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}
