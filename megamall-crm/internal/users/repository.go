package users

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// Repository handles all user persistence.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, u *User) error {
	result := r.db.WithContext(ctx).Create(u)
	if result.Error != nil {
		if isDuplicateKeyError(result.Error, "uq_users_phone") {
			return fmt.Errorf("phone already registered")
		}
		if isDuplicateKeyError(result.Error, "uq_users_email") {
			return fmt.Errorf("email already registered")
		}
		return fmt.Errorf("create user: %w", result.Error)
	}
	return nil
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*User, error) {
	var u User
	result := r.db.WithContext(ctx).
		Where("id = ? AND deleted_at IS NULL", id).
		First(&u)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get user by id: %w", result.Error)
	}
	return &u, nil
}

func (r *Repository) GetByPhone(ctx context.Context, phone string) (*User, error) {
	var u User
	result := r.db.WithContext(ctx).
		Where("phone = ? AND deleted_at IS NULL", phone).
		First(&u)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get user by phone: %w", result.Error)
	}
	return &u, nil
}

func (r *Repository) List(ctx context.Context, filter ListUsersFilter, p pagination.Params) ([]User, int, error) {
	query := r.db.WithContext(ctx).Model(&User{}).Where("deleted_at IS NULL")

	if filter.Role != nil {
		query = query.Where("role = ?", *filter.Role)
	}
	if filter.IsActive != nil {
		query = query.Where("is_active = ?", *filter.IsActive)
	}
	if filter.Status != nil {
		query = query.Where("status = ?", *filter.Status)
	}
	if filter.Search != "" {
		search := "%" + strings.ToLower(filter.Search) + "%"
		query = query.Where("LOWER(full_name) LIKE ? OR phone LIKE ?", search, search)
	}
	if len(filter.IDs) > 0 {
		query = query.Where("id IN ?", filter.IDs)
	}
	if filter.TeamID != nil {
		query = query.Where("id IN (SELECT user_id FROM user_hierarchy WHERE team_id = ?)", *filter.TeamID)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count users: %w", err)
	}

	var list []User
	if err := query.
		Order("created_at DESC").
		Limit(p.Limit).
		Offset(p.Offset()).
		Find(&list).Error; err != nil {
		return nil, 0, fmt.Errorf("list users: %w", err)
	}

	return list, int(total), nil
}

func (r *Repository) Update(ctx context.Context, u *User) error {
	result := r.db.WithContext(ctx).
		Model(u).
		Where("deleted_at IS NULL").
		Updates(u)
	if result.Error != nil {
		if isDuplicateKeyError(result.Error, "uq_users_phone") {
			return fmt.Errorf("phone already registered")
		}
		if isDuplicateKeyError(result.Error, "uq_users_email") {
			return fmt.Errorf("email already registered")
		}
		return fmt.Errorf("update user: %w", result.Error)
	}
	return nil
}

// UpdatePassword updates only the password_hash field.
func (r *Repository) UpdatePassword(ctx context.Context, id uuid.UUID, hash string) error {
	result := r.db.WithContext(ctx).
		Model(&User{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Update("password_hash", hash)
	if result.Error != nil {
		return fmt.Errorf("update password: %w", result.Error)
	}
	return nil
}

// SoftDelete sets deleted_at on the user.
func (r *Repository) SoftDelete(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Model(&User{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Update("deleted_at", gorm.Expr("NOW()"))
	if result.Error != nil {
		return fmt.Errorf("soft delete user: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}

// ExistsByID checks if an active user with the given ID exists.
func (r *Repository) ExistsByID(ctx context.Context, id uuid.UUID) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&User{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("exists check: %w", err)
	}
	return count > 0, nil
}

// GetByIDs returns all active users whose IDs are in the given set.
func (r *Repository) GetByIDs(ctx context.Context, ids []uuid.UUID) ([]User, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var list []User
	err := r.db.WithContext(ctx).
		Where("id IN ? AND deleted_at IS NULL", ids).
		Find(&list).Error
	if err != nil {
		return nil, fmt.Errorf("get users by ids: %w", err)
	}
	return list, nil
}

// GetTeamIDForUser returns the hierarchy team_id for a user, or nil if the
// user has no hierarchy entry or no team assigned.
func (r *Repository) GetTeamIDForUser(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error) {
	var uh struct {
		TeamID *uuid.UUID
	}
	err := r.db.WithContext(ctx).
		Table("user_hierarchy").
		Select("team_id").
		Where("user_id = ?", userID).
		Take(&uh).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get team id for user: %w", err)
	}
	return uh.TeamID, nil
}

// ShareTeam reports whether two active users belong to the same hierarchy team.
func (r *Repository) ShareTeam(ctx context.Context, a uuid.UUID, b uuid.UUID) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Table("user_hierarchy AS uh1").
		Joins("JOIN user_hierarchy AS uh2 ON uh1.team_id = uh2.team_id").
		Joins("JOIN users AS u1 ON u1.id = uh1.user_id AND u1.deleted_at IS NULL").
		Joins("JOIN users AS u2 ON u2.id = uh2.user_id AND u2.deleted_at IS NULL").
		Where("uh1.user_id = ? AND uh2.user_id = ? AND uh1.team_id IS NOT NULL", a, b).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("share team check: %w", err)
	}
	return count > 0, nil
}

func isDuplicateKeyError(err error, constraint string) bool {
	return err != nil && strings.Contains(err.Error(), constraint)
}
