package onboarding

import (
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/users"
)

// CreateApplicationRequest is the payload for the public POST endpoint.
// Deliberately has no role field — an applicant never self-selects an RBAC
// role; an owner assigns it at approval time (see ApproveApplicationRequest).
type CreateApplicationRequest struct {
	Phone           string     `json:"phone"            validate:"required,min=7,max=20"`
	Email           *string    `json:"email"            validate:"omitempty,email"`
	Password        string     `json:"password"         validate:"required,min=8,max=72"`
	FullName        string     `json:"full_name"        validate:"required,min=2,max=255"`
	Surname         *string    `json:"surname"          validate:"omitempty,max=255"`
	DesiredPosition *string    `json:"desired_position" validate:"omitempty,max=255"`
	DateOfBirth     *time.Time `json:"date_of_birth"    validate:"omitempty"`
	Address         *string    `json:"address"          validate:"omitempty,max=500"`
}

// ApproveApplicationRequest is the payload for POST /worker-applications/:id/approve.
// The owner picks the real system role here — never taken from the applicant.
type ApproveApplicationRequest struct {
	Role users.Role `json:"role" validate:"required"`
}

// AllowedDocumentTypes mirrors internal/users' document type set exactly
// (see users.normalizedDocumentType) so an application's documents land in
// the same categories HR already uses on the employee detail page.
var AllowedDocumentTypes = map[string]bool{
	"passport": true, "contract": true, "certificate": true,
	"diploma": true, "medical": true, "other": true,
}

// NormalizedDocumentType maps any unrecognized/empty value to "other" —
// mirrors users.normalizedDocumentType.
func NormalizedDocumentType(value string) string {
	if AllowedDocumentTypes[value] {
		return value
	}
	return "other"
}

// DocumentResponse is one attached document's HR-facing (owner-only)
// representation. URL is a freshly-minted signed URL, resolved at request
// time — never persisted, since it expires (see MediaConfig.SignedURLTTL) —
// exactly like users.UserDocumentResponse.FileURL.
type DocumentResponse struct {
	ID               uuid.UUID `json:"id"`
	DocumentType     string    `json:"document_type"`
	OriginalFilename string    `json:"original_filename"`
	ContentType      *string   `json:"content_type,omitempty"`
	SizeBytes        *int64    `json:"size_bytes,omitempty"`
	URL              string    `json:"url,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

// SubmitResponse is returned to the (unauthenticated) applicant — only what
// they need to know their submission was received, nothing else.
type SubmitResponse struct {
	ID     uuid.UUID `json:"id"`
	Status Status    `json:"status"`
}

// ApplicationResponse is the HR-facing (owner-only) representation — full
// submitted profile, never the password hash.
type ApplicationResponse struct {
	ID              uuid.UUID  `json:"id"`
	Phone           string     `json:"phone"`
	Email           *string    `json:"email"`
	FullName        string     `json:"full_name"`
	Surname         *string    `json:"surname"`
	DesiredPosition *string    `json:"desired_position"`
	DateOfBirth     *time.Time `json:"date_of_birth"`
	Address         *string    `json:"address"`
	Status          Status     `json:"status"`
	ReviewedBy      *uuid.UUID `json:"reviewed_by,omitempty"`
	ReviewedAt      *time.Time `json:"reviewed_at,omitempty"`
	CreatedUserID   *uuid.UUID `json:"created_user_id,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	// Documents is only populated by GetByID (the owner-review detail call)
	// — List omits it entirely so listing pending applications never mints
	// signed URLs it doesn't need.
	Documents []DocumentResponse `json:"documents,omitempty"`
}

func ToSubmitResponse(a *WorkerApplication) SubmitResponse {
	return SubmitResponse{ID: a.ID, Status: a.Status}
}

func ToApplicationResponse(a *WorkerApplication) ApplicationResponse {
	return ApplicationResponse{
		ID:              a.ID,
		Phone:           a.Phone,
		Email:           a.Email,
		FullName:        a.FullName,
		Surname:         a.Surname,
		DesiredPosition: a.DesiredPosition,
		DateOfBirth:     a.DateOfBirth,
		Address:         a.Address,
		Status:          a.Status,
		ReviewedBy:      a.ReviewedBy,
		ReviewedAt:      a.ReviewedAt,
		CreatedUserID:   a.CreatedUserID,
		CreatedAt:       a.CreatedAt,
	}
}

func ToApplicationResponseList(apps []WorkerApplication) []ApplicationResponse {
	out := make([]ApplicationResponse, len(apps))
	for i := range apps {
		out[i] = ToApplicationResponse(&apps[i])
	}
	return out
}

// toDocumentResponse converts a document row's static fields — URL is left
// empty here and filled in by the caller (Service.GetByID), which is the
// only place that has a signedMediaURL function to mint it with.
func toDocumentResponse(d *WorkerApplicationDocument) DocumentResponse {
	return DocumentResponse{
		ID:               d.ID,
		DocumentType:     d.DocumentType,
		OriginalFilename: d.OriginalFilename,
		ContentType:      d.ContentType,
		SizeBytes:        d.SizeBytes,
		CreatedAt:        d.CreatedAt,
	}
}
