package courier

// service.go — Courier business logic (Phase 5).
//
// Design rules:
//  1. Claim (confirmed→assigned) runs as a single atomic transaction in the
//     repository because it must create an assignment AND change status.
//  2. All other status transitions (start, delivered, returned, issue) delegate
//     to orders.Service.ChangeStatus with role="courier".
//  3. The orders.Service.validateTransitionRole checks orders.courier_id cache
//     to enforce ownership; the cache is kept in sync by ClaimOrder.
//  4. Cash handover confirm/reject are called by the dispatch handler.

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
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

// ─── Profile ──────────────────────────────────────────────────────────────────

func (s *Service) Me(ctx context.Context, courierID uuid.UUID) (*CourierMeResponse, error) {
	return s.repo.GetMe(ctx, courierID)
}

// ─── My Orders ────────────────────────────────────────────────────────────────

func (s *Service) MyOrders(ctx context.Context, courierID uuid.UUID, status string) ([]MyOrderResponse, error) {
	return s.repo.ListMyOrders(ctx, courierID, status)
}

// ─── Available Orders ─────────────────────────────────────────────────────────

func (s *Service) AvailableOrders(ctx context.Context, courierID uuid.UUID, p pagination.Params) ([]MyOrderResponse, int, error) {
	return s.repo.ListAvailableOrders(ctx, courierID, p)
}

// ─── Claim ────────────────────────────────────────────────────────────────────

// ClaimOrder atomically assigns the courier to a confirmed, unassigned order
// and transitions it to assigned.  The entire operation runs in a single
// repository transaction to prevent race conditions.
func (s *Service) ClaimOrder(ctx context.Context, courierID uuid.UUID, orderID uuid.UUID) error {
	if err := s.repo.ClaimOrder(ctx, courierID, orderID); err != nil {
		return err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:    &courierID,
		Action:     "claim_order",
		EntityType: "order",
		EntityID:   &orderID,
		AfterState: map[string]interface{}{"status": string(orders.StatusAssigned)},
	})
	return nil
}

// GetOrderDetail returns full order detail for a courier, enforcing ownership.
func (s *Service) GetOrderDetail(ctx context.Context, courierID uuid.UUID, orderID uuid.UUID) (*MyOrderResponse, error) {
	return s.repo.GetOrderByIDForCourier(ctx, courierID, orderID)
}

// ─── Delivery status transitions (delegate to orders.Service) ─────────────────

// StartDelivery transitions assigned → in_delivery.
func (s *Service) StartDelivery(ctx context.Context, courierID uuid.UUID, orderID uuid.UUID, req StatusChangeRequest) (*orders.Order, error) {
	return s.ordersSvc.ChangeStatus(ctx, courierID, "courier", orderID, orders.ChangeStatusRequest{
		Status:  orders.StatusInDelivery,
		Comment: req.Comment,
	})
}

// MarkDelivered transitions in_delivery → delivered.
// Triggers inventory deduction + financial events in orders service.
func (s *Service) MarkDelivered(ctx context.Context, courierID uuid.UUID, orderID uuid.UUID, req StatusChangeRequest) (*orders.Order, error) {
	return s.ordersSvc.ChangeStatus(ctx, courierID, "courier", orderID, orders.ChangeStatusRequest{
		Status:  orders.StatusDelivered,
		Comment: req.Comment,
	})
}

// MarkReturned transitions in_delivery → returned.
func (s *Service) MarkReturned(ctx context.Context, courierID uuid.UUID, orderID uuid.UUID, req StatusChangeRequest) (*orders.Order, error) {
	return s.ordersSvc.ChangeStatus(ctx, courierID, "courier", orderID, orders.ChangeStatusRequest{
		Status:  orders.StatusReturned,
		Comment: req.Comment,
	})
}

// AddressChanged returns the order to confirmed with no courier, recording
// the new address as a timeline comment.
func (s *Service) AddressChanged(ctx context.Context, courierID uuid.UUID, orderID uuid.UUID, newAddress string) error {
	if err := s.repo.AddressChanged(ctx, courierID, orderID, newAddress); err != nil {
		return err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:    &courierID,
		Action:     "address_changed",
		EntityType: "order",
		EntityID:   &orderID,
		AfterState: map[string]interface{}{"status": string(orders.StatusConfirmed), "courier_id": nil, "new_address": newAddress},
	})
	return nil
}

// DeferOrder unassigns the courier and schedules the order for a future date.
func (s *Service) DeferOrder(ctx context.Context, courierID uuid.UUID, orderID uuid.UUID, req DeferOrderRequest) error {
	if err := s.repo.DeferOrder(ctx, courierID, orderID, req.ScheduledAt); err != nil {
		return err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:    &courierID,
		Action:     "defer_order",
		EntityType: "order",
		EntityID:   &orderID,
		AfterState: map[string]interface{}{"status": string(orders.StatusConfirmed), "scheduled_at": req.ScheduledAt},
	})
	return nil
}

// MarkIssue transitions in_delivery → issue.
func (s *Service) MarkIssue(ctx context.Context, courierID uuid.UUID, orderID uuid.UUID, req StatusChangeRequest) (*orders.Order, error) {
	return s.ordersSvc.ChangeStatus(ctx, courierID, "courier", orderID, orders.ChangeStatusRequest{
		Status:  orders.StatusIssue,
		Comment: req.Comment,
	})
}

// ─── Notes ────────────────────────────────────────────────────────────────────

// AddNote appends an immutable note to the courier's own assigned order.
func (s *Service) AddNote(ctx context.Context, courierID uuid.UUID, orderID uuid.UUID, req AddNoteRequest) (*CourierNote, error) {
	// Verify courier has an active assignment for this order.
	if err := s.repo.verifyActiveAssignment(ctx, orderID, courierID); err != nil {
		return nil, err
	}
	n := &CourierNote{
		ID:        uuid.New(),
		OrderID:   orderID,
		CourierID: courierID,
		Note:      req.Note,
	}
	if err := s.repo.CreateNote(ctx, n); err != nil {
		return nil, err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:    &courierID,
		Action:     "add_note",
		EntityType: "order",
		EntityID:   &orderID,
	})
	return n, nil
}

func (s *Service) ListNotes(ctx context.Context, courierID uuid.UUID, orderID uuid.UUID) ([]CourierNote, error) {
	// Verify courier has or had an assignment for this order.
	if err := s.repo.verifyActiveAssignment(ctx, orderID, courierID); err != nil {
		return nil, err
	}
	return s.repo.ListNotes(ctx, orderID, courierID)
}

// ─── Delivery Attempts ────────────────────────────────────────────────────────

// AddAttempt records a delivery attempt for an order.
// The courier must have an active assignment.
func (s *Service) AddAttempt(ctx context.Context, courierID uuid.UUID, orderID uuid.UUID, req AddAttemptRequest) (*DeliveryAttempt, error) {
	if !req.Result.IsValid() {
		return nil, apperrors.BadRequest("invalid attempt result")
	}
	if err := s.repo.verifyActiveAssignment(ctx, orderID, courierID); err != nil {
		return nil, err
	}
	no, err := s.repo.NextAttemptNo(ctx, orderID)
	if err != nil {
		return nil, err
	}
	a := &DeliveryAttempt{
		ID:        uuid.New(),
		OrderID:   orderID,
		CourierID: courierID,
		AttemptNo: no,
		Result:    req.Result,
		Comment:   req.Comment,
	}
	if err := s.repo.CreateAttempt(ctx, a); err != nil {
		return nil, err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:    &courierID,
		Action:     "delivery_attempt",
		EntityType: "order",
		EntityID:   &orderID,
		AfterState: map[string]interface{}{
			"attempt_no": no,
			"result":     req.Result,
		},
	})
	return a, nil
}

// ─── Courier Status ───────────────────────────────────────────────────────────

func (s *Service) UpdateStatus(ctx context.Context, courierID uuid.UUID, req UpdateCourierStatusRequest) (*CourierStatusLog, error) {
	if !req.Status.IsValid() {
		return nil, apperrors.BadRequest("invalid courier status")
	}
	log := &CourierStatusLog{
		ID:        uuid.New(),
		CourierID: courierID,
		Status:    req.Status,
		Latitude:  req.Latitude,
		Longitude: req.Longitude,
	}
	if err := s.repo.CreateStatusLog(ctx, log); err != nil {
		return nil, err
	}
	return log, nil
}

// ─── Cash Handovers ───────────────────────────────────────────────────────────

// SubmitHandover collects all eligible delivered orders for the courier and
// creates a pending cash handover.
//
// Algorithm:
//  1. Find delivered orders for courier NOT in any pending/confirmed handover.
//  2. For each order: collected = total_amount + delivery_fee - prepayment_amount (= amount_to_collect);
//     returns = collected - delivery_fee = total_amount - prepayment_amount.
//  3. Sum totals.
//  4. Create CashHandover + CashHandoverOrder rows in one transaction.
func (s *Service) SubmitHandover(ctx context.Context, courierID uuid.UUID, req SubmitHandoverRequest) (*CashHandover, error) {
	var created *CashHandover

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		eligible, err := s.repo.FindEligibleHandoverOrders(tx, ctx, courierID)
		if err != nil {
			return err
		}
		if len(eligible) == 0 {
			return apperrors.BadRequest("no eligible delivered orders found for handover")
		}

		handoverID := uuid.New()
		var totalCollected, totalFees, totalReturn float64
		lines := make([]CashHandoverOrder, 0, len(eligible))

		for _, o := range eligible {
			// collected = what the courier physically received from the client
			// (product + client delivery fee − prepayment).
			collected := o.TotalAmount + o.DeliveryFee - o.PrepaymentAmount
			if collected < 0 {
				collected = 0
			}
			// returns = the FULL client cash. The courier hands back everything;
			// courier payout is a separate company expense (ledger), never kept
			// from the cash collected.
			returns := collected

			totalCollected += collected
			totalFees += o.DeliveryFee
			totalReturn += returns

			lines = append(lines, CashHandoverOrder{
				ID:               uuid.New(),
				HandoverID:       handoverID,
				OrderID:          o.ID,
				OrderTotal:       o.TotalAmount,
				PrepaymentAmount: o.PrepaymentAmount,
				CourierCollected: collected,
				DeliveryFee:      o.DeliveryFee,
				CourierReturns:   returns,
			})
		}

		h := &CashHandover{
			ID:                handoverID,
			CourierID:         courierID,
			TotalCollected:    totalCollected,
			TotalDeliveryFees: totalFees,
			TotalToReturn:     totalReturn,
			Status:            HandoverStatusPending,
			ProofURL:          req.ProofURL,
			AttachmentsJSON:   req.AttachmentsJSON,
			Comment:           req.Notes,
			ActualReturned:    req.ActualAmount,
		}

		if err := s.repo.CreateHandover(tx, ctx, h); err != nil {
			return err
		}
		if err := s.repo.CreateHandoverOrders(tx, ctx, lines); err != nil {
			return err
		}

		if err := s.logger.LogSync(tx, activity.Entry{
			ActorID:    &courierID,
			Action:     "submit_handover",
			EntityType: "cash_handover",
			EntityID:   &handoverID,
			AfterState: map[string]interface{}{
				"total_collected": totalCollected,
				"total_to_return": totalReturn,
				"order_count":     len(lines),
			},
		}); err != nil {
			return err
		}

		// Re-load with orders preloaded — must use tx here so the row is
		// visible before the transaction commits.
		loaded, err := s.repo.GetHandoverByIDTx(tx, ctx, handoverID)
		if err != nil {
			return err
		}
		created = loaded
		return nil
	})

	if txErr != nil {
		return nil, txErr
	}
	return created, nil
}

// ConfirmHandover confirms a pending handover.
// If actual_returned != total_to_return the status is set to disputed.
func (s *Service) ConfirmHandover(ctx context.Context, dispatcherID uuid.UUID, handoverID uuid.UUID, req ConfirmHandoverRequest) (*CashHandover, error) {
	h, err := s.repo.GetHandoverByID(ctx, handoverID)
	if err != nil {
		return nil, err
	}
	if h.Status != HandoverStatusPending && h.Status != HandoverStatusDisputed {
		return nil, apperrors.BadRequest(fmt.Sprintf("handover cannot be confirmed from status %q", h.Status))
	}

	now := time.Now().UTC()
	h.DispatcherID = &dispatcherID
	h.ActualReturned = &req.ActualReturned
	h.ConfirmedAt = &now
	h.Comment = req.Comment

	// Disputed if amounts don't match (within floating point tolerance).
	diff := req.ActualReturned - h.TotalToReturn
	if diff < -0.01 || diff > 0.01 {
		h.Status = HandoverStatusDisputed
	} else {
		h.Status = HandoverStatusConfirmed
	}

	if err := s.repo.UpdateHandover(ctx, h); err != nil {
		return nil, fmt.Errorf("confirm handover: %w", err)
	}

	s.logger.LogAsync(activity.Entry{
		ActorID:    &dispatcherID,
		Action:     "confirm_handover",
		EntityType: "cash_handover",
		EntityID:   &handoverID,
		AfterState: map[string]interface{}{
			"status":          h.Status,
			"actual_returned": req.ActualReturned,
		},
	})
	return h, nil
}

// ConfirmTransaction finalizes a courier-submitted handover from the dispatcher
// cash transactions tab. The dispatcher does not edit the amount here; the
// stored submitted amount wins, falling back to the calculated return amount.
func (s *Service) ConfirmTransaction(ctx context.Context, dispatcherID uuid.UUID, handoverID uuid.UUID) (*CashHandover, error) {
	h, err := s.repo.GetHandoverByID(ctx, handoverID)
	if err != nil {
		return nil, err
	}
	if h.Status != HandoverStatusPending {
		return nil, apperrors.BadRequest(fmt.Sprintf("handover cannot be confirmed from status %q", h.Status))
	}

	amount := h.TotalToReturn
	if h.ActualReturned != nil {
		amount = *h.ActualReturned
	}
	now := time.Now().UTC()
	h.DispatcherID = &dispatcherID
	h.ActualReturned = &amount
	h.ConfirmedAt = &now
	h.Status = HandoverStatusConfirmed

	if err := s.repo.UpdateHandover(ctx, h); err != nil {
		return nil, fmt.Errorf("confirm cash transaction: %w", err)
	}

	s.logger.LogAsync(activity.Entry{
		ActorID:    &dispatcherID,
		Action:     "confirm_cash_transaction",
		EntityType: "cash_handover",
		EntityID:   &handoverID,
		AfterState: map[string]interface{}{
			"status":          string(HandoverStatusConfirmed),
			"actual_returned": amount,
		},
	})
	return h, nil
}

// RejectHandover rejects a pending or disputed handover.
func (s *Service) RejectHandover(ctx context.Context, dispatcherID uuid.UUID, handoverID uuid.UUID, req RejectHandoverRequest) (*CashHandover, error) {
	h, err := s.repo.GetHandoverByID(ctx, handoverID)
	if err != nil {
		return nil, err
	}
	if h.Status != HandoverStatusPending && h.Status != HandoverStatusDisputed {
		return nil, apperrors.BadRequest(fmt.Sprintf("handover cannot be rejected from status %q", h.Status))
	}

	comment := req.Comment
	h.DispatcherID = &dispatcherID
	h.Status = HandoverStatusRejected
	h.Comment = &comment
	if req.AdminNote != nil {
		h.AdminNote = req.AdminNote
	} else {
		h.AdminNote = &comment
	}

	if err := s.repo.UpdateHandover(ctx, h); err != nil {
		return nil, fmt.Errorf("reject handover: %w", err)
	}

	s.logger.LogAsync(activity.Entry{
		ActorID:    &dispatcherID,
		Action:     "reject_handover",
		EntityType: "cash_handover",
		EntityID:   &handoverID,
		AfterState: map[string]interface{}{"status": string(HandoverStatusRejected)},
	})
	return h, nil
}

func (s *Service) MyCashSummary(ctx context.Context, courierID uuid.UUID) (*CashSummaryResponse, error) {
	return s.repo.GetCashSummary(ctx, courierID)
}

func (s *Service) MyHandovers(ctx context.Context, courierID uuid.UUID, p pagination.Params) ([]CashHandover, int, error) {
	return s.repo.ListHandoversByCourier(ctx, courierID, p)
}

// ListAllHandovers is called by the dispatch handler to list all courier handovers.
func (s *Service) ListAllHandovers(ctx context.Context, p pagination.Params) ([]CashHandover, int, error) {
	return s.repo.ListAllHandovers(ctx, p)
}

// ─── Push Token ───────────────────────────────────────────────────────────────

func (s *Service) RegisterPushToken(ctx context.Context, userID uuid.UUID, req RegisterPushTokenRequest) error {
	return s.repo.UpsertPushToken(ctx, userID, req.Token, req.Platform)
}
