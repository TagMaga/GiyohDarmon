package teams

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
)

// UserExistsFn is an injected dependency to check user existence across module boundary.
type UserExistsFn func(ctx context.Context, id uuid.UUID) (bool, error)

// HierarchyAssignFn upserts userID's hierarchy team_id, leaving any existing
// parent assignment untouched. Injected after construction via
// SetHierarchyAssigner rather than passed to NewService — hierarchy.Service
// is built after teams.Service in main.go and itself depends on teams
// (TeamExistsFn/TeamBriefFn), so the two modules can't construct each other
// directly; mirrors internal/users' SetSessionRevoker/SetMediaAdapters
// post-construction wiring.
type HierarchyAssignFn func(ctx context.Context, userID uuid.UUID, teamID uuid.UUID) error

type Service struct {
	repo            *Repository
	userExists      UserExistsFn
	assignHierarchy HierarchyAssignFn
}

func NewService(repo *Repository, userExists UserExistsFn) *Service {
	return &Service{repo: repo, userExists: userExists}
}

// SetHierarchyAssigner injects the hierarchy sync hook. Left nil in tests
// that don't care about hierarchy sync — Create/Update skip it in that case.
func (s *Service) SetHierarchyAssigner(fn HierarchyAssignFn) {
	s.assignHierarchy = fn
}

// syncHierarchy keeps user_hierarchy in step with t's manager_id/
// team_lead_id. Team rosters (TeamProfilePage's member counts), the "my
// team" self-service lookups, and cross-module RBAC scoping (e.g.
// users.Service.List's per-caller team scope) all read user_hierarchy, not
// these two columns — CreateTeamModal/EditTeamModal only ever write the
// columns, so without this a manager/lead assigned through either dialog
// would show a correct team but an empty roster, and would themselves be
// scoped to zero users everywhere else in the app.
func (s *Service) syncHierarchy(ctx context.Context, t *Team) error {
	if s.assignHierarchy == nil {
		return nil
	}
	if t.TeamLeadID != nil {
		if err := s.assignHierarchy(ctx, *t.TeamLeadID, t.ID); err != nil {
			return apperrors.Internal(fmt.Errorf("sync team lead hierarchy: %w", err))
		}
	}
	if t.ManagerID != nil {
		if err := s.assignHierarchy(ctx, *t.ManagerID, t.ID); err != nil {
			return apperrors.Internal(fmt.Errorf("sync manager hierarchy: %w", err))
		}
	}
	return nil
}

func (s *Service) Create(ctx context.Context, req CreateTeamRequest) (*Team, error) {
	if err := s.validateUserRefs(ctx, req.TeamLeadID, req.ManagerID); err != nil {
		return nil, err
	}

	t := &Team{
		ID:         uuid.New(),
		Name:       req.Name,
		TeamLeadID: req.TeamLeadID,
		ManagerID:  req.ManagerID,
		IsActive:   true,
	}

	if err := s.repo.Create(ctx, t); err != nil {
		if strings.Contains(err.Error(), "team name already exists") {
			return nil, apperrors.Conflict("team name is already taken")
		}
		return nil, apperrors.Internal(err)
	}

	if err := s.syncHierarchy(ctx, t); err != nil {
		return nil, err
	}

	return t, nil
}

// GetByID returns a team by ID, scoped to what actorRole may see: owner sees
// any team; manager only a team they manage; sales_team_lead only the team
// they lead. Cross-scope access reports NotFound rather than Forbidden, so a
// caller can't distinguish "doesn't exist" from "not yours".
func (s *Service) GetByID(ctx context.Context, actorID uuid.UUID, actorRole string, id uuid.UUID) (*Team, error) {
	t, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if t == nil || !canAccessTeam(t, actorID, actorRole) {
		return nil, apperrors.NotFound("team")
	}
	return t, nil
}

// List returns teams matching filter, scoped to what actorRole may see (see
// GetByID for the scoping rules). The scoping is applied in the repository
// query itself so pagination totals reflect only visible rows.
func (s *Service) List(ctx context.Context, actorID uuid.UUID, actorRole string, filter ListTeamsFilter, p pagination.Params) ([]Team, int, error) {
	list, total, err := s.repo.List(ctx, filter, actorID, actorRole, p)
	if err != nil {
		return nil, 0, apperrors.Internal(err)
	}
	return list, total, nil
}

// canAccessTeam reports whether actorRole/actorID may view team t.
func canAccessTeam(t *Team, actorID uuid.UUID, actorRole string) bool {
	switch actorRole {
	case "owner":
		return true
	case "manager":
		return t.ManagerID != nil && *t.ManagerID == actorID
	case "sales_team_lead":
		return t.TeamLeadID != nil && *t.TeamLeadID == actorID
	default:
		return false
	}
}

func (s *Service) Update(ctx context.Context, id uuid.UUID, req UpdateTeamRequest) (*Team, error) {
	t, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if t == nil {
		return nil, apperrors.NotFound("team")
	}

	if err := s.validateUserRefs(ctx, req.TeamLeadID, req.ManagerID); err != nil {
		return nil, err
	}

	if req.Name != nil {
		t.Name = *req.Name
	}
	if req.TeamLeadID != nil {
		t.TeamLeadID = req.TeamLeadID
	}
	if req.ManagerID != nil {
		t.ManagerID = req.ManagerID
	}
	if req.IsActive != nil {
		t.IsActive = *req.IsActive
	}
	t.UpdatedAt = time.Now().UTC()

	if err := s.repo.Update(ctx, t); err != nil {
		if strings.Contains(err.Error(), "team name already exists") {
			return nil, apperrors.Conflict("team name is already taken")
		}
		return nil, apperrors.Internal(err)
	}

	if err := s.syncHierarchy(ctx, t); err != nil {
		return nil, err
	}

	return t, nil
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		if err.Error() == "team not found" {
			return apperrors.NotFound("team")
		}
		return apperrors.Internal(err)
	}
	return nil
}

func (s *Service) validateUserRefs(ctx context.Context, ids ...*uuid.UUID) error {
	for _, id := range ids {
		if id == nil {
			continue
		}
		exists, err := s.userExists(ctx, *id)
		if err != nil {
			return apperrors.Internal(fmt.Errorf("validate user ref: %w", err))
		}
		if !exists {
			return apperrors.NotFound(fmt.Sprintf("user %s", *id))
		}
	}
	return nil
}
