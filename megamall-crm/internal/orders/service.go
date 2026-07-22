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
	"errors"
	"fmt"
	"log"
	"strings"
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
	"github.com/megamall/crm/pkg/rbac"
	"gorm.io/gorm"
)

// SellerLookupResult is the cross-module view of a candidate seller, used to
// validate an owner-supplied seller_id without injecting the whole users
// repository.
type SellerLookupResult struct {
	IsActive bool
	Role     string
}

// SellerLookupFn is an injected dependency to look up a user's active status
// and role across the module boundary, for owner-order seller validation.
// Returns (nil, nil) if no such user exists.
type SellerLookupFn func(ctx context.Context, id uuid.UUID) (*SellerLookupResult, error)

// MediaAssetInfo is what an external media-pipeline integration reports
// about a freshly-attached media asset (order attachment or prepayment
// proof). Deliberately a plain, local struct rather than importing
// internal/media's own types directly — see internal/products/service.go's
// MediaAssetInfo doc comment for the import-cycle reasoning this mirrors.
type MediaAssetInfo struct {
	Width  *int
	Height *int
}

// AttachOrderAttachmentFn claims a previously-uploaded, unattached media
// asset (category order_attachment) as orderID's attachment. actorID must
// be the asset's own uploader (see media.Service.AttachToOwner) — the
// caller creating/updating the order, not necessarily anything else.
// Returns (wrapped, check with errors.Is) ErrMediaAssetNotFound /
// ErrMediaCategoryMismatch / ErrMediaAlreadyAttached for the caller to map
// via mediaAttachError.
type AttachOrderAttachmentFn func(ctx context.Context, assetID, orderID, actorID uuid.UUID) (*MediaAssetInfo, error)

// AttachPrepaymentProofFn claims a previously-uploaded, unattached media
// asset (category prepayment_proof) as orderID's prepayment proof. Same
// sentinel-error contract and actorID semantics as AttachOrderAttachmentFn.
type AttachPrepaymentProofFn func(ctx context.Context, assetID, orderID, actorID uuid.UUID) (*MediaAssetInfo, error)

// ReleaseMediaFn quarantines a previously-attached (or attach-then-
// abandoned) media asset — the compensating action for a failed
// create/update, wired to internal/media.Service.ReleaseByID in main.go.
type ReleaseMediaFn func(ctx context.Context, assetID uuid.UUID) error

// SignedMediaURLFn mints a fresh, short-lived signed URL for a private
// media asset's given variant ("preview" for images, "" for the original).
// Never cached or persisted — resolved on every call, since signed URLs
// expire after MediaConfig.SignedURLTTL. Returns "" if the asset can no
// longer be resolved (e.g. quarantined): callers fall back to the legacy
// URL column in that case rather than failing the whole request.
type SignedMediaURLFn func(ctx context.Context, assetID uuid.UUID, variant string) string

// Sentinel errors an AttachOrderAttachmentFn/AttachPrepaymentProofFn
// implementation should wrap so mediaAttachError can map them to the right
// client-facing response.
var (
	ErrMediaAssetNotFound    = errors.New("media asset not found")
	ErrMediaCategoryMismatch = errors.New("media asset category mismatch")
	ErrMediaAlreadyAttached  = errors.New("media asset is already attached")
)

// Service encapsulates all order business logic.
type Service struct {
	repo         *Repository
	invRepo      *inventory.Repository
	hierRepo     *hierarchy.Repository
	teamRepo     *teams.Repository
	compSvc      *compensation.Service
	logger       *activity.Logger
	db           *gorm.DB
	sellerLookup SellerLookupFn

	// attachOrderAttachment/attachPrepaymentProof/releaseMedia/
	// signedMediaURL are nil when MEDIA_PIPELINE_ENABLED=false — see
	// requireMedia. Set via SetMediaAdapters after construction (mirrors
	// internal/users.Service.SetMediaAdapters — see its doc comment for why
	// a post-construction setter is used instead of constructor params).
	attachOrderAttachment AttachOrderAttachmentFn
	attachPrepaymentProof AttachPrepaymentProofFn
	releaseMedia          ReleaseMediaFn
	signedMediaURL        SignedMediaURLFn
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
	sellerLookup SellerLookupFn,
) *Service {
	return &Service{
		repo:         repo,
		invRepo:      invRepo,
		hierRepo:     hierRepo,
		teamRepo:     teamRepo,
		compSvc:      compSvc,
		logger:       logger,
		db:           db,
		sellerLookup: sellerLookup,
	}
}

// SetMediaAdapters injects the media-pipeline adapters after construction —
// called from main.go once *media.Service exists (inside the "if
// cfg.Media.Enabled" block). All four adapters stay nil when the pipeline
// is disabled — see requireMedia.
func (s *Service) SetMediaAdapters(attachOrderAttachment AttachOrderAttachmentFn, attachPrepaymentProof AttachPrepaymentProofFn, releaseMedia ReleaseMediaFn, signedMediaURL SignedMediaURLFn) {
	s.attachOrderAttachment = attachOrderAttachment
	s.attachPrepaymentProof = attachPrepaymentProof
	s.releaseMedia = releaseMedia
	s.signedMediaURL = signedMediaURL
}

// requireMedia returns a clear, user-facing error when the caller supplied
// a media-pipeline-backed field but the pipeline is disabled.
func (s *Service) requireMedia() error {
	if s.attachOrderAttachment == nil {
		return apperrors.BadRequest("the media pipeline is not enabled")
	}
	return nil
}

// mediaAttachError maps Attach*Fn's sentinel errors to the appropriate
// client-facing AppError.
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
// logging (never failing the caller's own operation on) an error — mirrors
// internal/products/service.go's releaseAndLog exactly.
func (s *Service) releaseAndLog(ctx context.Context, assetID uuid.UUID) {
	if err := s.releaseMedia(ctx, assetID); err != nil {
		log.Printf("[orders] failed to release media asset %s during rollback: %v", assetID, err)
	}
}

// resolveAttachmentURL mints a fresh signed URL for a's FileURL when it's
// pipeline-backed, overwriting the in-memory copy before it's serialized —
// never persisted back to the DB. Falls back to the stored legacy FileURL
// if the pipeline is disabled or the asset can no longer be resolved.
func (s *Service) resolveAttachmentURL(ctx context.Context, a *OrderAttachment) {
	if a.MediaAssetID == nil || s.signedMediaURL == nil {
		return
	}
	if url := s.signedMediaURL(ctx, *a.MediaAssetID, "preview"); url != "" {
		a.FileURL = url
	}
}

// resolvePrepaymentURL is resolveAttachmentURL's counterpart for
// OrderPrepayment.
func (s *Service) resolvePrepaymentURL(ctx context.Context, p *OrderPrepayment) {
	if p.MediaAssetID == nil || s.signedMediaURL == nil {
		return
	}
	if url := s.signedMediaURL(ctx, *p.MediaAssetID, "preview"); url != "" {
		p.ProofURL = &url
	}
}

// prepareOrderAttachment resolves one attachment slot (e.g. payment-proof
// or customer-chat) from a (legacy URL, media asset ID) pair into a
// ready-to-insert *OrderAttachment — exactly one of url/mediaAssetID may be
// set; both unset means the slot is untouched (returns nil, nil). When
// mediaAssetID is set, this attaches the asset (category order_attachment)
// immediately — the caller is responsible for releasing it via
// releaseAndLog if the surrounding operation subsequently fails, since
// attach happens outside (before) any enclosing DB transaction.
func (s *Service) prepareOrderAttachment(ctx context.Context, orderID, actorID uuid.UUID, fileType string, url *string, mediaAssetID *uuid.UUID) (*OrderAttachment, error) {
	hasURL := url != nil && strings.TrimSpace(*url) != ""
	hasAsset := mediaAssetID != nil
	if hasURL && hasAsset {
		return nil, apperrors.BadRequest(fmt.Sprintf("exactly one of a legacy URL or media_asset_id may be set for %s", fileType))
	}
	if !hasURL && !hasAsset {
		return nil, nil
	}

	att := &OrderAttachment{ID: uuid.New(), OrderID: orderID, Type: fileType, UploadedBy: actorID}
	if hasURL {
		att.FileURL = strings.TrimSpace(*url)
		return att, nil
	}

	if err := s.requireMedia(); err != nil {
		return nil, err
	}
	info, attachErr := s.attachOrderAttachment(ctx, *mediaAssetID, orderID, actorID)
	if attachErr != nil {
		return nil, mediaAttachError(attachErr)
	}
	att.MediaAssetID = mediaAssetID
	att.Width = info.Width
	att.Height = info.Height
	return att, nil
}

// preparePrepaymentProof is prepareOrderAttachment's counterpart for a
// prepayment's proof (category prepayment_proof) — same "exactly one of
// url/mediaAssetID, both unset is fine" contract, but returns the fields
// needed to populate an *OrderPrepayment rather than a whole struct, since
// AddPrepayment builds the rest of that row from other request fields.
func (s *Service) preparePrepaymentProof(ctx context.Context, orderID, actorID uuid.UUID, url *string, mediaAssetID *uuid.UUID) (proofURL *string, resolvedAssetID *uuid.UUID, width, height *int, err error) {
	hasURL := url != nil && strings.TrimSpace(*url) != ""
	hasAsset := mediaAssetID != nil
	if hasURL && hasAsset {
		return nil, nil, nil, nil, apperrors.BadRequest("exactly one of proof_url or media_asset_id may be set")
	}
	if hasURL {
		trimmed := strings.TrimSpace(*url)
		return &trimmed, nil, nil, nil, nil
	}
	if !hasAsset {
		return nil, nil, nil, nil, nil
	}

	if reqErr := s.requireMedia(); reqErr != nil {
		return nil, nil, nil, nil, reqErr
	}
	info, attachErr := s.attachPrepaymentProof(ctx, *mediaAssetID, orderID, actorID)
	if attachErr != nil {
		return nil, nil, nil, nil, mediaAttachError(attachErr)
	}
	return nil, mediaAssetID, info.Width, info.Height, nil
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

	// A team with no manager/team-lead assigned at all (both nil) is a valid,
	// pre-existing state — e.g. a newly created team awaiting staffing — and
	// must keep working exactly as before (zero rates for the unassigned role).
	// A team whose manager/team-lead ID IS set must resolve to a real, active,
	// non-deleted user — never a deleted/inactive/dangling reference. Once a
	// team lead or manager is deleted or deactivated, this fails loudly instead
	// of silently freezing commission events onto their user_id.
	if team.ManagerID != nil {
		if err := s.validateActiveAssignee(ctx, *team.ManagerID, "manager"); err != nil {
			return nil, err
		}
	}
	if team.TeamLeadID != nil {
		if err := s.validateActiveAssignee(ctx, *team.TeamLeadID, "team lead"); err != nil {
			return nil, err
		}
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

// validateActiveAssignee ensures a team's manager or team-lead reference
// (roleLabel identifies which, for the error message) resolves to a real,
// active, non-deleted user. Returns a clear business error otherwise —
// resolveHierarchy must never silently attribute a new order's commission to
// a deleted, deactivated, or dangling user reference (High-severity fix: a
// soft-deleted or deactivated team lead/manager used to stay frozen into
// every subsequent order's manager_id/team_lead_id and financial_events).
func (s *Service) validateActiveAssignee(ctx context.Context, userID uuid.UUID, roleLabel string) error {
	type row struct {
		IsActive  bool
		DeletedAt *time.Time
	}
	var rows []row
	if err := s.db.WithContext(ctx).
		Table("users").
		Select("is_active, deleted_at").
		Where("id = ?", userID).
		Find(&rows).Error; err != nil {
		return apperrors.Internal(fmt.Errorf("validate %s account: %w", roleLabel, err))
	}
	if len(rows) == 0 {
		return apperrors.Unprocessable(fmt.Sprintf(
			"team's %s account could not be found — reassign the team before creating new orders", roleLabel))
	}
	if rows[0].DeletedAt != nil {
		return apperrors.Unprocessable(fmt.Sprintf(
			"team's %s account has been deleted — reassign the team before creating new orders", roleLabel))
	}
	if !rows[0].IsActive {
		return apperrors.Unprocessable(fmt.Sprintf(
			"team's %s account is inactive — reassign the team before creating new orders", roleLabel))
	}
	return nil
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

	// Dispatcher must supply a seller_id when creating on behalf of a seller.
	if actorRole == "dispatcher" && (req.SellerID == nil || *req.SellerID == uuid.Nil) {
		return nil, apperrors.BadRequest("dispatcher must supply seller_id when creating an office order")
	}

	// Effective seller: for dispatcher it's the supplied seller_id; for owner
	// (house orders carry no seller/team attribution) and everyone else it's
	// themselves — orders.seller_id is NOT NULL, so a house order attributes
	// to the owner's own account, but no commission is paid on it (see
	// compensation.ApplyCommissionRules — OrderTypeHouseOrder pays 100% to
	// company revenue, nothing to seller/manager/team-lead).
	effectiveSellerID := actorID
	if actorRole == "dispatcher" && req.SellerID != nil && *req.SellerID != uuid.Nil {
		effectiveSellerID = *req.SellerID
	}

	// A seller/manager/team-lead must belong to a team before they (or a
	// dispatcher on their behalf) can place an order — house orders carry no
	// seller/team attribution and are exempt. This mirrors the read done in
	// resolveHierarchy but must fail fast, before any other work happens.
	if req.OrderType != OrderTypeHouse {
		sellerH, err := s.hierRepo.GetByUserID(ctx, effectiveSellerID)
		if err != nil {
			return nil, fmt.Errorf("check team membership: %w", err)
		}
		if sellerH == nil || sellerH.TeamID == nil {
			return nil, apperrors.Unprocessable("you must be assigned to a team before creating orders — ask an owner to add you to a team")
		}
	}

	// Customer must exist in the customers table.
	if req.CustomerID == uuid.Nil {
		return nil, apperrors.BadRequest("customer is required")
	}
	if err := s.validateCustomerExists(ctx, req.CustomerID); err != nil {
		return nil, err
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

	// ── Attachments: resolved/attached BEFORE the transaction ──────────────
	// A media-pipeline attach is a separate service call with its own DB
	// write (internal/media's own claim-the-asset UPDATE), so it can't
	// participate in this transaction — it's a "safely compensated"
	// operation instead (attach first, release on any later failure),
	// mirroring internal/products' attachPrimaryImageOrRollback. orderID is
	// generated here (rather than inside the transaction, as before) so it
	// can be used as the owner_entity_id for these pre-attaches.
	orderID := uuid.New()
	var pendingAttachments []*OrderAttachment
	if req.PrepaymentRequired {
		slots := []struct {
			fileType     string
			url          *string
			mediaAssetID *uuid.UUID
		}{
			{"payment_proof", req.PaymentProofURL, req.PaymentProofMediaAssetID},
			{"customer_chat", req.CustomerChatURL, req.CustomerChatMediaAssetID},
		}
		for _, slot := range slots {
			att, prepErr := s.prepareOrderAttachment(ctx, orderID, actorID, slot.fileType, slot.url, slot.mediaAssetID)
			if prepErr != nil {
				for _, prepared := range pendingAttachments {
					if prepared.MediaAssetID != nil {
						s.releaseAndLog(ctx, *prepared.MediaAssetID)
					}
				}
				return nil, prepErr
			}
			if att != nil {
				pendingAttachments = append(pendingAttachments, att)
			}
		}
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
		hier, err := s.resolveHierarchy(ctx, effectiveSellerID)
		if err != nil {
			return err
		}

		// ── Delivery fee: product-level first, global fallback ────────────────
		// If the first product has a per-product fee set, use that; otherwise
		// fall back to the global delivery_settings singleton.
		deliveryFee, err := s.resolveDeliveryFeeForItems(ctx, items, deliveryMethod)
		if err != nil {
			return fmt.Errorf("resolve delivery fee: %w", err)
		}

		// ── Financial snapshot ────────────────────────────────────────────────
		snap, err := s.compSvc.BuildSnapshot(ctx, tx, compensation.SnapshotInput{
			SellerID:       &effectiveSellerID,
			SellerTeamID:   nil,
			ManagerID:      hier.managerID,
			ManagerTeamID:  hier.managerTeamID,
			TeamLeadID:     hier.teamLeadID,
			TeamLeadTeamID: hier.teamLeadTeamID,
			DeliveryFee:    deliveryFee,
			ResolvedAt:     time.Now().UTC(),
		})
		if err != nil {
			return err
		}

		// Stored initial net_revenue; final commission events subtract courier_payout at delivery.
		netRevenue := totalAmount - deliveryFee

		// Fail-fast: validate rate sums before accepting the order.
		// Uses the same logic as the Financial Engine so there are no surprises at delivery.
		if _, err := compensation.ApplyCommissionRules(
			compensation.OrderType(req.OrderType), netRevenue, snap,
		); err != nil {
			return apperrors.Unprocessable(err.Error())
		}

		// ── Build order ───────────────────────────────────────────────────────
		// orderID was generated before this transaction started (see the
		// pre-attach comment above), not here.

		// Prepayment flow: no prepayment → auto-confirm; with prepayment → stay new, await dispatcher.
		initialStatus := StatusConfirmed
		prepaymentStatus := PrepaymentStatusNone
		if req.PrepaymentRequired {
			initialStatus = StatusNew
			prepaymentStatus = PrepaymentStatusPendingVerification
		}

		// Dispatcher can override the initial status (e.g. force "new" for office orders).
		if actorRole == "dispatcher" && req.ForceStatus != nil && *req.ForceStatus != "" {
			forced := OrderStatus(*req.ForceStatus)
			if forced == StatusNew || forced == StatusConfirmed {
				initialStatus = forced
			}
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
			SellerID:         effectiveSellerID,
			ManagerID:        hier.managerID,
			TeamLeadID:       hier.teamLeadID,
			ManagerTeamID:    hier.managerTeamID,
			TeamLeadTeamID:   hier.teamLeadTeamID,
			OrderType:        req.OrderType,
			Status:           initialStatus,
			CityID:           &req.CityID,
			SnapshotID:       &snap.ID,
			DeliveryMethod:   deliveryMethod,
			Subtotal:         subtotal,
			TotalAmount:      totalAmount,
			DeliveryFee:      deliveryFee,
			NetRevenue:       netRevenue,
			PrepaymentAmount: req.PrepaymentAmount,
			Notes:            req.Notes,
			DeliveryAddress:  req.DeliveryAddress,

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
			inv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, it.ProductID)
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
		// Already resolved/attached (legacy URL or media pipeline) before
		// this transaction started — see the pre-attach comment near the
		// top of Create. If any insert below fails, the enclosing
		// Transaction call rolls back and the caller releases any attached
		// media assets (see txErr handling after Transaction returns).
		for _, att := range pendingAttachments {
			if err := tx.WithContext(ctx).Create(att).Error; err != nil {
				return fmt.Errorf("create attachment: %w", err)
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
		for i := range loaded.Attachments {
			s.resolveAttachmentURL(ctx, &loaded.Attachments[i])
		}
		created = loaded
		return nil
	})

	if txErr != nil {
		// The order (and its attachment rows) never persisted — release
		// any media assets pre-attached above so they don't linger
		// claimed-but-orphaned.
		for _, att := range pendingAttachments {
			if att.MediaAssetID != nil {
				s.releaseAndLog(ctx, *att.MediaAssetID)
			}
		}
		return nil, txErr
	}
	return created, nil
}

// normalizeDeliveryMethod maps a request delivery method to the canonical value.
//
//	"" / "normal"      → "normal"
//	"fast" / "express" → "fast"  ("express" kept as a legacy alias)
//
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

// validateCustomerExists ensures the customer exists in the customers table.
func (s *Service) validateCustomerExists(ctx context.Context, customerID uuid.UUID) error {
	var count int64
	if err := s.db.WithContext(ctx).
		Table("customers").
		Where("id = ?", customerID).
		Count(&count).Error; err != nil {
		return apperrors.Internal(fmt.Errorf("validate customer: %w", err))
	}
	if count == 0 {
		return apperrors.BadRequest("customer not found — please re-select or create a new customer")
	}
	return nil
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
	for i := range o.Attachments {
		s.resolveAttachmentURL(ctx, &o.Attachments[i])
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

// Update applies a partial update to an order inside a transaction.
// Sellers may update notes, delivery_address, delivery_method, customer contact,
// items (triggers full inventory re-reservation and financial recalculation),
// and prepayment / attachment fields. Delivered orders are rejected.
func (s *Service) Update(ctx context.Context, actorID, orderID uuid.UUID, req UpdateOrderRequest) (*Order, error) {
	// Nil items slice  = "no change to items".
	// Empty items slice = error; order must always have at least one item.
	if req.Items != nil && len(req.Items) == 0 {
		return nil, apperrors.BadRequest("items list must not be empty when provided")
	}

	// ── Attachments: resolved/attached BEFORE the transaction ──────────────
	// See Create's identical pre-attach comment for why this can't happen
	// inside the transaction below.
	slots := []struct {
		fileType     string
		url          *string
		mediaAssetID *uuid.UUID
	}{
		{"payment_proof", req.PaymentProofURL, req.PaymentProofMediaAssetID},
		{"customer_chat", req.CustomerChatURL, req.CustomerChatMediaAssetID},
	}
	var pendingAttachments []*OrderAttachment
	for _, slot := range slots {
		att, prepErr := s.prepareOrderAttachment(ctx, orderID, actorID, slot.fileType, slot.url, slot.mediaAssetID)
		if prepErr != nil {
			for _, prepared := range pendingAttachments {
				if prepared.MediaAssetID != nil {
					s.releaseAndLog(ctx, *prepared.MediaAssetID)
				}
			}
			return nil, prepErr
		}
		if att != nil {
			pendingAttachments = append(pendingAttachments, att)
		}
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
		if o.Status == StatusDelivered {
			return apperrors.Unprocessable("Доставленный заказ больше нельзя изменить.")
		}

		// ── Snapshot old values for audit trail ──────────────────────────────
		oldAddress := o.DeliveryAddress
		oldNotes := o.Notes
		oldMethod := o.DeliveryMethod
		oldItems := make([]OrderItem, len(o.Items))
		copy(oldItems, o.Items)

		// ── Simple scalar fields ──────────────────────────────────────────────
		if req.Notes != nil {
			o.Notes = req.Notes
		}
		if req.DeliveryAddress != nil {
			o.DeliveryAddress = req.DeliveryAddress
		}

		// ── Delivery method (may change fee) ──────────────────────────────────
		newMethod := o.DeliveryMethod
		if req.DeliveryMethod != nil {
			nm, err := normalizeDeliveryMethod(*req.DeliveryMethod)
			if err != nil {
				return err
			}
			newMethod = nm
			o.DeliveryMethod = newMethod
		}

		// ── Customer contact ──────────────────────────────────────────────────
		if req.CustomerName != nil || req.CustomerPhone != nil {
			customerUpdates := map[string]interface{}{}
			if req.CustomerName != nil {
				customerUpdates["full_name"] = *req.CustomerName
			}
			if req.CustomerPhone != nil {
				customerUpdates["phone"] = *req.CustomerPhone
			}
			if err := tx.WithContext(ctx).Table("customers").
				Where("id = ?", o.CustomerID).
				Updates(customerUpdates).Error; err != nil {
				return fmt.Errorf("update customer: %w", err)
			}
		}

		// ── Items: full replacement ───────────────────────────────────────────
		if req.Items != nil {
			for _, it := range req.Items {
				if it.Quantity <= 0 {
					return apperrors.BadRequest("item quantity must be > 0")
				}
				if it.UnitPrice < 0 {
					return apperrors.BadRequest("item unit_price must be >= 0")
				}
			}

			// 1. Release old inventory reservations.
			for _, old := range o.Items {
				inv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, old.ProductID)
				if err != nil {
					return fmt.Errorf("release inventory: %w", err)
				}
				newReserved := inv.ReservedQuantity - old.Quantity
				if newReserved < 0 {
					newReserved = 0
				}
				if err := s.invRepo.UpdateReservedQuantity(tx, ctx, inv.ID, newReserved); err != nil {
					return fmt.Errorf("release inventory: %w", err)
				}
			}

			// 2. Delete old order items.
			if err := tx.WithContext(ctx).
				Where("order_id = ?", o.ID).
				Delete(&OrderItem{}).Error; err != nil {
				return fmt.Errorf("delete old items: %w", err)
			}

			// 3. Build new items + subtotal.
			subtotal := 0.0
			newItems := make([]OrderItem, 0, len(req.Items))
			for _, it := range req.Items {
				total := float64(it.Quantity) * it.UnitPrice
				subtotal += total
				newItems = append(newItems, OrderItem{
					ID:         uuid.New(),
					OrderID:    o.ID,
					ProductID:  it.ProductID,
					Quantity:   it.Quantity,
					UnitPrice:  it.UnitPrice,
					TotalPrice: total,
				})
			}

			// 4. Reserve new inventory.
			for _, it := range newItems {
				inv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, it.ProductID)
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

			// 5. Insert new items.
			if err := s.repo.CreateItems(ctx, tx, newItems); err != nil {
				return err
			}

			// 6. Recalculate financials.
			deliveryFee, err := s.resolveDeliveryFeeForItems(ctx, newItems, newMethod)
			if err != nil {
				return fmt.Errorf("resolve delivery fee: %w", err)
			}
			totalAmount := subtotal
			netRevenue := totalAmount - deliveryFee

			o.Subtotal = subtotal
			o.TotalAmount = totalAmount
			o.DeliveryFee = deliveryFee
			o.NetRevenue = netRevenue

			// Update snapshot financials.
			if o.SnapshotID != nil {
				if err := s.repo.UpdateFinancials(ctx, tx, o.ID, *o.SnapshotID, deliveryFee, netRevenue); err != nil {
					return fmt.Errorf("update financials: %w", err)
				}
			}
		}

		// ── Prepayment fields ─────────────────────────────────────────────────
		if req.PrepaymentRequired != nil {
			o.PrepaymentRequired = *req.PrepaymentRequired
		}
		if req.PrepaymentAmount != nil {
			o.PrepaymentAmount = *req.PrepaymentAmount
		}
		if req.PrepaymentReceiver != nil {
			o.PrepaymentReceiver = req.PrepaymentReceiver
		}
		if req.PrepaymentComment != nil {
			o.PrepaymentComment = req.PrepaymentComment
		}

		// ── Attachment rows ────────────────────────────────────────────────────
		// Already resolved/attached (legacy URL or media pipeline) before
		// this transaction started — see the pre-attach block above Update.
		for _, att := range pendingAttachments {
			if err := tx.WithContext(ctx).Create(att).Error; err != nil {
				return fmt.Errorf("create attachment: %w", err)
			}
		}

		if err := s.repo.Update(ctx, tx, o); err != nil {
			return err
		}

		// ── Audit trail: insert system comment per changed field ──────────────
		auditNow := time.Now().UTC()
		insertAudit := func(text string) {
			tx.WithContext(ctx).Exec(
				`INSERT INTO order_comments (id, order_id, user_id, comment, visibility, created_at)
				 VALUES (?, ?, ?, ?, 'seller_visible', ?)`,
				uuid.New(), orderID, actorID, text, auditNow,
			)
		}
		derefStr := func(p *string) string {
			if p == nil {
				return ""
			}
			return *p
		}
		methodLabel := func(m string) string {
			if m == "fast" {
				return "Быстрая доставка"
			}
			return "Обычная доставка"
		}

		if derefStr(oldAddress) != derefStr(o.DeliveryAddress) {
			insertAudit(fmt.Sprintf(
				"Изменён адрес доставки\n\nСтарый:\n%s\n\nНовый:\n%s",
				derefStr(oldAddress), derefStr(o.DeliveryAddress),
			))
		}
		if derefStr(oldNotes) != derefStr(o.Notes) {
			insertAudit(fmt.Sprintf(
				"Изменён комментарий клиента\n\nСтарый:\n%s\n\nНовый:\n%s",
				derefStr(oldNotes), derefStr(o.Notes),
			))
		}
		if oldMethod != o.DeliveryMethod {
			insertAudit(fmt.Sprintf(
				"Изменён способ доставки\n\n%s → %s",
				methodLabel(oldMethod), methodLabel(o.DeliveryMethod),
			))
		}
		if req.Items != nil {
			// Build product name map: prefer names from old items, fetch unknown from DB.
			productNames := map[uuid.UUID]string{}
			for _, it := range oldItems {
				productNames[it.ProductID] = it.ProductName
			}
			for _, it := range req.Items {
				if _, ok := productNames[it.ProductID]; !ok {
					var name string
					tx.WithContext(ctx).Table("products").Select("name").Where("id = ?", it.ProductID).Scan(&name)
					productNames[it.ProductID] = name
				}
			}
			oldQtyMap := map[uuid.UUID]int{}
			for _, it := range oldItems {
				oldQtyMap[it.ProductID] = it.Quantity
			}
			newQtyMap := map[uuid.UUID]int{}
			for _, it := range req.Items {
				newQtyMap[it.ProductID] = it.Quantity
			}
			var lines []string
			for _, it := range oldItems {
				name := productNames[it.ProductID]
				if name == "" {
					name = it.ProductID.String()[:8]
				}
				if newQ, exists := newQtyMap[it.ProductID]; !exists {
					lines = append(lines, fmt.Sprintf("%s: %d → удалён", name, it.Quantity))
				} else if newQ != it.Quantity {
					lines = append(lines, fmt.Sprintf("%s: %d → %d", name, it.Quantity, newQ))
				}
			}
			for _, it := range req.Items {
				if _, had := oldQtyMap[it.ProductID]; !had {
					name := productNames[it.ProductID]
					if name == "" {
						name = it.ProductID.String()[:8]
					}
					lines = append(lines, fmt.Sprintf("%s: добавлен ×%d", name, it.Quantity))
				}
			}
			if len(lines) > 0 {
				insertAudit("Изменил товары заказа\n\n" + strings.Join(lines, "\n"))
			}
		}

		s.logger.LogAsync(activity.Entry{
			ActorID:    &actorID,
			Action:     "update",
			EntityType: "order",
			EntityID:   &orderID,
		})
		for i := range o.Attachments {
			s.resolveAttachmentURL(ctx, &o.Attachments[i])
		}
		updated = o
		return nil
	})
	if txErr != nil {
		for _, att := range pendingAttachments {
			if att.MediaAssetID != nil {
				s.releaseAndLog(ctx, *att.MediaAssetID)
			}
		}
		return nil, txErr
	}
	return updated, nil
}

// resolveDeliveryFeeForItems returns the delivery fee for an order.
// Checks the first product's per-product fee; falls back to global delivery_settings.
func (s *Service) resolveDeliveryFeeForItems(ctx context.Context, items []OrderItem, method string) (float64, error) {
	if len(items) > 0 {
		type productFees struct {
			NormalDeliveryFee  *float64
			ExpressDeliveryFee *float64
		}
		var pf productFees
		s.db.WithContext(ctx).
			Table("products").
			Select("normal_delivery_fee, express_delivery_fee").
			Where("id = ?", items[0].ProductID).
			Scan(&pf)

		switch method {
		case "fast":
			if pf.ExpressDeliveryFee != nil {
				return *pf.ExpressDeliveryFee, nil
			}
		default:
			if pf.NormalDeliveryFee != nil {
				return *pf.NormalDeliveryFee, nil
			}
		}
	}
	return delivery_settings.GetFee(s.db, method)
}

// ─── Order Comments ───────────────────────────────────────────────────────────

// orderCommentRow is a raw DB scan target for order_comments + author info.
type orderCommentRow struct {
	ID         uuid.UUID `gorm:"column:id"`
	OrderID    uuid.UUID `gorm:"column:order_id"`
	UserID     uuid.UUID `gorm:"column:user_id"`
	AuthorName string    `gorm:"column:author_name"`
	AuthorRole string    `gorm:"column:author_role"`
	Comment    string    `gorm:"column:comment"`
	Visibility string    `gorm:"column:visibility"`
	CreatedAt  time.Time `gorm:"column:created_at"`
}

func (s *Service) CanAccessOrder(ctx context.Context, orderID, actorID uuid.UUID, actorRole string) error {
	o, err := s.GetByID(ctx, orderID)
	if err != nil {
		return err
	}

	switch actorRole {
	case "owner", "dispatcher":
		return nil
	case "seller":
		if o.SellerID == actorID {
			return nil
		}
	case "manager":
		if o.SellerID == actorID || (o.ManagerID != nil && *o.ManagerID == actorID) {
			return nil
		}
	case "sales_team_lead":
		if o.SellerID == actorID || (o.TeamLeadID != nil && *o.TeamLeadID == actorID) {
			return nil
		}
	case "courier":
		if o.CourierID != nil && *o.CourierID == actorID {
			return nil
		}
		hasAssignment, assignErr := s.repo.HasCourierAssignment(ctx, orderID, actorID)
		if assignErr != nil {
			return apperrors.Internal(assignErr)
		}
		if hasAssignment {
			return nil
		}
	}

	return apperrors.Forbidden("you do not have access to this order")
}

// GetOrderComments returns the shared order comment thread for any role that can
// access the order. Empty threads return [].
func (s *Service) GetOrderComments(ctx context.Context, orderID, requestingUserID uuid.UUID, requestingRole string) ([]OrderCommentResponse, error) {
	if err := s.CanAccessOrder(ctx, orderID, requestingUserID, requestingRole); err != nil {
		return nil, err
	}

	var rows []orderCommentRow
	err := s.db.WithContext(ctx).
		Raw(`SELECT oc.id, oc.order_id, oc.user_id,
		            COALESCE(u.full_name, '') AS author_name,
		            COALESCE(u.role::text, '') AS author_role,
		            oc.comment, oc.visibility, oc.created_at
		     FROM order_comments oc
		     LEFT JOIN users u ON u.id = oc.user_id
		     WHERE oc.order_id = ?
		     ORDER BY oc.created_at ASC`, orderID).
		Scan(&rows).Error
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	out := make([]OrderCommentResponse, len(rows))
	for i, r := range rows {
		out[i] = OrderCommentResponse{
			ID:         r.ID,
			OrderID:    r.OrderID,
			UserID:     r.UserID,
			AuthorName: r.AuthorName,
			AuthorRole: r.AuthorRole,
			Comment:    r.Comment,
			Text:       r.Comment,
			Visibility: r.Visibility,
			CreatedAt:  r.CreatedAt,
		}
	}
	return out, nil
}

// AddOrderComment appends to the shared order comment thread.
func (s *Service) AddOrderComment(ctx context.Context, orderID, actorID uuid.UUID, actorRole string, text string) (*OrderCommentResponse, error) {
	if err := s.CanAccessOrder(ctx, orderID, actorID, actorRole); err != nil {
		return nil, err
	}

	// Dispatchers and owners write internal-only notes; all other roles write
	// seller_visible so the seller can see the comment thread.
	visibility := "seller_visible"
	if actorRole == "dispatcher" || rbac.IsOwnerLevel(actorRole) {
		visibility = "internal"
	}

	id := uuid.New()
	now := time.Now().UTC()
	err := s.db.WithContext(ctx).Exec(
		`INSERT INTO order_comments (id, order_id, user_id, comment, visibility, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		id, orderID, actorID, text, visibility, now,
	).Error
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	// Fetch author name and role.
	var authorInfo struct {
		FullName string `gorm:"column:full_name"`
		Role     string `gorm:"column:role"`
	}
	s.db.WithContext(ctx).Raw("SELECT full_name, role::text AS role FROM users WHERE id = ?", actorID).Scan(&authorInfo)

	return &OrderCommentResponse{
		ID:         id,
		OrderID:    orderID,
		UserID:     actorID,
		AuthorName: authorInfo.FullName,
		AuthorRole: authorInfo.Role,
		Comment:    text,
		Text:       text,
		Visibility: visibility,
		CreatedAt:  now,
	}, nil
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
					DeliveryFee:    o.DeliveryFee,
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

		for i := range o.Attachments {
			s.resolveAttachmentURL(ctx, &o.Attachments[i])
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
// Total prepayments cannot exceed total_order_amount (products + client delivery).
func (s *Service) AddPrepayment(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, req AddPrepaymentRequest) (*OrderPrepayment, error) {
	// Attach BEFORE the transaction — same reasoning as Create/Update's
	// pre-attach blocks.
	proofURL, mediaAssetID, width, height, prepErr := s.preparePrepaymentProof(ctx, orderID, actorID, req.ProofURL, req.MediaAssetID)
	if prepErr != nil {
		return nil, prepErr
	}

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
		totalOrderAmount := o.TotalAmount + o.DeliveryFee
		if existingTotal+req.Amount > totalOrderAmount {
			return apperrors.BadRequest(fmt.Sprintf(
				"total prepayments (%.2f) would exceed order total (%.2f)",
				existingTotal+req.Amount, totalOrderAmount,
			))
		}

		p := &OrderPrepayment{
			ID:           uuid.New(),
			OrderID:      orderID,
			Amount:       req.Amount,
			ProofURL:     proofURL,
			CreatedBy:    actorID,
			MediaAssetID: mediaAssetID,
			Width:        width,
			Height:       height,
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
		if mediaAssetID != nil {
			s.releaseAndLog(ctx, *mediaAssetID)
		}
		return nil, txErr
	}
	s.resolvePrepaymentURL(ctx, created)
	return created, nil
}

func (s *Service) ListPrepayments(ctx context.Context, orderID uuid.UUID) ([]OrderPrepayment, error) {
	if _, err := s.GetByID(ctx, orderID); err != nil {
		return nil, err
	}
	prepayments, err := s.repo.ListPrepayments(ctx, orderID)
	if err != nil {
		return nil, err
	}
	for i := range prepayments {
		s.resolvePrepaymentURL(ctx, &prepayments[i])
	}
	return prepayments, nil
}

// ─── Prepayment verification ───────────────────────────────────────────────────

func (s *Service) VerifyPrepayment(ctx context.Context, actorID uuid.UUID, actorRole string, orderID uuid.UUID, req VerifyPrepaymentRequest) (*Order, error) {
	if actorRole != "dispatcher" && !rbac.IsOwnerLevel(actorRole) {
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
	if actorRole != "dispatcher" && !rbac.IsOwnerLevel(actorRole) {
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
	for i := range attachments {
		s.resolveAttachmentURL(ctx, &attachments[i])
	}
	return attachments, nil
}

// AddAttachment accepts either a legacy FileURL or a media-pipeline
// MediaAssetID (category order_attachment) — exactly one of the two, via
// req. See prepareOrderAttachment.
func (s *Service) AddAttachment(ctx context.Context, actorID uuid.UUID, orderID uuid.UUID, req AddAttachmentRequest) (*OrderAttachment, error) {
	if _, err := s.GetByID(ctx, orderID); err != nil {
		return nil, err
	}

	var url *string
	if strings.TrimSpace(req.FileURL) != "" {
		url = &req.FileURL
	}
	att, err := s.prepareOrderAttachment(ctx, orderID, actorID, req.Type, url, req.MediaAssetID)
	if err != nil {
		return nil, err
	}
	if att == nil {
		return nil, apperrors.BadRequest("exactly one of file_url or media_asset_id is required")
	}

	if err := s.db.WithContext(ctx).Create(att).Error; err != nil {
		if att.MediaAssetID != nil {
			s.releaseAndLog(ctx, *att.MediaAssetID)
		}
		return nil, fmt.Errorf("create attachment: %w", err)
	}
	s.resolveAttachmentURL(ctx, att)
	return att, nil
}

// ─── Inventory helpers ─────────────────────────────────────────────────────────

// releaseInventory decrements reserved_quantity for each item without touching quantity.
// Called when order is cancelled or returned.
func (s *Service) releaseInventory(ctx context.Context, tx *gorm.DB, o *Order) error {
	for _, it := range o.Items {
		inv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, it.ProductID)
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
		inv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, it.ProductID)
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
		// ReferenceID links back to the order so the movements list can enrich the
		// row (order number, customer, courier) without exposing /orders to roles
		// that shouldn't browse orders directly (e.g. warehouse_manager).
		m := &inventory.Movement{
			ID:               uuid.New(),
			ProductID:        it.ProductID,
			MovementType:     inventory.MovementSale,
			Quantity:         it.Quantity,
			PreviousQuantity: prevQty,
			NewQuantity:      newQty,
			ReferenceID:      &o.ID,
			CreatedBy:        actorID,
		}
		orderIDStr := o.ID.String()
		reason := "order delivered: " + orderIDStr
		m.Reason = &reason
		if err := s.invRepo.InsertMovement(tx, ctx, m); err != nil {
			return fmt.Errorf("insert sale movement: %w", err)
		}
		if _, err := s.invRepo.ConsumeFIFO(tx, ctx, it.ProductID, it.Quantity, m.ID); err != nil {
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
		// owner creates house orders — no seller/team attribution, no
		// commission paid to anyone (see compensation.ApplyCommissionRules).
		if ot != OrderTypeHouse {
			return apperrors.Forbidden("owner can only create house_order")
		}
	case "dispatcher":
		// dispatcher creates office orders on behalf of a seller
		if ot != OrderTypeSeller {
			return apperrors.Forbidden("dispatcher can only create seller_order (office orders)")
		}
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
	if rbac.IsOwnerLevel(role) {
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
