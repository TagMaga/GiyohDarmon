package hierarchy

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// Upsert inserts or replaces the hierarchy entry for a user.
// Uses PostgreSQL ON CONFLICT ... DO UPDATE to handle the unique constraint on user_id.
func (r *Repository) Upsert(ctx context.Context, h *UserHierarchy) error {
	err := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"parent_id", "team_id"}),
		}).
		Create(h).Error
	if err != nil {
		return fmt.Errorf("upsert hierarchy: %w", err)
	}
	return nil
}

// GetByUserID returns the hierarchy entry for a user, or nil if none.
func (r *Repository) GetByUserID(ctx context.Context, userID uuid.UUID) (*UserHierarchy, error) {
	var h UserHierarchy
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		First(&h).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get hierarchy by user: %w", err)
	}
	return &h, nil
}

// GetByTeamID returns all hierarchy entries for a given team.
func (r *Repository) GetByTeamID(ctx context.Context, teamID uuid.UUID) ([]UserHierarchy, error) {
	var list []UserHierarchy
	if err := r.db.WithContext(ctx).
		Where("team_id = ?", teamID).
		Find(&list).Error; err != nil {
		return nil, fmt.Errorf("get hierarchy by team: %w", err)
	}
	return list, nil
}

// GetChainUpward traverses from userID upward through parent_id links.
// Returns entries from the user up to the root (no parent). Max depth 10.
func (r *Repository) GetChainUpward(ctx context.Context, userID uuid.UUID) ([]UserHierarchy, error) {
	const maxDepth = 10
	chain := make([]UserHierarchy, 0, maxDepth)
	visited := make(map[uuid.UUID]bool)

	currentID := userID
	for i := 0; i < maxDepth; i++ {
		if visited[currentID] {
			// Circular reference detected — stop.
			break
		}
		visited[currentID] = true

		h, err := r.GetByUserID(ctx, currentID)
		if err != nil {
			return nil, err
		}
		if h == nil {
			break
		}

		chain = append(chain, *h)

		if h.ParentID == nil {
			break
		}
		currentID = *h.ParentID
	}

	return chain, nil
}

// WouldCreateCycle checks if assigning parentID as the parent of userID
// would create a cycle in the hierarchy.
func (r *Repository) WouldCreateCycle(ctx context.Context, userID, parentID uuid.UUID) (bool, error) {
	// Walk up from parentID — if we reach userID, it's a cycle.
	chain, err := r.GetChainUpward(ctx, parentID)
	if err != nil {
		return false, err
	}
	for _, h := range chain {
		if h.UserID == userID {
			return true, nil
		}
	}
	return false, nil
}
