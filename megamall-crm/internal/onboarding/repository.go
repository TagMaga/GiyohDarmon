package onboarding

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Repository handles all worker_application persistence.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, a *WorkerApplication) error {
	result := r.db.WithContext(ctx).Create(a)
	if result.Error != nil {
		if isDuplicateKeyError(result.Error, "uq_worker_applications_phone_pending") {
			return fmt.Errorf("phone already has a pending application")
		}
		return fmt.Errorf("create worker application: %w", result.Error)
	}
	return nil
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*WorkerApplication, error) {
	var a WorkerApplication
	result := r.db.WithContext(ctx).Where("id = ?", id).First(&a)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get worker application by id: %w", result.Error)
	}
	return &a, nil
}

// List returns applications matching status, newest first. status == "" lists all.
func (r *Repository) List(ctx context.Context, status Status) ([]WorkerApplication, error) {
	query := r.db.WithContext(ctx).Model(&WorkerApplication{}).Order("created_at DESC")
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var list []WorkerApplication
	if err := query.Find(&list).Error; err != nil {
		return nil, fmt.Errorf("list worker applications: %w", err)
	}
	return list, nil
}

// MarkApproved transitions a pending application to approved, recording who
// reviewed it and the resulting user — and clears password_hash, which has
// now served its only purpose (see Service.Approve) and should not linger.
func (r *Repository) MarkApproved(ctx context.Context, id uuid.UUID, reviewerID uuid.UUID, createdUserID uuid.UUID) error {
	now := time.Now().UTC()
	result := r.db.WithContext(ctx).Model(&WorkerApplication{}).
		Where("id = ? AND status = ?", id, StatusPending).
		Updates(map[string]interface{}{
			"status":          StatusApproved,
			"reviewed_by":     reviewerID,
			"reviewed_at":     now,
			"created_user_id": createdUserID,
			"password_hash":   "",
			"updated_at":      now,
		})
	if result.Error != nil {
		return fmt.Errorf("mark worker application approved: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("worker application not pending")
	}
	return nil
}

// Delete hard-deletes an application (used for rejection — a rejected
// application is discarded entirely rather than kept in a terminal state).
func (r *Repository) Delete(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).Where("id = ? AND status = ?", id, StatusPending).Delete(&WorkerApplication{})
	if result.Error != nil {
		return fmt.Errorf("delete worker application: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("worker application not pending")
	}
	return nil
}

// CreateDocuments inserts all of an application's document rows in one call
// — used right after the application row itself is created (see
// Service.Create).
func (r *Repository) CreateDocuments(ctx context.Context, docs []WorkerApplicationDocument) error {
	if len(docs) == 0 {
		return nil
	}
	if err := r.db.WithContext(ctx).Create(&docs).Error; err != nil {
		return fmt.Errorf("create worker application documents: %w", err)
	}
	return nil
}

// ListDocuments returns applicationID's attached documents, oldest first.
func (r *Repository) ListDocuments(ctx context.Context, applicationID uuid.UUID) ([]WorkerApplicationDocument, error) {
	var docs []WorkerApplicationDocument
	if err := r.db.WithContext(ctx).
		Where("application_id = ?", applicationID).
		Order("created_at ASC").
		Find(&docs).Error; err != nil {
		return nil, fmt.Errorf("list worker application documents: %w", err)
	}
	return docs, nil
}

func isDuplicateKeyError(err error, constraint string) bool {
	return err != nil && strings.Contains(err.Error(), constraint)
}
