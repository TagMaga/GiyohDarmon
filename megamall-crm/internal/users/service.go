package users

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// Service encapsulates all user business logic.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Create(ctx context.Context, req CreateUserRequest) (*User, error) {
	if !req.Role.IsValid() {
		return nil, apperrors.BadRequest(fmt.Sprintf("invalid role: %s", req.Role))
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("hash password: %w", err))
	}

	u := &User{
		ID:           uuid.New(),
		Phone:        req.Phone,
		Email:        req.Email,
		PasswordHash: string(hash),
		FullName:     req.FullName,
		Role:         req.Role,
		IsActive:     true,
		Status:       StatusOffline,
		HireDate:     req.HireDate,
		DateOfBirth:  req.DateOfBirth,
		Address:      req.Address,
	}

	if err := s.repo.Create(ctx, u); err != nil {
		if strings.Contains(err.Error(), "phone already registered") {
			return nil, apperrors.Conflict("phone number is already registered")
		}
		if strings.Contains(err.Error(), "email already registered") {
			return nil, apperrors.Conflict("email address is already registered")
		}
		return nil, apperrors.Internal(err)
	}

	return u, nil
}

func (s *Service) GetByID(ctx context.Context, id uuid.UUID) (*User, error) {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}
	return u, nil
}

func (s *Service) CanViewUser(ctx context.Context, actorID uuid.UUID, actorRole string, targetID uuid.UUID) (bool, error) {
	if actorID == targetID || actorRole == string(RoleOwner) {
		return true, nil
	}

	if actorRole != string(RoleManager) && actorRole != string(RoleSalesTeamLead) {
		return false, nil
	}

	ok, err := s.repo.ShareTeam(ctx, actorID, targetID)
	if err != nil {
		return false, apperrors.Internal(err)
	}
	return ok, nil
}

// List returns users matching filter. Non-owner callers (manager, sales_team_lead)
// are scoped to their own hierarchy team — they can never list users outside it.
func (s *Service) List(ctx context.Context, actorID uuid.UUID, actorRole string, filter ListUsersFilter, p pagination.Params) ([]User, int, error) {
	if actorRole != string(RoleOwner) {
		teamID, err := s.repo.GetTeamIDForUser(ctx, actorID)
		if err != nil {
			return nil, 0, apperrors.Internal(err)
		}
		if teamID == nil {
			return []User{}, 0, nil
		}
		filter.TeamID = teamID
	}

	list, total, err := s.repo.List(ctx, filter, p)
	if err != nil {
		return nil, 0, apperrors.Internal(err)
	}
	return list, total, nil
}

func (s *Service) Update(ctx context.Context, id uuid.UUID, req UpdateUserRequest) (*User, error) {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}

	if req.Phone != nil {
		u.Phone = *req.Phone
	}
	if req.FullName != nil {
		u.FullName = *req.FullName
	}
	if req.Role != nil {
		if !req.Role.IsValid() {
			return nil, apperrors.BadRequest(fmt.Sprintf("invalid role: %s", *req.Role))
		}
		u.Role = *req.Role
	}
	if req.IsActive != nil {
		u.IsActive = *req.IsActive
	}
	if req.AvatarURL != nil {
		u.AvatarURL = req.AvatarURL
	}
	if req.Status != nil {
		if !req.Status.IsValid() {
			return nil, apperrors.BadRequest(fmt.Sprintf("invalid status: %s", *req.Status))
		}
		u.Status = *req.Status
	}
	if req.HireDate != nil {
		u.HireDate = req.HireDate
	}
	if req.DateOfBirth != nil {
		u.DateOfBirth = req.DateOfBirth
	}
	if req.Address != nil {
		u.Address = req.Address
	}
	u.UpdatedAt = time.Now().UTC()

	if err := s.repo.Update(ctx, u); err != nil {
		if strings.Contains(err.Error(), "phone already registered") {
			return nil, apperrors.Conflict("phone number is already registered")
		}
		if strings.Contains(err.Error(), "email already registered") {
			return nil, apperrors.Conflict("email address is already registered")
		}
		return nil, apperrors.Internal(err)
	}

	return u, nil
}

// PatchMe updates only the fields a user is allowed to edit for themselves.
func (s *Service) PatchMe(ctx context.Context, id uuid.UUID, req PatchMeRequest) (*User, error) {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}
	if req.TelegramChatID != nil {
		u.TelegramChatID = req.TelegramChatID
	}
	u.UpdatedAt = time.Now().UTC()
	if err := s.repo.Update(ctx, u); err != nil {
		return nil, apperrors.Internal(err)
	}
	return u, nil
}

func (s *Service) ChangePassword(ctx context.Context, id uuid.UUID, req ChangePasswordRequest) error {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return apperrors.Internal(err)
	}
	if u == nil {
		return apperrors.NotFound("user")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		return &apperrors.AppError{
			Code:       apperrors.CodeInvalidPassword,
			StatusCode: 400,
			Message:    "current password is incorrect",
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcryptCost)
	if err != nil {
		return apperrors.Internal(fmt.Errorf("hash password: %w", err))
	}

	if err := s.repo.UpdatePassword(ctx, id, string(hash)); err != nil {
		return apperrors.Internal(err)
	}

	return nil
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		if err.Error() == "user not found" {
			return apperrors.NotFound("user")
		}
		return apperrors.Internal(err)
	}
	return nil
}
