package teams

import (
	"time"

	"github.com/google/uuid"
)

type CreateTeamRequest struct {
	Name       string     `json:"name"         validate:"required,min=2,max=255"`
	TeamLeadID *uuid.UUID `json:"team_lead_id" validate:"omitempty,uuid4"`
	ManagerID  *uuid.UUID `json:"manager_id"   validate:"omitempty,uuid4"`
}

type UpdateTeamRequest struct {
	Name       *string    `json:"name"         validate:"omitempty,min=2,max=255"`
	TeamLeadID *uuid.UUID `json:"team_lead_id" validate:"omitempty,uuid4"`
	ManagerID  *uuid.UUID `json:"manager_id"   validate:"omitempty,uuid4"`
	IsActive   *bool      `json:"is_active"`
}

type ListTeamsFilter struct {
	IsActive *bool  `form:"is_active"`
	Search   string `form:"search"`
}

type TeamResponse struct {
	ID         uuid.UUID  `json:"id"`
	Name       string     `json:"name"`
	TeamLeadID *uuid.UUID `json:"team_lead_id"`
	ManagerID  *uuid.UUID `json:"manager_id"`
	IsActive   bool       `json:"is_active"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func ToResponse(t *Team) TeamResponse {
	return TeamResponse{
		ID:         t.ID,
		Name:       t.Name,
		TeamLeadID: t.TeamLeadID,
		ManagerID:  t.ManagerID,
		IsActive:   t.IsActive,
		CreatedAt:  t.CreatedAt,
		UpdatedAt:  t.UpdatedAt,
	}
}

func ToResponseList(teams []Team) []TeamResponse {
	out := make([]TeamResponse, len(teams))
	for i := range teams {
		out[i] = ToResponse(&teams[i])
	}
	return out
}
