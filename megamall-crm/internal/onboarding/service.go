package onboarding

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// Service encapsulates worker-application business logic. It depends on
// users.Service directly (not a narrow injected function) because approval
// reuses real create-user business logic — uniqueness checks, defaults,
// history — not just an existence lookup. See CLAUDE.md's cross-module
// dependency convention.
type Service struct {
	repo    *Repository
	userSvc *users.Service
}

func NewService(repo *Repository, userSvc *users.Service) *Service {
	return &Service{repo: repo, userSvc: userSvc}
}

// Create handles a public, unauthenticated submission from /new. The
// applicant's chosen password is hashed and stored now — never re-collected
// later — so approval can promote it into a real login as-is.
func (s *Service) Create(ctx context.Context, req CreateApplicationRequest) (*WorkerApplication, error) {
	exists, err := s.userSvc.PhoneExists(ctx, req.Phone)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, apperrors.Conflict("phone number is already registered")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	a := &WorkerApplication{
		ID:              uuid.New(),
		Phone:           req.Phone,
		Email:           req.Email,
		PasswordHash:    string(hash),
		FullName:        req.FullName,
		Surname:         req.Surname,
		DesiredPosition: req.DesiredPosition,
		DateOfBirth:     req.DateOfBirth,
		Address:         req.Address,
		Status:          StatusPending,
	}

	if err := s.repo.Create(ctx, a); err != nil {
		if strings.Contains(err.Error(), "pending application") {
			return nil, apperrors.Conflict("this phone number already has a pending application")
		}
		return nil, apperrors.Internal(err)
	}

	return a, nil
}

func (s *Service) List(ctx context.Context, status Status) ([]WorkerApplication, error) {
	list, err := s.repo.List(ctx, status)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return list, nil
}

func (s *Service) GetByID(ctx context.Context, id uuid.UUID) (*WorkerApplication, error) {
	a, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if a == nil {
		return nil, apperrors.NotFound("worker application")
	}
	return a, nil
}

// Approve promotes a pending application into a real users row, reusing the
// password hash the applicant already set at submission time (see Create),
// and the role the reviewing owner chose — never a role the applicant
// self-selected.
func (s *Service) Approve(ctx context.Context, id uuid.UUID, reviewerID uuid.UUID, role users.Role) (*users.User, error) {
	if role == users.RoleOwner {
		return nil, apperrors.BadRequest("cannot assign the owner role through worker onboarding")
	}

	a, err := s.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.Status != StatusPending {
		return nil, apperrors.Conflict("application is not pending")
	}

	u, err := s.userSvc.CreateWithPasswordHash(ctx, users.CreateUserWithHashRequest{
		Phone:        a.Phone,
		Email:        a.Email,
		PasswordHash: a.PasswordHash,
		FullName:     a.FullName,
		Surname:      a.Surname,
		Position:     a.DesiredPosition,
		Role:         role,
		HireDate:     timePtr(time.Now().UTC()),
		DateOfBirth:  a.DateOfBirth,
		Address:      a.Address,
	})
	if err != nil {
		return nil, err
	}

	if err := s.repo.MarkApproved(ctx, id, reviewerID, u.ID); err != nil {
		return nil, apperrors.Internal(err)
	}

	return u, nil
}

// Reject discards a pending application outright — there is no "rejected"
// terminal state to keep around, the row is simply deleted so the applicant
// (and their phone number) can freely re-apply later.
func (s *Service) Reject(ctx context.Context, id uuid.UUID) error {
	a, err := s.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if a.Status != StatusPending {
		return apperrors.Conflict("application is not pending")
	}
	if err := s.repo.Delete(ctx, id); err != nil {
		return apperrors.Internal(err)
	}
	return nil
}

func timePtr(t time.Time) *time.Time { return &t }
