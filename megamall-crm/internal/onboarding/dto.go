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
