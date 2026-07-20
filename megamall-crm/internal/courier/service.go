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
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/orders"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// MediaAssetInfo is what an external media-pipeline integration reports
// about a cash-handover proof asset — deliberately a plain, local struct
// rather than importing internal/media's own types directly, mirroring
// internal/orders.MediaAssetInfo's import-cycle reasoning. Unlike orders'
// single-asset-per-slot version, this carries an ID: a handover can hold up
// to 5 proof assets with no FK column of its own (see CashHandover's doc
// comment), so the asset's own ID is the only handle callers have on each
// one.
type MediaAssetInfo struct {
	ID     uuid.UUID
	Width  *int
	Height *int
}

// AttachCashHandoverProofFn claims a previously-uploaded, unattached media
// asset (category cash_handover_proof) as one of handoverID's proof images.
// Returns (wrapped, check with errors.Is) ErrMediaAssetNotFound /
// ErrMediaCategoryMismatch / ErrMediaAlreadyAttached for the caller to map
// via mediaAttachError.
// actorID must be the asset's own uploader (see
// media.Service.AttachToOwner) — the courier submitting the handover.
type AttachCashHandoverProofFn func(ctx context.Context, assetID, handoverID, actorID uuid.UUID) (*MediaAssetInfo, error)

// ListCashHandoverProofsFn returns every media asset currently attached to
// handoverID — the only way to enumerate a handover's proofs, since there
// is no media_asset_id column on cash_handovers; the asset rows' own
// owner_entity_type/owner_entity_id is the link.
type ListCashHandoverProofsFn func(ctx context.Context, handoverID uuid.UUID) ([]MediaAssetInfo, error)

// ReleaseMediaFn quarantines a previously-attached (or attach-then-
// abandoned) media asset — the compensating action for a failed
// SubmitHandover, wired to internal/media.Service.ReleaseByID in main.go.
type ReleaseMediaFn func(ctx context.Context, assetID uuid.UUID) error

// SignedMediaURLFn mints a fresh, short-lived signed URL for a private
// media asset's given variant. Never cached or persisted. Returns "" if the
// asset can no longer be resolved (e.g. quarantined).
type SignedMediaURLFn func(ctx context.Context, assetID uuid.UUID, variant string) string

// Sentinel errors an AttachCashHandoverProofFn implementation should wrap so
// mediaAttachError can map them to the right client-facing response.
var (
	ErrMediaAssetNotFound    = errors.New("media asset not found")
	ErrMediaCategoryMismatch = errors.New("media asset category mismatch")
	ErrMediaAlreadyAttached  = errors.New("media asset is already attached")
)

// MaxCashHandoverProofs is the maximum number of media-pipeline proof
// images a single handover may carry, enforced in SubmitHandover.
const MaxCashHandoverProofs = 5

type Service struct {
	repo      *Repository
	ordersSvc *orders.Service
	logger    *activity.Logger
	db        *gorm.DB

	// attachCashHandoverProof/listCashHandoverProofs/releaseMedia/
	// signedMediaURL are nil when MEDIA_PIPELINE_ENABLED=false — see
	// requireMedia. Set via SetMediaAdapters after construction (mirrors
	// internal/orders.Service.SetMediaAdapters).
	attachCashHandoverProof AttachCashHandoverProofFn
	listCashHandoverProofs  ListCashHandoverProofsFn
	releaseMedia            ReleaseMediaFn
	signedMediaURL          SignedMediaURLFn
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

// SetMediaAdapters injects the media-pipeline adapters after construction —
// called from main.go once *media.Service exists (inside the "if
// cfg.Media.Enabled" block). All four adapters stay nil when the pipeline
// is disabled — see requireMedia.
func (s *Service) SetMediaAdapters(attach AttachCashHandoverProofFn, list ListCashHandoverProofsFn, release ReleaseMediaFn, signedURL SignedMediaURLFn) {
	s.attachCashHandoverProof = attach
	s.listCashHandoverProofs = list
	s.releaseMedia = release
	s.signedMediaURL = signedURL
}

// requireMedia returns a clear, user-facing error when the caller supplied
// a media-pipeline-backed field but the pipeline is disabled.
func (s *Service) requireMedia() error {
	if s.attachCashHandoverProof == nil {
		return apperrors.BadRequest("the media pipeline is not enabled")
	}
	return nil
}

// mediaAttachError maps AttachCashHandoverProofFn's sentinel errors to the
// appropriate client-facing AppError.
func mediaAttachError(err error) error {
	switch {
	case errors.Is(err, ErrMediaAssetNotFound):
		return apperrors.BadRequest("referenced upload was not found or has already been used")
	case errors.Is(err, ErrMediaCategoryMismatch):
		return apperrors.BadRequest("referenced upload is not the expected media category")
	case errors.Is(err, ErrMediaAlreadyAttached):
		return apperrors.Conflict("referenced upload is already attached")
	default:
		return err
	}
}

// releaseAndLog quarantines a media asset as a compensating action,
// logging (never failing the caller's own operation on) an error.
func (s *Service) releaseAndLog(ctx context.Context, assetID uuid.UUID) {
	if err := s.releaseMedia(ctx, assetID); err != nil {
		log.Printf("[courier] failed to release media asset %s during rollback: %v", assetID, err)
	}
}

// resolveCashHandoverProofs lists handoverID's attached media-pipeline proof
// assets and mints a fresh signed URL for each — never persisted, resolved
// on every read. Returns nil (not an error) when the pipeline is disabled,
// the handover has no pipeline-backed proofs, or a lookup fails — callers
// still have the legacy ProofURL/AttachmentsJSON fields either way.
func (s *Service) resolveCashHandoverProofs(ctx context.Context, handoverID uuid.UUID) []HandoverMediaAsset {
	if s.listCashHandoverProofs == nil {
		return nil
	}
	infos, err := s.listCashHandoverProofs(ctx, handoverID)
	if err != nil {
		log.Printf("[courier] failed to list cash handover proofs for %s: %v", handoverID, err)
		return nil
	}
	assets := make([]HandoverMediaAsset, 0, len(infos))
	for _, info := range infos {
		if s.signedMediaURL == nil {
			continue
		}
		url := s.signedMediaURL(ctx, info.ID, "preview")
		if url == "" {
			continue
		}
		thumbURL := s.signedMediaURL(ctx, info.ID, "thumb")
		assets = append(assets, HandoverMediaAsset{ID: info.ID, URL: url, ThumbURL: thumbURL, Width: info.Width, Height: info.Height})
	}
	return assets
}

// ResolveCashHandoverMediaAssets is the public entry point for callers that
// only have a handover ID (e.g. internal/dispatch's cash-transactions list,
// which projects rows via a raw SQL join rather than loading a full
// *CashHandover) — see resolveCashHandoverProofs for behavior.
func (s *Service) ResolveCashHandoverMediaAssets(ctx context.Context, handoverID uuid.UUID) []HandoverMediaAsset {
	return s.resolveCashHandoverProofs(ctx, handoverID)
}

// ToHandoverResponse builds h's client-facing response, including a
// freshly-resolved MediaAssets list — the one entry point handlers
// (internal/courier and internal/dispatch, which delegates to this service)
// should use instead of calling HandoverToResponse directly, so pipeline-
// backed proofs are never missing from the response.
func (s *Service) ToHandoverResponse(ctx context.Context, h *CashHandover) HandoverResponse {
	resp := HandoverToResponse(h)
	resp.MediaAssets = s.resolveCashHandoverProofs(ctx, h.ID)
	return resp
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
//     returns = collected - courier_payout because the courier keeps their delivery salary.
//  3. Sum totals.
//  4. Create CashHandover + CashHandoverOrder rows in one transaction.
func (s *Service) SubmitHandover(ctx context.Context, courierID uuid.UUID, req SubmitHandoverRequest) (*CashHandover, error) {
	if len(req.MediaAssetIDs) > MaxCashHandoverProofs {
		return nil, apperrors.BadRequest(fmt.Sprintf("at most %d cash-handover proof images may be attached", MaxCashHandoverProofs))
	}

	// ── Proof assets: attached BEFORE the transaction ──────────────────────
	// A media-pipeline attach is a separate service call with its own DB
	// write, so it can't participate in this transaction — see
	// internal/orders.Service.Create's identical pre-attach comment.
	// handoverID is generated here (rather than inside the transaction, as
	// before) so it can be used as the owner_entity_id for these
	// pre-attaches.
	handoverID := uuid.New()
	var attachedAssetIDs []uuid.UUID
	if len(req.MediaAssetIDs) > 0 {
		if err := s.requireMedia(); err != nil {
			return nil, err
		}
		for _, assetID := range req.MediaAssetIDs {
			if _, err := s.attachCashHandoverProof(ctx, assetID, handoverID, courierID); err != nil {
				for _, attached := range attachedAssetIDs {
					s.releaseAndLog(ctx, attached)
				}
				return nil, mediaAttachError(err)
			}
			attachedAssetIDs = append(attachedAssetIDs, assetID)
		}
	}

	var created *CashHandover

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Must run before the eligibility check, as its own statement — see
		// LockCourierForHandover's doc comment for why a plain row lock on
		// orders can't prevent a duplicate handover here.
		if err := s.repo.LockCourierForHandover(tx, ctx, courierID); err != nil {
			return err
		}

		eligible, err := s.repo.FindEligibleHandoverOrders(tx, ctx, courierID)
		if err != nil {
			return err
		}
		if len(eligible) == 0 {
			return apperrors.BadRequest("no eligible delivered orders found for handover")
		}

		// handoverID was generated before this transaction started (see the
		// pre-attach comment above), not here.
		var totalCollected, totalFees, totalReturn float64
		lines := make([]CashHandoverOrder, 0, len(eligible))

		for _, o := range eligible {
			// collected = what the courier physically received from the client
			// (product + client delivery fee − prepayment).
			collected := o.TotalAmount + o.DeliveryFee - o.PrepaymentAmount
			if collected < 0 {
				collected = 0
			}
			// returns = client cash minus the courier's delivery salary. The salary
			// is stored as courier_payout and is kept from the collected cash.
			courierSalary := o.CourierPayout
			returns := collected - courierSalary
			if returns < 0 {
				returns = 0
			}

			totalCollected += collected
			totalFees += courierSalary
			totalReturn += returns

			lines = append(lines, CashHandoverOrder{
				ID:               uuid.New(),
				HandoverID:       handoverID,
				OrderID:          o.ID,
				OrderTotal:       o.TotalAmount,
				PrepaymentAmount: o.PrepaymentAmount,
				CourierCollected: collected,
				DeliveryFee:      courierSalary,
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
		// The handover never persisted — release any media assets
		// pre-attached above so they don't linger claimed-but-orphaned.
		for _, attached := range attachedAssetIDs {
			s.releaseAndLog(ctx, attached)
		}
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
