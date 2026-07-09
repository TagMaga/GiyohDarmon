package hierarchy

import (
	"context"
	"fmt"
	"sort"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/rbac"
)

// ExistsFn is an injected check for whether a user or team exists.
type UserExistsFn func(ctx context.Context, id uuid.UUID) (bool, error)
type TeamExistsFn func(ctx context.Context, id uuid.UUID) (bool, error)

// UserBriefsFn resolves minimal user cards for a set of user IDs.
type UserBriefsFn func(ctx context.Context, ids []uuid.UUID) ([]UserBrief, error)

// TeamBriefFn resolves a team's name and leadership IDs; nil when not found.
type TeamBriefFn func(ctx context.Context, id uuid.UUID) (*TeamBrief, error)

type Service struct {
	repo       *Repository
	userExists UserExistsFn
	teamExists TeamExistsFn
	userBriefs UserBriefsFn
	teamBrief  TeamBriefFn
}

func NewService(repo *Repository, userExists UserExistsFn, teamExists TeamExistsFn, userBriefs UserBriefsFn, teamBrief TeamBriefFn) *Service {
	return &Service{repo: repo, userExists: userExists, teamExists: teamExists, userBriefs: userBriefs, teamBrief: teamBrief}
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

// GetUserChain returns the upward chain for a user, scoped to what
// actorRole/actorID may see: owner sees anyone; a caller can always see their
// own chain; otherwise manager/sales_team_lead may only see users within a
// team they manage/lead. Cross-scope access reports NotFound rather than
// Forbidden, so a caller can't distinguish "doesn't exist" from "not yours".
func (s *Service) GetUserChain(ctx context.Context, actorID uuid.UUID, actorRole string, userID uuid.UUID) ([]HierarchyResponse, error) {
	if !rbac.IsOwnerLevel(actorRole) && actorID != userID {
		allowed, err := s.canAccessUser(ctx, actorID, actorRole, userID)
		if err != nil {
			return nil, apperrors.Internal(err)
		}
		if !allowed {
			return nil, apperrors.NotFound("user")
		}
	}

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

// GetMyTeam returns the roster of the caller's own team: leadership plus
// members, resolved to user cards. Leadership is excluded from members even
// when they also have a hierarchy entry in the team.
func (s *Service) GetMyTeam(ctx context.Context, teamID uuid.UUID) (*MyTeamResponse, error) {
	team, err := s.teamBrief(ctx, teamID)
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("resolve team: %w", err))
	}
	if team == nil {
		return nil, apperrors.NotFound("team")
	}

	entries, err := s.repo.GetByTeamID(ctx, teamID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	ids := make([]uuid.UUID, 0, len(entries)+2)
	for _, e := range entries {
		ids = append(ids, e.UserID)
	}
	if team.TeamLeadID != nil {
		ids = append(ids, *team.TeamLeadID)
	}
	if team.ManagerID != nil {
		ids = append(ids, *team.ManagerID)
	}

	briefs, err := s.userBriefs(ctx, ids)
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("resolve team users: %w", err))
	}
	byID := make(map[uuid.UUID]UserBrief, len(briefs))
	for _, b := range briefs {
		byID[b.ID] = b
	}

	resp := &MyTeamResponse{
		TeamID:   team.ID,
		TeamName: team.Name,
		Members:  make([]UserBrief, 0, len(entries)),
	}
	if team.TeamLeadID != nil {
		if b, ok := byID[*team.TeamLeadID]; ok {
			resp.TeamLead = &b
		}
	}
	if team.ManagerID != nil {
		if b, ok := byID[*team.ManagerID]; ok {
			resp.Manager = &b
		}
	}
	for _, e := range entries {
		if team.TeamLeadID != nil && e.UserID == *team.TeamLeadID {
			continue
		}
		if team.ManagerID != nil && e.UserID == *team.ManagerID {
			continue
		}
		if b, ok := byID[e.UserID]; ok {
			resp.Members = append(resp.Members, b)
		}
	}
	sort.Slice(resp.Members, func(i, j int) bool {
		return resp.Members[i].FullName < resp.Members[j].FullName
	})

	return resp, nil
}

// GetTeamMembers returns all hierarchy entries for a team, scoped to what
// actorRole/actorID may see (see GetUserChain for the scoping rules).
// Existence is checked for every role, including owner — teamBrief already
// excludes soft-deleted teams (teams.Repository.GetByID filters deleted_at),
// so a deleted team's roster is never reachable through this endpoint even
// if stale user_hierarchy rows still reference its id.
func (s *Service) GetTeamMembers(ctx context.Context, actorID uuid.UUID, actorRole string, teamID uuid.UUID) ([]HierarchyResponse, error) {
	team, err := s.teamBrief(ctx, teamID)
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("resolve team: %w", err))
	}
	if team == nil || !canAccessTeamBrief(team, actorID, actorRole) {
		return nil, apperrors.NotFound("team")
	}

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

// canAccessTeamBrief reports whether actorRole/actorID may view team's
// roster: owner always; manager only for a team they manage; sales_team_lead
// only for the team they lead. Any other role is denied.
func canAccessTeamBrief(team *TeamBrief, actorID uuid.UUID, actorRole string) bool {
	switch actorRole {
	case "owner":
		return true
	case "manager":
		return team.ManagerID != nil && *team.ManagerID == actorID
	case "sales_team_lead":
		return team.TeamLeadID != nil && *team.TeamLeadID == actorID
	default:
		return false
	}
}

// canAccessUser reports whether actorRole/actorID may view userID's
// hierarchy chain: allowed when userID belongs to a team actorID may access
// (see canAccessTeamBrief). A user with no assigned team is only visible to
// owner (handled by the caller, which skips this check entirely for owner).
func (s *Service) canAccessUser(ctx context.Context, actorID uuid.UUID, actorRole string, userID uuid.UUID) (bool, error) {
	h, err := s.repo.GetByUserID(ctx, userID)
	if err != nil {
		return false, fmt.Errorf("resolve target hierarchy: %w", err)
	}
	if h == nil || h.TeamID == nil {
		return false, nil
	}
	team, err := s.teamBrief(ctx, *h.TeamID)
	if err != nil {
		return false, fmt.Errorf("resolve team: %w", err)
	}
	if team == nil {
		return false, nil
	}
	return canAccessTeamBrief(team, actorID, actorRole), nil
}
