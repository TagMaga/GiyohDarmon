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
	IDs      []uuid.UUID `form:"-"`       // parsed manually from repeated ids[] query params
	TeamID   *uuid.UUID  `form:"-"`       // set internally to scope non-owner callers to their own team
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
	TelegramChatID *string `json:"telegram_chat_id" validate:"omitempty,max=100"`
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
