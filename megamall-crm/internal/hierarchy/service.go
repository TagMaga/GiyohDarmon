package hierarchy

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
)

// ExistsFn is an injected check for whether a user or team exists.
type UserExistsFn func(ctx context.Context, id uuid.UUID) (bool, error)
type TeamExistsFn func(ctx context.Context, id uuid.UUID) (bool, error)

type Service struct {
	repo       *Repository
	userExists UserExistsFn
	teamExists TeamExistsFn
}

func NewService(repo *Repository, userExists UserExistsFn, teamExists TeamExistsFn) *Service {
	return &Service{repo: repo, userExists: userExists, teamExists: teamExists}
}

// Assign sets or updates a user's team and/or parent.
func (s *Service) Assign(ctx context.Context, req AssignRequest) (*UserHierarchy, error) {
	// Validate user exists.
	exists, err := s.userExists(ctx, req.UserID)
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("validate user: %w", err))
	}
	if !exists {
		return nil, apperrors.NotFound(fmt.Sprintf("user %s", req.UserID))
	}

	// Validate parent exists.
	if req.ParentID != nil {
		if *req.ParentID == req.UserID {
			return nil, apperrors.BadRequest("a user cannot be their own parent")
		}
		exists, err := s.userExists(ctx, *req.ParentID)
		if err != nil {
			return nil, apperrors.Internal(fmt.Errorf("validate parent: %w", err))
		}
		if !exists {
			return nil, apperrors.NotFound(fmt.Sprintf("parent user %s", *req.ParentID))
		}
		// Prevent circular references.
		cycle, err := s.repo.WouldCreateCycle(ctx, req.UserID, *req.ParentID)
		if err != nil {
			return nil, apperrors.Internal(err)
		}
		if cycle {
			return nil, apperrors.BadRequest("assigning this parent would create a circular hierarchy")
		}
	}

	// Validate team exists.
	if req.TeamID != nil {
		exists, err := s.teamExists(ctx, *req.TeamID)
		if err != nil {
			return nil, apperrors.Internal(fmt.Errorf("validate team: %w", err))
		}
		if !exists {
			return nil, apperrors.NotFound(fmt.Sprintf("team %s", *req.TeamID))
		}
	}

	h := &UserHierarchy{
		ID:       uuid.New(),
		UserID:   req.UserID,
		ParentID: req.ParentID,
		TeamID:   req.TeamID,
	}

	if err := s.repo.Upsert(ctx, h); err != nil {
		return nil, apperrors.Internal(err)
	}

	return h, nil
}

// GetUserChain returns the upward chain for a user.
func (s *Service) GetUserChain(ctx context.Context, userID uuid.UUID) ([]HierarchyResponse, error) {
	chain, err := s.repo.GetChainUpward(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	out := make([]HierarchyResponse, len(chain))
	for i, h := range chain {
		out[i] = toResponse(&h)
	}
	return out, nil
}

// GetTeamMembers returns all hierarchy entries for a team.
func (s *Service) GetTeamMembers(ctx context.Context, teamID uuid.UUID) ([]HierarchyResponse, error) {
	entries, err := s.repo.GetByTeamID(ctx, teamID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	out := make([]HierarchyResponse, len(entries))
	for i, h := range entries {
		out[i] = toResponse(&h)
	}
	return out, nil
}
