package dispatch

// service.go — Dispatcher business logic (Phase 5).
//
// Design rules:
//   1. Assignment creation and cache sync always run inside a single transaction.
//   2. Pure status changes (confirm, issue, return, cancel, resolve-issue) are
//      delegated to orders.Service.ChangeStatus — no status logic is re-implemented here.
//   3. Assign and Reassign must atomically: create/deactivate assignments +
//      update courier cache + change status.  Because orders.Service.ChangeStatus
//      manages its own transaction internally, these special flows run a single
//      local transaction that updates the DB directly for status and cache.
//   4. Never touch financial or inventory logic.

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	logistics_settings "github.com/megamall/crm/internal/logistics_settings"
	"github.com/megamall/crm/internal/orders"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

type Service struct {
	repo      *Repository
	ordersSvc *orders.Service
	logger    *activity.Logger
	db        *gorm.DB
}

func NewService(
	repo *Repository,
	ordersSvc *orders.Service,
	logger *activity.Logger,
	db *gorm.DB,
) *Service {
	return &Service{
		repo:      repo,
		ordersSvc: ordersSvc,
		logger:    logger,
		db:        db,
	}
}

// ─── Board ────────────────────────────────────────────────────────────────────

func (s *Service) GetBoard(ctx context.Context, p pagination.Params) ([]BoardOrder, int, error) {
	return s.repo.ListBoardOrders(ctx, p)
}

func (s *Service) GetCouriersOverview(ctx context.Context) ([]CourierOverview, error) {
	return s.repo.GetCouriersOverview(ctx)
}

func (s *Service) GetCashSettlement(ctx context.Context, filter CashSettlementFilter) ([]CashSettlementRow, error) {
	return s.repo.GetCashSettlement(ctx, filter)
}

func (s *Service) ListCashTransactions(ctx context.Context, filter CashTransactionFilter, p pagination.Params) ([]CashTransactionRow, int, error) {
	return s.repo.ListCashTransactions(ctx, filter, p)
}

func (s *Service) ListOrderHistory(ctx context.Context, filter OrderHistoryFilter, p pagination.Params) ([]OrderHistoryRow, int, error) {
	return s.repo.ListOrderHistory(ctx, filter, p)
}

func (s *Service) AggregateOrderHistory(ctx context.Context, filter OrderHistoryFilter) (totalIncome float64, deliveredCount int, err error) {
	return s.repo.AggregateOrderHistory(ctx, filter)
}

func (s *Service) UpdateCourierOrderIntake(ctx context.Context, actorID, courierID uuid.UUID, req UpdateCourierOrderIntakeRequest) (*CourierOverview, error) {
	if req.Enabled == nil {
		return nil, apperrors.BadRequest("enabled is required")
	}
	enabled := *req.Enabled
	reason := normalizeOrderIntakeReason(req.Reason)
	updated, err := s.repo.UpdateCourierOrderIntake(ctx, courierID, actorID, enabled, reason)
	if err != nil {
		return nil, err
	}
	action := "enable_courier_order_intake"
	if !enabled {
		action = "disable_courier_order_intake"
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:    &actorID,
		Action:     action,
		EntityType: "courier",
		EntityID:   &courierID,
		AfterState: map[string]interface{}{
			"enabled": enabled,
			"reason":  reason,
		},
	})
	return updated, nil
}

func normalizeOrderIntakeReason(reason *string) *string {
	if reason == nil {
		return nil
	}
	value := strings.TrimSpace(*reason)
	if value == "" {
		return nil
	}
	return &value
}

// ─── Order status actions (delegate to orders.Service) ───────────────────────

// ConfirmOrder transitions new → confirmed via the orders service.
func (s *Service) ConfirmOrder(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, req StatusChangeRequest) (*orders.Order, error) {
	return s.ordersSvc.ChangeStatus(ctx, actorID, "dispatcher", orderID, orders.ChangeStatusRequest{
		Status:  orders.StatusConfirmed,
		Comment: req.Comment,
	})
}

// IssueOrder transitions in_delivery → issue.
func (s *Service) IssueOrder(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, req StatusChangeRequest) (*orders.Order, error) {
	return s.ordersSvc.ChangeStatus(ctx, actorID, "dispatcher", orderID, orders.ChangeStatusRequest{
		Status:  orders.StatusIssue,
		Comment: req.Comment,
	})
}

// ResolveIssue transitions issue → confirmed / assigned / returned / cancelled.
func (s *Service) ResolveIssue(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, req ResolveIssueRequest) (*orders.Order, error) {
	if !req.ToStatus.IsValid() {
		return nil, apperrors.BadRequest("invalid to_status")
	}
	return s.ordersSvc.ChangeStatus(ctx, actorID, "dispatcher", orderID, orders.ChangeStatusRequest{
		Status:  req.ToStatus,
		Comment: req.Comment,
	})
}

// ReturnOrder transitions in_delivery → returned.
func (s *Service) ReturnOrder(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, req StatusChangeRequest) (*orders.Order, error) {
	return s.ordersSvc.ChangeStatus(ctx, actorID, "dispatcher", orderID, orders.ChangeStatusRequest{
		Status:  orders.StatusReturned,
		Comment: req.Comment,
	})
}

// CancelOrder transitions any non-terminal status → cancelled.
func (s *Service) CancelOrder(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, req StatusChangeRequest) (*orders.Order, error) {
	return s.ordersSvc.ChangeStatus(ctx, actorID, "dispatcher", orderID, orders.ChangeStatusRequest{
		Status:  orders.StatusCancelled,
		Comment: req.Comment,
	})
}

// ─── Assignment (atomic: assignment + cache + status in one tx) ───────────────

// AssignCourier assigns a courier to a confirmed order.
//
// Transaction sequence:
//  1. Lock order — must be confirmed, no active assignment.
//  2. Create OrderAssignment (is_active=true).
//  3. Update orders.courier_id cache.
//  4. Update orders.status = assigned.
//  5. Insert order_timeline entry.
//  6. LogSync activity.
func (s *Service) AssignCourier(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, req AssignCourierRequest) (*OrderAssignment, error) {
	var created *OrderAssignment

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		o, err := s.repo.GetOrderForUpdate(tx, ctx, orderID)
		if err != nil {
			return err
		}

		// Target must be an active courier (H3).
		isCourier, err := s.repo.CourierExists(tx, ctx, req.CourierID)
		if err != nil {
			return err
		}
		if !isCourier {
			return apperrors.BadRequest("target user is not an active courier")
		}
		intakeEnabled, err := s.repo.CourierOrderIntakeEnabled(tx, ctx, req.CourierID)
		if err != nil {
			return err
		}
		if !intakeEnabled {
			return apperrors.Forbidden("Приём новых заказов отключён диспетчером")
		}

		// Only confirmed orders (or prepayment states) can be assigned.
		assignableStatuses := map[orders.OrderStatus]bool{
			orders.StatusConfirmed:          true,
			orders.StatusPrepaymentPending:  true,
			orders.StatusPrepaymentReceived: true,
		}
		if !assignableStatuses[o.Status] {
			return apperrors.BadRequest(fmt.Sprintf("cannot assign courier to order in status %q", o.Status))
		}

		// Ensure no active assignment exists.
		existing, err := s.repo.GetActiveAssignment(tx, ctx, orderID)
		if err != nil {
			return err
		}
		if existing != nil {
			return apperrors.Conflict("order already has an active courier assignment; use reassign instead")
		}

		// Enforce payout profile + city service, then freeze the courier payout.
		payout, err := logistics_settings.ResolveAssignmentPayout(tx, req.CourierID, o.CityID, o.DeliveryMethod)
		if err != nil {
			return err
		}

		assign := &OrderAssignment{
			ID:         uuid.New(),
			OrderID:    orderID,
			CourierID:  req.CourierID,
			AssignedBy: actorID,
			IsActive:   true,
			Note:       req.Note,
		}
		if err := s.repo.CreateAssignment(tx, ctx, assign); err != nil {
			return err
		}

		if err := s.repo.SetCourierCache(tx, ctx, orderID, &req.CourierID); err != nil {
			return fmt.Errorf("set courier cache: %w", err)
		}

		if err := tx.WithContext(ctx).Table("orders").Where("id = ?", orderID).
			Update("courier_payout", payout).Error; err != nil {
			return fmt.Errorf("freeze courier payout: %w", err)
		}

		if err := s.repo.SetOrderStatus(tx, ctx, orderID, orders.StatusAssigned); err != nil {
			return fmt.Errorf("set order status: %w", err)
		}

		from := o.Status
		tl := &orders.OrderTimeline{
			ID:         uuid.New(),
			OrderID:    orderID,
			FromStatus: &from,
			ToStatus:   orders.StatusAssigned,
			CreatedBy:  actorID,
		}
		if err := s.repo.InsertTimeline(tx, ctx, tl); err != nil {
			return err
		}

		if err := s.logger.LogSync(tx, activity.Entry{
			ActorID:    &actorID,
			Action:     "assign_courier",
			EntityType: "order",
			EntityID:   &orderID,
			AfterState: map[string]interface{}{
				"courier_id":    req.CourierID,
				"assignment_id": assign.ID,
			},
		}); err != nil {
			return err
		}

		created = assign
		return nil
	})

	if txErr != nil {
		return nil, txErr
	}
	return created, nil
}

// ReassignCourier deactivates the current assignment and creates a new one.
// The order status stays assigned; only the courier changes.
func (s *Service) ReassignCourier(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, req AssignCourierRequest) (*OrderAssignment, error) {
	var created *OrderAssignment

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		o, err := s.repo.GetOrderForUpdate(tx, ctx, orderID)
		if err != nil {
			return err
		}

		// Target must be an active courier (H3).
		isCourier, err := s.repo.CourierExists(tx, ctx, req.CourierID)
		if err != nil {
			return err
		}
		if !isCourier {
			return apperrors.BadRequest("target user is not an active courier")
		}
		intakeEnabled, err := s.repo.CourierOrderIntakeEnabled(tx, ctx, req.CourierID)
		if err != nil {
			return err
		}
		if !intakeEnabled {
			return apperrors.Forbidden("Приём новых заказов отключён диспетчером")
		}

		if o.Status != orders.StatusAssigned && o.Status != orders.StatusInDelivery {
			return apperrors.BadRequest(fmt.Sprintf("cannot reassign courier for order in status %q", o.Status))
		}

		existing, err := s.repo.GetActiveAssignment(tx, ctx, orderID)
		if err != nil {
			return err
		}
		if existing == nil {
			return apperrors.NotFound("active assignment for this order")
		}

		// Enforce payout profile + city service for the NEW courier, then re-freeze.
		payout, err := logistics_settings.ResolveAssignmentPayout(tx, req.CourierID, o.CityID, o.DeliveryMethod)
		if err != nil {
			return err
		}

		if err := s.repo.DeactivateAssignment(tx, ctx, existing.ID); err != nil {
			return err
		}

		assign := &OrderAssignment{
			ID:         uuid.New(),
			OrderID:    orderID,
			CourierID:  req.CourierID,
			AssignedBy: actorID,
			IsActive:   true,
			Note:       req.Note,
		}
		if err := s.repo.CreateAssignment(tx, ctx, assign); err != nil {
			return err
		}

		if err := s.repo.SetCourierCache(tx, ctx, orderID, &req.CourierID); err != nil {
			return fmt.Errorf("update courier cache: %w", err)
		}

		if err := tx.WithContext(ctx).Table("orders").Where("id = ?", orderID).
			Update("courier_payout", payout).Error; err != nil {
			return fmt.Errorf("re-freeze courier payout: %w", err)
		}

		if err := s.logger.LogSync(tx, activity.Entry{
			ActorID:    &actorID,
			Action:     "reassign_courier",
			EntityType: "order",
			EntityID:   &orderID,
			AfterState: map[string]interface{}{
				"old_courier_id": existing.CourierID,
				"new_courier_id": req.CourierID,
				"assignment_id":  assign.ID,
			},
		}); err != nil {
			return err
		}

		created = assign
		return nil
	})

	if txErr != nil {
		return nil, txErr
	}
	return created, nil
}

// UnassignCourier pulls an order back to the confirmed pool, releasing its courier.
//
// It delegates to orders.Service.ChangeStatus(→ confirmed), which atomically
// deactivates the active assignment, clears the courier_id cache, writes the
// timeline entry and the audit log (C1). This is the explicit recovery action a
// dispatcher uses to free a courier from an order that has been assigned, picked
// up, or flagged with an issue.
//
// Returns BadRequest when the order is not in a courier-holding state, so the UI
// can hide / disable the action and surface a clear message.
func (s *Service) UnassignCourier(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID) (*orders.Order, error) {
	o, err := s.repo.GetOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}
	holding := o.Status == orders.StatusAssigned ||
		o.Status == orders.StatusInDelivery ||
		o.Status == orders.StatusIssue
	if !holding || o.CourierID == nil {
		return nil, apperrors.BadRequest("order has no active courier to unassign")
	}

	comment := "courier unassigned by dispatcher"
	return s.ordersSvc.ChangeStatus(ctx, actorID, "dispatcher", orderID, orders.ChangeStatusRequest{
		Status:  orders.StatusConfirmed,
		Comment: &comment,
	})
}

// ScheduleOrder sets the scheduled_at timestamp on an order.
func (s *Service) ScheduleOrder(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, req ScheduleOrderRequest) error {
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		o, err := s.repo.GetOrderForUpdate(tx, ctx, orderID)
		if err != nil {
			return err
		}
		if o.Status.IsTerminal() {
			return apperrors.BadRequest("cannot schedule a terminal order")
		}
		if err := s.repo.SetScheduledAt(tx, ctx, orderID, req.ScheduledAt); err != nil {
			return fmt.Errorf("set scheduled_at: %w", err)
		}
		s.logger.LogAsync(activity.Entry{
			ActorID:    &actorID,
			Action:     "schedule_order",
			EntityType: "order",
			EntityID:   &orderID,
			AfterState: map[string]interface{}{"scheduled_at": req.ScheduledAt},
		})
		return nil
	})
	return txErr
}

// ─── Comments ─────────────────────────────────────────────────────────────────

func (s *Service) AddComment(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, req AddCommentRequest) (*OrderComment, error) {
	if !req.Visibility.IsValid() {
		return nil, apperrors.BadRequest("invalid visibility value")
	}
	// Verify order exists.
	if _, err := s.ordersSvc.GetByID(ctx, orderID); err != nil {
		return nil, err
	}
	c := &OrderComment{
		ID:         uuid.New(),
		OrderID:    orderID,
		UserID:     actorID,
		Comment:    req.Comment,
		Visibility: req.Visibility,
	}
	if err := s.repo.CreateComment(ctx, c); err != nil {
		return nil, err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:    &actorID,
		Action:     "add_comment",
		EntityType: "order",
		EntityID:   &orderID,
	})
	return c, nil
}

// ListComments returns comments for an order.
// Dispatchers see all; other roles see only their visibility tier.
// No order-existence pre-check: stale/cancelled orders return empty array
// instead of 404 so the comments drawer stays functional.
func (s *Service) ListComments(ctx context.Context, orderID uuid.UUID, visibilities []CommentVisibility) ([]OrderComment, error) {
	return s.repo.ListComments(ctx, orderID, visibilities)
}

// GetSellers returns all active sellers for the dispatcher's order creation form.
func (s *Service) GetSellers(ctx context.Context) ([]SellerInfo, error) {
	return s.repo.ListSellers(ctx)
}
