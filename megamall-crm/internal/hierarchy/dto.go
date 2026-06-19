package hierarchy

import (
	"time"

	"github.com/google/uuid"
)

// AssignRequest sets or updates a user's team and parent.
type AssignRequest struct {
	UserID   uuid.UUID  `json:"user_id"  validate:"required,uuid4"`
	ParentID *uuid.UUID `json:"parent_id" validate:"omitempty,uuid4"`
	TeamID   *uuid.UUID `json:"team_id"   validate:"omitempty,uuid4"`
}

// HierarchyResponse is the API response for a single hierarchy entry.
type HierarchyResponse struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"user_id"`
	ParentID  *uuid.UUID `json:"parent_id"`
	TeamID    *uuid.UUID `json:"team_id"`
	CreatedAt time.Time  `json:"created_at"`
}

// MemberResponse represents a team member with their hierarchy info.
type MemberResponse struct {
	UserID    uuid.UUID  `json:"user_id"`
	ParentID  *uuid.UUID `json:"parent_id"`
	TeamID    *uuid.UUID `json:"team_id"`
	CreatedAt time.Time  `json:"created_at"`
}

// ChainResponse is the upward chain from a user to the root.
type ChainResponse struct {
	Chain []HierarchyResponse `json:"chain"`
}

func toResponse(h *UserHierarchy) HierarchyResponse {
	return HierarchyResponse{
		ID:        h.ID,
		UserID:    h.UserID,
		ParentID:  h.ParentID,
		TeamID:    h.TeamID,
		CreatedAt: h.CreatedAt,
	}
}
