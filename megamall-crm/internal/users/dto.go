package users

import (
	"time"

	"github.com/google/uuid"
)

// CreateUserRequest is the payload for POST /users.
type CreateUserRequest struct {
	Phone       string     `json:"phone"         validate:"required,min=7,max=20"`
	Email       *string    `json:"email"         validate:"omitempty,email"`
	Password    string     `json:"password"      validate:"required,min=8,max=72"`
	FullName    string     `json:"full_name"     validate:"required,min=2,max=255"`
	Role        Role       `json:"role"          validate:"required"`
	HireDate    *time.Time `json:"hire_date"     validate:"omitempty"`
	DateOfBirth *time.Time `json:"date_of_birth" validate:"omitempty"`
	Address     *string    `json:"address"       validate:"omitempty,max=500"`
}

// UpdateUserRequest is the payload for PATCH /users/:id.
type UpdateUserRequest struct {
	Phone       *string    `json:"phone"         validate:"omitempty,min=7,max=20"`
	FullName    *string    `json:"full_name"     validate:"omitempty,min=2,max=255"`
	Role        *Role      `json:"role"          validate:"omitempty"`
	IsActive    *bool      `json:"is_active"`
	AvatarURL   *string    `json:"avatar_url"    validate:"omitempty,max=500"`
	Status      *Status    `json:"status"        validate:"omitempty"`
	HireDate    *time.Time `json:"hire_date"     validate:"omitempty"`
	DateOfBirth *time.Time `json:"date_of_birth" validate:"omitempty"`
	Address     *string    `json:"address"       validate:"omitempty,max=500"`
}

// ChangePasswordRequest is the payload for PATCH /users/:id/password.
type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password" validate:"required"`
	NewPassword     string `json:"new_password"     validate:"required,min=8,max=72"`
}

// ListUsersFilter holds query-string filters for GET /users.
type ListUsersFilter struct {
	Role     *Role       `form:"role"`
	IsActive *bool       `form:"is_active"`
	Status   *Status     `form:"status"`
	Search   string      `form:"search"` // matches phone or full_name
	IDs      []uuid.UUID `form:"-"`      // parsed manually from repeated ids[] query params
	TeamID   *uuid.UUID  `form:"-"`      // set internally to scope non-owner callers to their own team
}

// UserResponse is the public-facing user representation (no password hash).
type UserResponse struct {
	ID             uuid.UUID  `json:"id"`
	Phone          string     `json:"phone"`
	Email          *string    `json:"email"`
	FullName       string     `json:"full_name"`
	Surname        *string    `json:"surname"`
	Role           Role       `json:"role"`
	IsActive       bool       `json:"is_active"`
	AvatarURL      *string    `json:"avatar_url"`
	TelegramChatID *string    `json:"telegram_chat_id"`
	Status         Status     `json:"status"`
	HireDate       *time.Time `json:"hire_date"`
	DateOfBirth    *time.Time `json:"date_of_birth"`
	Address        *string    `json:"address"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// PatchMeRequest allows a user to update their own editable profile fields.
type PatchMeRequest struct {
	FullName       *string    `json:"full_name" validate:"omitempty,min=2,max=255"`
	DateOfBirth    *time.Time `json:"date_of_birth" validate:"omitempty"`
	TelegramChatID *string    `json:"telegram_chat_id" validate:"omitempty,max=100"`
}

// CreateUserDocumentRequest stores metadata for a file already uploaded via
// POST /uploads.
type CreateUserDocumentRequest struct {
	FileURL          string     `json:"file_url" validate:"required,max=1000"`
	OriginalFilename string     `json:"original_filename" validate:"required,max=255"`
	ContentType      *string    `json:"content_type" validate:"omitempty,max=120"`
	SizeBytes        *int64     `json:"size_bytes" validate:"omitempty,gte=0"`
	DocumentType     *string    `json:"document_type" validate:"omitempty,max=80"`
	ExpiresAt        *time.Time `json:"expires_at" validate:"omitempty"`
}

type UpdateUserDocumentStatusRequest struct {
	VerificationStatus string `json:"verification_status" validate:"required,oneof=uploaded verified rejected"`
}

type UserDocumentResponse struct {
	ID                 uuid.UUID  `json:"id"`
	UserID             uuid.UUID  `json:"user_id"`
	FileURL            string     `json:"file_url"`
	OriginalFilename   string     `json:"original_filename"`
	ContentType        *string    `json:"content_type,omitempty"`
	SizeBytes          *int64     `json:"size_bytes,omitempty"`
	DocumentType       string     `json:"document_type"`
	ExpiresAt          *time.Time `json:"expires_at,omitempty"`
	VerificationStatus string     `json:"verification_status"`
	UploadedBy         *uuid.UUID `json:"uploaded_by,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
}

type UserHistoryResponse struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"user_id"`
	FieldName string     `json:"field_name"`
	OldValue  *string    `json:"old_value,omitempty"`
	NewValue  *string    `json:"new_value,omitempty"`
	ChangedBy *uuid.UUID `json:"changed_by,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// ToResponse converts a User model to a UserResponse DTO.
func ToResponse(u *User) UserResponse {
	return UserResponse{
		ID:             u.ID,
		Phone:          u.Phone,
		Email:          u.Email,
		FullName:       u.FullName,
		Surname:        u.Surname,
		Role:           u.Role,
		IsActive:       u.IsActive,
		AvatarURL:      u.AvatarURL,
		TelegramChatID: u.TelegramChatID,
		Status:         u.Status,
		HireDate:       u.HireDate,
		DateOfBirth:    u.DateOfBirth,
		Address:        u.Address,
		CreatedAt:      u.CreatedAt,
		UpdatedAt:      u.UpdatedAt,
	}
}

// ToResponseList converts a slice of User models to UserResponse DTOs.
func ToResponseList(users []User) []UserResponse {
	out := make([]UserResponse, len(users))
	for i := range users {
		out[i] = ToResponse(&users[i])
	}
	return out
}

func ToDocumentResponse(d *UserDocument) UserDocumentResponse {
	return UserDocumentResponse{
		ID:                 d.ID,
		UserID:             d.UserID,
		FileURL:            d.FileURL,
		OriginalFilename:   d.OriginalFilename,
		ContentType:        d.ContentType,
		SizeBytes:          d.SizeBytes,
		DocumentType:       d.DocumentType,
		ExpiresAt:          d.ExpiresAt,
		VerificationStatus: d.VerificationStatus,
		UploadedBy:         d.UploadedBy,
		CreatedAt:          d.CreatedAt,
	}
}

func ToDocumentResponseList(docs []UserDocument) []UserDocumentResponse {
	out := make([]UserDocumentResponse, len(docs))
	for i := range docs {
		out[i] = ToDocumentResponse(&docs[i])
	}
	return out
}

func ToHistoryResponse(h *UserHistory) UserHistoryResponse {
	return UserHistoryResponse{
		ID:        h.ID,
		UserID:    h.UserID,
		FieldName: h.FieldName,
		OldValue:  h.OldValue,
		NewValue:  h.NewValue,
		ChangedBy: h.ChangedBy,
		CreatedAt: h.CreatedAt,
	}
}

func ToHistoryResponseList(history []UserHistory) []UserHistoryResponse {
	out := make([]UserHistoryResponse, len(history))
	for i := range history {
		out[i] = ToHistoryResponse(&history[i])
	}
	return out
}
