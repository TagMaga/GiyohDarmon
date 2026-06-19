package teams

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, t *Team) error {
	if err := r.db.WithContext(ctx).Create(t).Error; err != nil {
		if strings.Contains(err.Error(), "uq_teams_name") {
			return fmt.Errorf("team name already exists")
		}
		return fmt.Errorf("create team: %w", err)
	}
	return nil
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*Team, error) {
	var t Team
	err := r.db.WithContext(ctx).
		Where("id = ? AND deleted_at IS NULL", id).
		First(&t).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get team by id: %w", err)
	}
	return &t, nil
}

func (r *Repository) List(ctx context.Context, filter ListTeamsFilter, p pagination.Params) ([]Team, int, error) {
	query := r.db.WithContext(ctx).Model(&Team{}).Where("deleted_at IS NULL")

	if filter.IsActive != nil {
		query = query.Where("is_active = ?", *filter.IsActive)
	}
	if filter.Search != "" {
		search := "%" + strings.ToLower(filter.Search) + "%"
		query = query.Where("LOWER(name) LIKE ?", search)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count teams: %w", err)
	}

	var list []Team
	if err := query.
		Order("created_at DESC").
		Limit(p.Limit).
		Offset(p.Offset()).
		Find(&list).Error; err != nil {
		return nil, 0, fmt.Errorf("list teams: %w", err)
	}

	return list, int(total), nil
}

func (r *Repository) Update(ctx context.Context, t *Team) error {
	if err := r.db.WithContext(ctx).Model(t).Where("deleted_at IS NULL").Updates(t).Error; err != nil {
		if strings.Contains(err.Error(), "uq_teams_name") {
			return fmt.Errorf("team name already exists")
		}
		return fmt.Errorf("update team: %w", err)
	}
	return nil
}

func (r *Repository) SoftDelete(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Model(&Team{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Update("deleted_at", gorm.Expr("NOW()"))
	if result.Error != nil {
		return fmt.Errorf("soft delete team: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("team not found")
	}
	return nil
}
