package warehouse

import (
	"context"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
)

// Service encapsulates warehouse business logic.
type Service struct {
	repo   *Repository
	logger *activity.Logger
}

func NewService(repo *Repository, logger *activity.Logger) *Service {
	return &Service{repo: repo, logger: logger}
}

func (s *Service) List(ctx context.Context, p pagination.Params) ([]Warehouse, int, error) {
	return s.repo.List(ctx, p)
}

func (s *Service) GetByID(ctx context.Context, id uuid.UUID) (*Warehouse, error) {
	w, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if w == nil {
		return nil, apperrors.NotFound("warehouse")
	}
	return w, nil
}

func (s *Service) Create(ctx context.Context, actorID uuid.UUID, req CreateWarehouseRequest) (*Warehouse, error) {
	w := &Warehouse{
		ID:       uuid.New(),
		Name:     req.Name,
		Address:  req.Address,
		Notes:    req.Notes,
		IsActive: true,
	}
	if err := s.repo.Create(ctx, w); err != nil {
		return nil, err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:    &actorID,
		Action:     "create",
		EntityType: "warehouse",
		EntityID:   &w.ID,
		AfterState: w,
	})
	return w, nil
}

func (s *Service) Update(ctx context.Context, actorID, id uuid.UUID, req UpdateWarehouseRequest) (*Warehouse, error) {
	w, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if w == nil {
		return nil, apperrors.NotFound("warehouse")
	}
	before := *w

	if req.Name != nil {
		w.Name = *req.Name
	}
	if req.Address != nil {
		w.Address = req.Address
	}
	if req.Notes != nil {
		w.Notes = req.Notes
	}
	if req.IsActive != nil {
		w.IsActive = *req.IsActive
	}

	if err := s.repo.Update(ctx, w); err != nil {
		return nil, err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:     &actorID,
		Action:      "update",
		EntityType:  "warehouse",
		EntityID:    &w.ID,
		BeforeState: before,
		AfterState:  w,
	})
	return w, nil
}

func (s *Service) Delete(ctx context.Context, actorID, id uuid.UUID) error {
	w, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if w == nil {
		return apperrors.NotFound("warehouse")
	}
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:     &actorID,
		Action:      "delete",
		EntityType:  "warehouse",
		EntityID:    &id,
		BeforeState: w,
	})
	return nil
}
