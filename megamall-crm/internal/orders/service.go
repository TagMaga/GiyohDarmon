package orders

// service.go — Order business logic for Phase 4.
//
// Key design rules enforced here:
//   1. Every mutation runs inside a DB transaction.
//   2. Financial snapshot is built + frozen at order creation (never recalculated).
//   3. net_revenue = total_amount - delivery_fee  (base for all commissions).
//   4. Inventory reservation increments reserved_quantity; quantity unchanged.
//   5. Inventory deduction happens ONLY on delivered (quantity -= qty, reserved -= qty).
//   6. Status transitions are validated by the state machine in model.go.
//   7. Role-based transition permissions enforced here (Correction 6 & 7).

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/compensation"
	delivery_settings "github.com/megamall/crm/internal/delivery_settings"
	"github.com/megamall/crm/internal/hierarchy"
	"github.com/megamall/crm/internal/inventory"
	"github.com/megamall/crm/internal/teams"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// Service encapsulates all order business logic.
type Service struct {
	repo     *Repository
	invRepo  *inventory.Repository
	hierRepo *hierarchy.Repository
	teamRepo *teams.Repository
	compSvc  *compensation.Service
	logger   *activity.Logger
	db       *gorm.DB
}

// NewService wires up the order service and its dependencies.
func NewService(
	repo *Repository,
	invRepo *inventory.Repository,
	hierRepo *hierarchy.Repository,
	teamRepo *teams.Repository,
	compSvc *compensation.Service,
	logger *activity.Logger,
	db *gorm.DB,
) *Service {
	return &Service{
		repo:     repo,
		invRepo:  invRepo,
		hierRepo: hierRepo,
		teamRepo: teamRepo,
		compSvc:  compSvc,
		logger:   logger,
		db:       db,
	}
}

// ─── Hierarchy resolution ──────────────────────────────────────────────────────

// orderHierarchy holds the resolved manager + team lead IDs for a seller.
type orderHierarchy struct {
	managerID      *uuid.UUID
	managerTeamID  *uuid.UUID
	teamLeadID     *uuid.UUID
	teamLeadTeamID *uuid.UUID
}

// resolveHierarchy resolves the manager and team lead for a seller by walking
// the user_hierarchy and teams tables.
//
// For manager_personal_order / team_lead_personal_order, the caller passes
// the creating user's ID and the same resolution logic applies — the commission
// zeroing rules are applied later in financial.go.
func (s *Service) resolveHierarchy(ctx context.Context, sellerID uuid.UUID) (*orderHierarchy, error) {
	h := &orderHierarchy{}

	// 1. Get seller's team.
	sellerH, err := s.hierRepo.GetByUserID(ctx, sellerID)
	if err != nil {
		return nil, fmt.Errorf("resolve hierarchy: %w", err)
	}
	if sellerH == nil || sellerH.TeamID == nil {
		return h, nil // no team configured — snapshot will use zero rates for manager/TL
	}

	// 2. Get team to find ManagerID and TeamLeadID.
	team, err := s.teamRepo.GetByID(ctx, *sellerH.TeamID)
	if err != nil {
		return nil, fmt.Errorf("resolve hierarchy team: %w", err)
	}
	if team == nil {
		return h, nil
	}

	h.managerID = team.ManagerID
	h.teamLeadID = team.TeamLeadID

	// 3. Get manager's own team ID (for snapshot ManagerTeamID).
	if team.ManagerID != nil {
		mgrH, err := s.hierRepo.GetByUserID(ctx, *team.ManagerID)
		if err != nil {
			return nil, fmt.Errorf("resolve manager hierarchy: %w", err)
		}
		if mgrH != nil {
			h.managerTeamID = mgrH.TeamID
		}
	}

	// 4. Get team lead's own team ID (for snapshot TeamLeadTeamID).
	if team.TeamLeadID != nil {
		tlH, err := s.hierRepo.GetByUserID(ctx, *team.TeamLeadID)
		if err != nil {
			return nil, fmt.Errorf("resolve team lead hierarchy: %w", err)
		}
		if tlH != nil {
			h.teamLeadTeamID = tlH.TeamID
		}
	}

	return h, nil
}

// ─── Order creation ───────────────────────────────────────────────────────────

// Create creates a new order inside a single DB transaction:
//  1. Validate order type vs actor role.
//  2. Calculate subtotal from items.
//  3. Resolve hierarchy snapshot.
//  4. Build & save financial snapshot (freezes rates + delivery fee).
//  5. Set financials: total_amount = subtotal, delivery_fee from snapshot,
//     net_revenue = total_amount - delivery_fee.
//  6. Insert order + items.
//  7. Reserve inventory (reserved_quantity += qty per item).
//  8. Write initial timeline entry.
//  9. LogSync activity.
func (s *Service) Create(ctx context.Context, actorID uuid.UUID, actorRole string, req CreateOrderRequest) (*Order, error) {
	// Validate order type vs role.
	if err := s.validateOrderTypeForRole(actorRole, req.OrderType); err != nil {
		return nil, err
	}
	if !req.OrderType.IsValid() {
		return nil, apperrors.BadRequest("invalid order_type")
	}
	if len(req.Items) == 0 {
		return nil, apperrors.BadRequest("order must have at least one item")
	}

	// City is required and must be an active delivery city.
	if req.CityID == uuid.Nil {
		return nil, apperrors.BadRequest("city is required")
	}
	if err := s.validateActiveCity(ctx, req.CityID); err != nil {
		return nil, err
	}

	// Delivery method: canonical "normal" | "fast" (legacy "express" → "fast").
	deliveryMethod, err := normalizeDeliveryMethod(req.DeliveryMethod)
	if err != nil {
		return nil, err
	}

	var created *Order

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// ── Subtotal ──────────────────────────────────────────────────────────
		subtotal := 0.0
		items := make([]OrderItem, 0, len(req.Items))
		for _, it := range req.Items {
			if it.Quantity <= 0 {
				return apperrors.BadRequest("item quantity must be > 0")
			}
			if it.UnitPrice < 0 {
				return apperrors.BadRequest("item unit_price must be >= 0")
			}
			total := float64(it.Quantity) * it.UnitPrice
			subtotal += total
			items = append(items, OrderItem{
				ID:         uuid.New(),
				ProductID:  it.ProductID,
				Quantity:   it.Quantity,
				UnitPrice:  it.UnitPrice,
				TotalPrice: total,
			})
		}

		// Correction 2: total_amount = subtotal (delivery fee NOT added on top)
		totalAmount := subtotal

		// ── Hierarchy snapshot ────────────────────────────────────────────────
		hier, err := s.resolveHierarchy(ctx, actorID)
		if err != nil {
			return err
		}

		// ── Delivery fee from settings (single source of truth) ───────────────
		// Backend-resolved only — sellers cannot set or override the delivery fee.
		deliveryFee, err := delivery_settings.GetFee(s.db, deliveryMethod)
		if err != nil {
			return fmt.Errorf("resolve delivery fee: %w", err)
		}

		// ── Financial snapshot ────────────────────────────────────────────────
		// DeliveryFee is authoritative; the legacy delivery_tariffs table is not
		// required, so creation never fails on a missing active tariff row.
		snap, err := s.compSvc.BuildSnapshot(ctx, tx, compensation.SnapshotInput{
			SellerID:       &actorID,
			SellerTeamID:   nil,
			ManagerID:      hier.managerID,
			ManagerTeamID:  hier.managerTeamID,
			TeamLeadID:     hier.teamLeadID,
			TeamLeadTeamID: hier.teamLeadTeamID,
			OrderTotal:     totalAmount,
			DeliveryFee:    deliveryFee,
			DeliveryFeeSet: true,
			ResolvedAt:     time.Now().UTC(),
		})
		if err != nil {
			return err
		}

		// net_revenue = total_amount - delivery_fee  (commission base)
		netRevenue := totalAmount - deliveryFee

		// Fail-fast: validate rate sums before accepting the order.
		// Uses the same logic as the Financial Engine so there are no surprises at delivery.
		if _, err := compensation.ApplyCommissionRules(
			compensation.OrderType(req.OrderType), netRevenue, snap,
		); err != nil {
			return apperrors.Unprocessable(err.Error())
		}

		// ── Build order ───────────────────────────────────────────────────────
		orderID := uuid.New()

		// Prepayment flow: no prepayment → auto-confirm; with prepayment → stay new, await dispatcher.
		initialStatus := StatusConfirmed
		prepaymentStatus := PrepaymentStatusNone
		if req.PrepaymentRequired {
			initialStatus = StatusNew
			prepaymentStatus = PrepaymentStatusPendingVerification
		}

		// Auto-classify prepayment type so the seller doesn't have to choose.
		totalOrderAmount := totalAmount + deliveryFee
		autoType := req.PrepaymentType
		if req.PrepaymentRequired && autoType == nil {
			if req.PrepaymentAmount >= totalOrderAmount {
				t := "full"
				autoType = &t
			} else {
				t := "partial"
				autoType = &t
			}
		}

		o := &Order{
			ID:               orderID,
			CustomerID:       req.CustomerID,
			SellerID:         actorID,
			ManagerID:        hier.managerID,
			TeamLeadID:       hier.teamLeadID,
			ManagerTeamID:    hier.managerTeamID,
			TeamLeadTeamID:   hier.teamLeadTeamID,
			OrderType:        req.OrderType,
			Status:           initialStatus,
			WarehouseID:      req.WarehouseID,
			CityID:           &req.CityID,
			SnapshotID:       &snap.ID,
			DeliveryMethod:   deliveryMethod,
			Subtotal:         subtotal,
			TotalAmount:      totalAmount,
			DeliveryFee:      deliveryFee,
			NetRevenue:       netRevenue,
			PrepaymentAmount: req.PrepaymentAmount,
			Notes:            req.Notes,

			PrepaymentRequired: req.PrepaymentRequired,
			PrepaymentType:     autoType,
			PrepaymentStatus:   prepaymentStatus,
			PrepaymentReceiver: req.PrepaymentReceiver,
			PrepaymentComment:  req.PrepaymentComment,
		}

		if err := s.repo.Create(ctx, tx, o); err != nil {
			return err
		}

		// ── Update snapshot with order_id ─────────────────────────────────────
		if err := tx.WithContext(ctx).
			Model(&compensation.OrderFinancialSnapshot{}).
			Where("id = ?", snap.ID).
			UpdateColumn("order_id", orderID).Error; err != nil {
			return fmt.Errorf("link snapshot to order: %w", err)
		}

		// ── Order items ───────────────────────────────────────────────────────
		for i := range items {
			items[i].OrderID = orderID
		}
		if err := s.repo.CreateItems(ctx, tx, items); err != nil {
			return err
		}

		// ── Reserve inventory ─────────────────────────────────────────────────
		for _, it := range items {
			inv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, req.WarehouseID, it.ProductID)
			if err != nil {
				return fmt.Errorf("reserve inventory: %w", err)
			}
			if inv.AvailableQuantity < it.Quantity {
				return apperrors.BadRequest(fmt.Sprintf(
					"insufficient stock for product %s: available %d, needed %d",
					it.ProductID, inv.AvailableQuantity, it.Quantity,
				))
			}
			if err := s.invRepo.UpdateReservedQuantity(tx, ctx, inv.ID, inv.ReservedQuantity+it.Quantity); err != nil {
				return fmt.Errorf("reserve inventory: %w", err)
			}
		}

		// ── Attachment rows for prepayment proof ─────────────────────────────
		if req.PrepaymentRequired {
			proofURLs := []struct {
				url      *string
				fileType string
			}{
				{req.PaymentProofURL, "payment_proof"},
				{req.CustomerChatURL, "customer_chat"},
			}
			for _, p := range proofURLs {
				if p.url == nil || *p.url == "" {
					continue
				}
				att := &OrderAttachment{
					ID:         uuid.New(),
					OrderID:    orderID,
					Type:       p.fileType,
					FileURL:    *p.url,
					UploadedBy: actorID,
				}
				if err := tx.WithContext(ctx).Create(att).Error; err != nil {
					return fmt.Errorf("create attachment: %w", err)
				}
			}
		}

		// ── Initial timeline entry ────────────────────────────────────────────
		tl := &OrderTimeline{
			ID:        uuid.New(),
			OrderID:   orderID,
			ToStatus:  initialStatus,
			CreatedBy: actorID,
		}
		if err := s.repo.CreateTimelineEntry(ctx, tx, tl); err != nil {
			return err
		}

		// ── Activity log ──────────────────────────────────────────────────────
		if err := s.logger.LogSync(tx, activity.Entry{
			ActorID:    &actorID,
			Action:     "create",
			EntityType: "order",
			EntityID:   &orderID,
			AfterState: map[string]interface{}{
				"order_number": o.OrderNumber,
				"order_type":   o.OrderType,
				"total_amount": o.TotalAmount,
				"net_revenue":  o.NetRevenue,
			},
		}); err != nil {
			return err
		}

		// Re-load with items (order_number is DB-generated via sequence).
		loaded, err := s.repo.GetByIDForUpdate(tx, ctx, orderID)
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

// normalizeDeliveryMethod maps a request delivery method to the canonical value.
//   "" / "normal"      → "normal"
//   "fast" / "express" → "fast"  ("express" kept as a legacy alias)
// Any other value is rejected.
func normalizeDeliveryMethod(m string) (string, error) {
	switch m {
	case "", "normal":
		return "normal", nil
	case "fast", "express":
		return "fast", nil
	default:
		return "", apperrors.BadRequest(fmt.Sprintf("unknown delivery method: %q", m))
	}
}

// validateActiveCity ensures the city exists and is active.
func (s *Service) validateActiveCity(ctx context.Context, cityID uuid.UUID) error {
	var count int64
	if err := s.db.WithContext(ctx).
		Table("cities").
		Where("id = ? AND is_active = ?", cityID, true).
		Count(&count).Error; err != nil {
		return apperrors.Internal(fmt.Errorf("validate city: %w", err))
	}
	if count == 0 {
		return apperrors.BadRequest("invalid or inactive city")
	}
	return nil
}

// ─── Read ─────────────────────────────────────────────────────────────────────

func (s *Service) List(ctx context.Context, f ListOrdersFilter, actorID uuid.UUID, actorRole string, p pagination.Params) ([]Order, int, error) {
	return s.repo.List(ctx, f, actorID, actorRole, p)
}

// Stats returns the order-health breakdown for the owner dashboard.
func (s *Service) Stats(ctx context.Context, from, to *time.Time) (*OrderStatsResponse, error) {
	stats, err := s.repo.Stats(ctx, from, to)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return stats, nil
}

// CourierInfoFor resolves courier display identities for a batch of orders.
// Used by the handler to enrich OrderResponse so delivered orders show the courier
// who delivered them even when the assignment is no longer active.
func (s *Service) CourierInfoFor(ctx context.Context, orderIDs []uuid.UUID) (map[uuid.UUID]CourierInfo, error) {
	return s.repo.GetCourierInfo(ctx, orderIDs)
}

func (s *Service) GetByID(ctx context.Context, id uuid.UUID) (*Order, error) {
	o, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if o == nil {
		return nil, apperrors.NotFound("order")
	}
	return o, nil
}

func (s *Service) GetTimeline(ctx context.Context, orderID uuid.UUID) ([]OrderTimeline, error) {
	// Verify order exists.
	if _, err := s.GetByID(ctx, orderID); err != nil {
		return nil, err
	}
	return s.repo.GetTimeline(ctx, orderID)
}

// GetSnapshot returns the frozen financial snapshot for an order.
// Added Phase 6 for E2E validation. Delegates to the compensation service.
func (s *Service) GetSnapshot(ctx context.Context, orderID uuid.UUID) (*compensation.OrderFinancialSnapshot, error) {
	if _, err := s.GetByID(ctx, orderID); err != nil {
		return nil, err
	}
	snap, err := s.compSvc.GetSnapshotByOrderID(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if snap == nil {
		return nil, apperrors.NotFound("financial snapshot for this order")
	}
	return snap, nil
}

// ─── Update ───────────────────────────────────────────────────────────────────

func (s *Service) Update(ctx context.Context, actorID, orderID uuid.UUID, req UpdateOrderRequest) (*Order, error) {
	var updated *Order
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		o, err := s.repo.GetByIDForUpdate(tx, ctx, orderID)
		if err != nil {
			return err
		}
		if o == nil {
			return apperrors.NotFound("order")
		}
		if req.Notes != nil {
			o.Notes = req.Notes
		}
		if err := s.repo.Update(ctx, tx, o); err != nil {
			return err
		}
		s.logger.LogAsync(activity.Entry{
			ActorID:    &actorID,
			Action:     "update",
			EntityType: "order",
			EntityID:   &orderID,
		})
		updated = o
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return updated, nil
}

// ─── Status change ────────────────────────────────────────────────────────────

// ChangeStatus transitions an order to a new status.
// Transaction sequence:
//  1. SELECT FOR UPDATE on order row.
//  2. Validate state machine transition.
//  3. Validate actor role has permission for this transition.
//  4. Handle inventory side effects (reserve / release / deduct).
//  5. If delivered: emit financial events.
//  6. UPDATE order.status.
//  7. INSERT order_timeline entry.
//  8. LogSync activity.
func (s *Service) ChangeStatus(ctx context.Context, actorID uuid.UUID, actorRole string, orderID uuid.UUID, req ChangeStatusRequest) (*Order, error) {
	if !req.Status.IsValid() {
		return nil, apperrors.BadRequest("invalid status value")
	}

	var updated *Order

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		o, err := s.repo.GetByIDForUpdate(tx, ctx, orderID)
		if err != nil {
			return err
		}
		if o == nil {
			return apperrors.NotFound("order")
		}

		from := o.Status
		to := req.Status

		// ── State machine check ───────────────────────────────────────────────
		if !CanTransition(from, to) {
			return apperrors.BadRequest(fmt.Sprintf("invalid transition: %s → %s", from, to))
		}

		// ── Role permission check (Corrections 6 & 7) ─────────────────────────
		if err := s.validateTransitionRole(actorRole, actorID, o, from, to); err != nil {
			return err
		}

		// ── Inventory side effects ────────────────────────────────────────────
		if to == StatusCancelled || to == StatusReturned {
			if err := s.releaseInventory(ctx, tx, o); err != nil {
				return err
			}
		} else if to == StatusDelivered {
			if err := s.deductInventory(ctx, tx, o, actorID); err != nil {
				return err
			}
		}

		// ── Financial events on delivery ──────────────────────────────────────
		if to == StatusDelivered {
			snap, err := s.compSvc.GetSnapshotByOrderID(ctx, orderID)
			if err != nil {
				return fmt.Errorf("load snapshot: %w", err)
			}
			// Auto-create snapshot if missing but order has all required data.
			if snap == nil && o.SnapshotID == nil {
				hier, herr := s.resolveHierarchy(ctx, o.SellerID)
				if herr != nil {
					return apperrors.Unprocessable("order has no financial snapshot and hierarchy resolution failed")
				}
				snap, err = s.compSvc.BuildSnapshot(ctx, tx, compensation.SnapshotInput{
					OrderID:        &orderID,
					SellerID:       &o.SellerID,
					ManagerID:      hier.managerID,
					ManagerTeamID:  hier.managerTeamID,
					TeamLeadID:     hier.teamLeadID,
					TeamLeadTeamID: hier.teamLeadTeamID,
					OrderTotal:     o.TotalAmount,
					ResolvedAt:     time.Now().UTC(),
				})
				if err != nil {
					return apperrors.Unprocessable("order has no financial snapshot and auto-creation failed: " + err.Error())
				}
				if err := tx.WithContext(ctx).Model(&Order{}).Where("id = ?", orderID).
					UpdateColumn("snapshot_id", snap.ID).Error; err != nil {
					return fmt.Errorf("link auto-created snapshot: %w", err)
				}
			}
			if snap == nil {
				return apperrors.Unprocessable("order has no financial snapshot — cannot deliver")
			}
			if err := s.emitFinancialEvents(ctx, tx, o, snap); err != nil {
				return err
			}
		}

		// ── Update status ─────────────────────────────────────────────────────
		if err := s.repo.UpdateStatus(ctx, tx, orderID, to); err != nil {
			return err
		}
		o.Status = to

		// ── Release courier assignment on backward transitions (C1 fix) ───────
		// Moving an order back to confirmed/new means the courier no longer holds
		// it. Deactivate the active assignment + clear the courier_id cache in the
		// same transaction so the order can be re-assigned and never gets stuck.
		if to == StatusConfirmed || to == StatusNew {
			released, rerr := s.repo.ReleaseAssignment(ctx, tx, orderID)
			if rerr != nil {
				return rerr
			}
			if released > 0 {
				o.CourierID = nil
				releaseReason := fmt.Sprintf("assignment released on %s → %s", from, to)
				if err := s.logger.LogSync(tx, activity.Entry{
					ActorID:    &actorID,
					Action:     "assignment_released",
					EntityType: "order",
					EntityID:   &orderID,
					Reason:     &releaseReason,
				}); err != nil {
					return err
				}
			}
		}

		// ── Timeline entry ────────────────────────────────────────────────────
		tl := &OrderTimeline{
			ID:         uuid.New(),
			OrderID:    orderID,
			FromStatus: &from,
			ToStatus:   to,
			Comment:    req.Comment,
			CreatedBy:  actorID,
		}
		if err := s.repo.CreateTimelineEntry(ctx, tx, tl); err != nil {
			return err
		}

		// ── Activity log ──────────────────────────────────────────────────────
		reason := fmt.Sprintf("%s → %s", from, to)
		if err := s.logger.LogSync(tx, activity.Entry{
			ActorID:     &actorID,
			Action:      "status_change",
			EntityType:  "order",
			EntityID:    &orderID,
			BeforeState: map[string]interface{}{"status": from},
			AfterState:  map[string]interface{}{"status": to},
			Reason:      &reason,
		}); err != nil {
			return err
		}

		updated = o
		return nil
	})

	if txErr != nil {
		return nil, txErr
	}
	return updated, nil
}

// ─── Prepayments ──────────────────────────────────────────────────────────────

// AddPrepayment records a partial payment and updates orders.prepayment_amount.
// Total prepayments cannot exceed order total_amount.
func (s *Service) AddPrepayment(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, req AddPrepaymentRequest) (*OrderPrepayment, error) {
	var created *OrderPrepayment

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		o, err := s.repo.GetByIDForUpdate(tx, ctx, orderID)
		if err != nil {
			return err
		}
		if o == nil {
			return apperrors.NotFound("order")
		}
		if o.Status.IsTerminal() {
			return apperrors.BadRequest("cannot add prepayment to a terminal order")
		}

		// Validate total will not exceed order amount.
		existingTotal, err := s.repo.SumPrepayments(ctx, tx, orderID)
		if err != nil {
			return err
		}
		if existingTotal+req.Amount > o.TotalAmount {
			return apperrors.BadRequest(fmt.Sprintf(
				"total prepayments (%.2f) would exceed order total (%.2f)",
				existingTotal+req.Amount, o.TotalAmount,
			))
		}

		p := &OrderPrepayment{
			ID:        uuid.New(),
			OrderID:   orderID,
			Amount:    req.Amount,
			ProofURL:  req.ProofURL,
			CreatedBy: actorID,
		}
		if err := s.repo.CreatePrepayment(ctx, tx, p); err != nil {
			return err
		}
		if err := s.repo.UpdatePrepaymentAmount(ctx, tx, orderID, req.Amount); err != nil {
			return err
		}

		s.logger.LogAsync(activity.Entry{
			ActorID:    &actorID,
			Action:     "prepayment",
			EntityType: "order",
			EntityID:   &orderID,
			AfterState: map[string]interface{}{"amount": req.Amount},
		})

		created = p
		return nil
	})

	if txErr != nil {
		return nil, txErr
	}
	return created, nil
}

func (s *Service) ListPrepayments(ctx context.Context, orderID uuid.UUID) ([]OrderPrepayment, error) {
	if _, err := s.GetByID(ctx, orderID); err != nil {
		return nil, err
	}
	return s.repo.ListPrepayments(ctx, orderID)
}

// ─── Prepayment verification ───────────────────────────────────────────────────

func (s *Service) VerifyPrepayment(ctx context.Context, actorID uuid.UUID, actorRole string, orderID uuid.UUID, req VerifyPrepaymentRequest) (*Order, error) {
	if actorRole != "dispatcher" && actorRole != "owner" {
		return nil, apperrors.Forbidden("only dispatcher or owner can verify prepayment")
	}

	var result *Order
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		o, err := s.repo.GetByIDForUpdate(tx, ctx, orderID)
		if err != nil {
			return err
		}
		if o == nil {
			return apperrors.NotFound("order")
		}
		if o.PrepaymentStatus != PrepaymentStatusPendingVerification {
			return apperrors.BadRequest("order prepayment is not pending verification")
		}

		now := time.Now().UTC()
		updates := map[string]interface{}{
			"prepayment_status":      PrepaymentStatusVerified,
			"prepayment_verified_by": actorID,
			"prepayment_verified_at": now,
			"status":                 StatusConfirmed,
		}
		if req.Comment != nil {
			updates["prepayment_comment"] = req.Comment
		}
		if err := tx.WithContext(ctx).Model(&Order{}).Where("id = ?", orderID).Updates(updates).Error; err != nil {
			return fmt.Errorf("verify prepayment: %w", err)
		}

		// Timeline entry for the confirm transition.
		fromStatus := o.Status
		tl := &OrderTimeline{
			ID:         uuid.New(),
			OrderID:    orderID,
			FromStatus: &fromStatus,
			ToStatus:   StatusConfirmed,
			Comment:    req.Comment,
			CreatedBy:  actorID,
		}
		if err := s.repo.CreateTimelineEntry(ctx, tx, tl); err != nil {
			return err
		}

		s.logger.LogAsync(activity.Entry{
			ActorID:    &actorID,
			Action:     "verify_prepayment",
			EntityType: "order",
			EntityID:   &orderID,
		})

		loaded, err := s.repo.GetByIDForUpdate(tx, ctx, orderID)
		if err != nil {
			return err
		}
		result = loaded
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return result, nil
}

func (s *Service) RejectPrepayment(ctx context.Context, actorID uuid.UUID, actorRole string, orderID uuid.UUID, req RejectPrepaymentRequest) (*Order, error) {
	if actorRole != "dispatcher" && actorRole != "owner" {
		return nil, apperrors.Forbidden("only dispatcher or owner can reject prepayment")
	}
	if req.Reason == "" {
		return nil, apperrors.BadRequest("rejection reason is required")
	}

	var result *Order
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		o, err := s.repo.GetByIDForUpdate(tx, ctx, orderID)
		if err != nil {
			return err
		}
		if o == nil {
			return apperrors.NotFound("order")
		}
		if o.PrepaymentStatus != PrepaymentStatusPendingVerification {
			return apperrors.BadRequest("order prepayment is not pending verification")
		}

		updates := map[string]interface{}{
			"prepayment_status":           PrepaymentStatusRejected,
			"prepayment_rejection_reason": req.Reason,
		}
		if err := tx.WithContext(ctx).Model(&Order{}).Where("id = ?", orderID).Updates(updates).Error; err != nil {
			return fmt.Errorf("reject prepayment: %w", err)
		}

		s.logger.LogAsync(activity.Entry{
			ActorID:    &actorID,
			Action:     "reject_prepayment",
			EntityType: "order",
			EntityID:   &orderID,
			AfterState: map[string]interface{}{"reason": req.Reason},
		})

		loaded, err := s.repo.GetByIDForUpdate(tx, ctx, orderID)
		if err != nil {
			return err
		}
		result = loaded
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return result, nil
}

// ─── Attachment helpers ────────────────────────────────────────────────────────

func (s *Service) ListAttachments(ctx context.Context, orderID uuid.UUID) ([]OrderAttachment, error) {
	if _, err := s.GetByID(ctx, orderID); err != nil {
		return nil, err
	}
	var attachments []OrderAttachment
	if err := s.db.WithContext(ctx).Where("order_id = ?", orderID).Order("created_at").Find(&attachments).Error; err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}
	return attachments, nil
}

func (s *Service) AddAttachment(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, fileType, fileURL string) (*OrderAttachment, error) {
	if _, err := s.GetByID(ctx, orderID); err != nil {
		return nil, err
	}
	att := &OrderAttachment{
		ID:         uuid.New(),
		OrderID:    orderID,
		Type:       fileType,
		FileURL:    fileURL,
		UploadedBy: actorID,
	}
	if err := s.db.WithContext(ctx).Create(att).Error; err != nil {
		return nil, fmt.Errorf("create attachment: %w", err)
	}
	return att, nil
}

// ─── Inventory helpers ─────────────────────────────────────────────────────────

// releaseInventory decrements reserved_quantity for each item without touching quantity.
// Called when order is cancelled or returned.
func (s *Service) releaseInventory(ctx context.Context, tx *gorm.DB, o *Order) error {
	for _, it := range o.Items {
		inv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, o.WarehouseID, it.ProductID)
		if err != nil {
			return fmt.Errorf("release inventory lock: %w", err)
		}
		newReserved := inv.ReservedQuantity - it.Quantity
		if newReserved < 0 {
			newReserved = 0 // guard against data inconsistency
		}
		if err := s.invRepo.UpdateReservedQuantity(tx, ctx, inv.ID, newReserved); err != nil {
			return fmt.Errorf("release inventory: %w", err)
		}
	}
	return nil
}

// deductInventory decrements both quantity and reserved_quantity, writes a sale
// movement, and consumes FIFO batches. Called ONLY when order is delivered.
//
// quantity        -= item.quantity
// reserved_quantity -= item.quantity
// movement type    = sale
// batch consumption = FIFO
func (s *Service) deductInventory(ctx context.Context, tx *gorm.DB, o *Order, actorID uuid.UUID) error {
	for _, it := range o.Items {
		inv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, o.WarehouseID, it.ProductID)
		if err != nil {
			return fmt.Errorf("deduct inventory lock: %w", err)
		}
		if inv.ReservedQuantity < it.Quantity {
			return apperrors.BadRequest(fmt.Sprintf(
				"inventory inconsistency: reserved %d < item qty %d for product %s",
				inv.ReservedQuantity, it.Quantity, it.ProductID,
			))
		}

		prevQty := inv.Quantity
		newQty := prevQty - it.Quantity
		newReserved := inv.ReservedQuantity - it.Quantity

		// Decrement reserved first so available_quantity never goes negative.
		if err := s.invRepo.UpdateReservedQuantity(tx, ctx, inv.ID, newReserved); err != nil {
			return fmt.Errorf("deduct reserved: %w", err)
		}
		if err := s.invRepo.UpdateQuantity(tx, ctx, inv.ID, newQty); err != nil {
			return fmt.Errorf("deduct quantity: %w", err)
		}

		// Insert sale movement (quantity always positive; direction = sale = subtract).
		m := &inventory.Movement{
			ID:               uuid.New(),
			WarehouseID:      o.WarehouseID,
			ProductID:        it.ProductID,
			MovementType:     inventory.MovementSale,
			Quantity:         it.Quantity,
			PreviousQuantity: prevQty,
			NewQuantity:      newQty,
			CreatedBy:        actorID,
		}
		orderIDStr := o.ID.String()
		reason := "order delivered: " + orderIDStr
		m.Reason = &reason
		if err := s.invRepo.InsertMovement(tx, ctx, m); err != nil {
			return fmt.Errorf("insert sale movement: %w", err)
		}
		if _, err := s.invRepo.ConsumeFIFO(tx, ctx, o.WarehouseID, it.ProductID, it.Quantity, m.ID); err != nil {
			return fmt.Errorf("sale FIFO consume: %w", err)
		}
	}
	return nil
}

// ─── Role-based validation helpers ────────────────────────────────────────────

// validateOrderTypeForRole ensures the actor can create the requested order type.
//
// Correction 6:
//
//	seller        → seller_order only
//	manager       → manager_personal_order only
//	sales_team_lead → team_lead_personal_order only
//	owner         → any type
func (s *Service) validateOrderTypeForRole(role string, ot OrderType) error {
	switch role {
	case "seller":
		if ot != OrderTypeSeller {
			return apperrors.Forbidden("sellers can only create seller_order")
		}
	case "manager":
		if ot != OrderTypeManagerPersonal {
			return apperrors.Forbidden("managers can only create manager_personal_order")
		}
	case "sales_team_lead":
		if ot != OrderTypeTeamLeadPersonal {
			return apperrors.Forbidden("sales team leads can only create team_lead_personal_order")
		}
	case "owner":
		// owner may create any type
	default:
		return apperrors.Forbidden("your role cannot create orders")
	}
	return nil
}

// validateTransitionRole checks that the actor's role permits the specific transition.
//
// Corrections 6 & 7 applied:
//
//	new → confirmed:   dispatcher, owner
//	new → cancelled:   seller (own order only), dispatcher, owner, manager, sales_team_lead
//	confirmed → *:     dispatcher, owner
//	* → cancelled:     dispatcher, owner
//	in_delivery → *:   dispatcher, owner  (courier added in Phase 5)
//	owner:             override all
func (s *Service) validateTransitionRole(role string, actorID uuid.UUID, o *Order, from, to OrderStatus) error {
	if role == "owner" {
		return nil // owner overrides everything
	}

	// Seller can cancel their OWN order only while it is still new.
	if role == "seller" && to == StatusCancelled && from == StatusNew && o.SellerID == actorID {
		return nil
	}

	switch from {
	case StatusNew:
		switch to {
		case StatusConfirmed:
			if role != "dispatcher" {
				return apperrors.Forbidden("only dispatcher or owner can confirm orders")
			}
		case StatusCancelled:
			if role != "dispatcher" && role != "manager" && role != "sales_team_lead" {
				return apperrors.Forbidden("you do not have permission to cancel this order")
			}
		}

	case StatusConfirmed, StatusPrepaymentPending, StatusPrepaymentReceived:
		if role != "dispatcher" {
			return apperrors.Forbidden("only dispatcher or owner can advance order from " + string(from))
		}

	case StatusAssigned:
		// Courier may start delivery only if they hold the active assignment (verified via cache).
		if role == "courier" {
			if o.CourierID == nil || *o.CourierID != actorID {
				return apperrors.Forbidden("you are not the assigned courier for this order")
			}
			return nil
		}
		if role != "dispatcher" {
			return apperrors.Forbidden("only dispatcher, assigned courier, or owner can advance from assigned")
		}

	case StatusInDelivery:
		// Courier may mark delivered / returned / issue only for their own assigned order.
		if role == "courier" {
			if o.CourierID == nil || *o.CourierID != actorID {
				return apperrors.Forbidden("you are not the assigned courier for this order")
			}
			return nil
		}
		if role != "dispatcher" {
			return apperrors.Forbidden("only dispatcher, assigned courier, or owner can transition in-delivery orders")
		}

	case StatusIssue:
		if role != "dispatcher" {
			return apperrors.Forbidden("only dispatcher or owner can resolve issue status")
		}
	}

	return nil
}
