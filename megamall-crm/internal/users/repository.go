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
	if filter.Search != "" {
		search := "%" + strings.ToLower(filter.Search) + "%"
		query = query.Where("LOWER(full_name) LIKE ? OR phone LIKE ?", search, search)
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

func isDuplicateKeyError(err error, constraint string) bool {
	return err != nil && strings.Contains(err.Error(), constraint)
}
