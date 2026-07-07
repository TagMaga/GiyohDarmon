package customers

import (
	"context"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
)

// Service encapsulates customer business logic.
type Service struct {
	repo   *Repository
	logger *activity.Logger
}

func NewService(repo *Repository, logger *activity.Logger) *Service {
	return &Service{repo: repo, logger: logger}
}

// List returns customers matching filter, restricted to actorRole/actorID's
// scope — see repository.applyCustomerScope for the exact rule per role.
func (s *Service) List(ctx context.Context, actorID uuid.UUID, actorRole string, f ListCustomersFilter, p pagination.Params) ([]Customer, int, error) {
	return s.repo.List(ctx, f, actorID, actorRole, p)
}

// GetByID returns a customer by ID, restricted to actorRole/actorID's scope.
// Cross-scope access reports NotFound rather than Forbidden, so a caller
// can't distinguish "doesn't exist" from "not yours".
func (s *Service) GetByID(ctx context.Context, actorID uuid.UUID, actorRole string, id uuid.UUID) (*Customer, error) {
	c, err := s.repo.GetByID(ctx, id, actorID, actorRole)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, apperrors.NotFound("customer")
	}
	return c, nil
}

func (s *Service) Create(ctx context.Context, actorID uuid.UUID, req CreateCustomerRequest) (*Customer, error) {
	if req.Source != nil && !req.Source.IsValid() {
		return nil, apperrors.BadRequest("invalid source value")
	}

	c := &Customer{
		ID:             uuid.New(),
		FullName:       req.FullName,
		Phone:          req.Phone,
		PhoneSecondary: req.PhoneSecondary,
		City:           req.City,
		Region:         req.Region,
		Address:        req.Address,
		Notes:          req.Notes,
		Source:         req.Source,
		CreatedBy:      &actorID,
	}
	if err := s.repo.Create(ctx, c); err != nil {
		return nil, err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:    &actorID,
		Action:     "create",
		EntityType: "customer",
		EntityID:   &c.ID,
		AfterState: c,
	})
	return c, nil
}

func (s *Service) Update(ctx context.Context, actorID uuid.UUID, actorRole string, id uuid.UUID, req UpdateCustomerRequest) (*Customer, error) {
	c, err := s.repo.GetByID(ctx, id, actorID, actorRole)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, apperrors.NotFound("customer")
	}
	if req.Source != nil && !req.Source.IsValid() {
		return nil, apperrors.BadRequest("invalid source value")
	}

	before := *c
	if req.FullName != nil {
		c.FullName = *req.FullName
	}
	if req.Phone != nil {
		c.Phone = *req.Phone
	}
	if req.PhoneSecondary != nil {
		c.PhoneSecondary = req.PhoneSecondary
	}
	if req.City != nil {
		c.City = req.City
	}
	if req.Region != nil {
		c.Region = req.Region
	}
	if req.Address != nil {
		c.Address = req.Address
	}
	if req.Notes != nil {
		c.Notes = req.Notes
	}
	if req.Source != nil {
		c.Source = req.Source
	}

	if err := s.repo.Update(ctx, c); err != nil {
		return nil, err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:     &actorID,
		Action:      "update",
		EntityType:  "customer",
		EntityID:    &c.ID,
		BeforeState: before,
		AfterState:  c,
	})
	return c, nil
}

func (s *Service) Delete(ctx context.Context, actorID uuid.UUID, actorRole string, id uuid.UUID) error {
	c, err := s.repo.GetByID(ctx, id, actorID, actorRole)
	if err != nil {
		return err
	}
	if c == nil {
		return apperrors.NotFound("customer")
	}
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		return err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:     &actorID,
		Action:      "delete",
		EntityType:  "customer",
		EntityID:    &id,
		BeforeState: c,
	})
	return nil
}

func (s *Service) GetHistory(ctx context.Context, actorID uuid.UUID, actorRole string, id uuid.UUID) (*CustomerHistory, error) {
	c, err := s.repo.GetByID(ctx, id, actorID, actorRole)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, apperrors.NotFound("customer")
	}

	h, err := s.repo.GetHistory(ctx, id, actorID, actorRole)
	if err != nil {
		return nil, err
	}

	avg := 0.0
	if h.TotalOrders > 0 {
		avg = h.TotalSpent / float64(h.TotalOrders)
	}

	return &CustomerHistory{
		Customer:       ToCustomerResponse(c),
		TotalOrders:    h.TotalOrders,
		TotalSpent:     h.TotalSpent,
		DeliveredCount: h.DeliveredCount,
		CancelledCount: h.CancelledCount,
		ReturnedCount:  h.ReturnedCount,
		AverageOrder:   avg,
		LastOrderAt:    h.LastOrderAt,
	}, nil
}
