package dispatcher_settlements

import (
	"context"
	"time"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// GetSummaryForOwner returns the four KPI figures, optionally scoped to one
// dispatcher and/or a date range.
func (s *Service) GetSummaryForOwner(ctx context.Context, f SummaryFilter) (Summary, error) {
	return s.repo.GetSummary(ctx, f)
}

// GetSummaryForDispatcher is the same aggregation, hard-scoped to the caller
// so a dispatcher can never see another dispatcher's figures.
func (s *Service) GetSummaryForDispatcher(ctx context.Context, dispatcherID uuid.UUID, from, to *time.Time) (Summary, error) {
	return s.repo.GetSummary(ctx, SummaryFilter{DispatcherID: &dispatcherID, From: from, To: to})
}

// ListForOwner returns settlement history across all (or one) dispatcher.
func (s *Service) ListForOwner(ctx context.Context, f ListFilter, p pagination.Params) ([]Row, int, error) {
	return s.repo.List(ctx, f, p)
}

// ListForDispatcher is the same listing, hard-scoped to the caller.
func (s *Service) ListForDispatcher(ctx context.Context, dispatcherID uuid.UUID, p pagination.Params) ([]Row, int, error) {
	return s.repo.List(ctx, ListFilter{DispatcherID: &dispatcherID}, p)
}

// Submit creates a pending settlement for the dispatcher's full current
// outstanding balance (received - already-confirmed-paid). The amount is
// always computed server-side from OutstandingBalance, never taken from the
// request, so a dispatcher can't submit an arbitrary figure.
func (s *Service) Submit(ctx context.Context, dispatcherID uuid.UUID, req CreateRequest) (*Settlement, error) {
	balance, err := s.repo.OutstandingBalance(ctx, dispatcherID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if balance <= 0 {
		return nil, apperrors.BadRequest("нет непереданных средств для передачи компании")
	}
	settlement := &Settlement{
		ID:           uuid.New(),
		DispatcherID: dispatcherID,
		Amount:       balance,
		Status:       StatusPending,
		Comment:      req.Comment,
	}
	if err := s.repo.Create(ctx, settlement); err != nil {
		return nil, apperrors.Internal(err)
	}
	return settlement, nil
}

// Confirm approves a pending settlement — owner-only, enforced by routing.
func (s *Service) Confirm(ctx context.Context, reviewerID, id uuid.UUID) (*Settlement, error) {
	return s.review(ctx, reviewerID, id, StatusConfirmed, nil)
}

// Reject declines a pending settlement with a required reason.
func (s *Service) Reject(ctx context.Context, reviewerID, id uuid.UUID, reason string) (*Settlement, error) {
	return s.review(ctx, reviewerID, id, StatusRejected, &reason)
}

func (s *Service) review(ctx context.Context, reviewerID, id uuid.UUID, status string, reason *string) (*Settlement, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, apperrors.NotFound("settlement")
	}
	if existing.Status != StatusPending {
		return nil, apperrors.BadRequest("заявка уже рассмотрена")
	}
	updated, err := s.repo.Review(ctx, id, reviewerID, status, reason)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return updated, nil
}
