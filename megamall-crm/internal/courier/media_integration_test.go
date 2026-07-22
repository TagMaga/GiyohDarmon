package courier

// media_integration_test.go — Phase 1 (remaining uploads): cash_handover_proof
// ↔ centralized media pipeline integration tests. Covers attaching up to
// MaxCashHandoverProofs media-pipeline images per handover (with no
// media_asset_id column — assets are found solely via their own
// owner_entity_type/owner_entity_id), the >5 rejection, category mismatch,
// release-on-failure compensation, legacy proof_url/attachments_json
// coexistence, and signed-URL resolution on read via
// Service.ToHandoverResponse — mirrors internal/orders/media_integration_test.go's
// structure, adapted to cash handovers' multi-asset-per-owner shape.
//
// Uses a scratch DB (via internal/testutil) and a temporary upload
// directory only — never production. package courier (internal), not
// courier_test, since internal/testutil does not import internal/courier.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/customers"
	"github.com/megamall/crm/internal/media"
	"github.com/megamall/crm/internal/orders"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"github.com/megamall/crm/tools/imagebench"
	"gorm.io/gorm"
)

const courierTestMediaSecret = "courier-media-integration-test-secret"

func courierTestMediaCfg(t *testing.T) config.MediaConfig {
	t.Helper()
	return config.MediaConfig{
		MaxUploadBytes:        40 << 20,
		MaxImageBytes:         35 << 20,
		MaxDocumentBytes:      20 << 20,
		MaxPixels:             40_000_000,
		MaxDimension:          12000,
		SigningSecret:         courierTestMediaSecret,
		SignedURLTTL:          15 * time.Minute,
		QuarantineRetention:   30 * 24 * time.Hour,
		ProcessingConcurrency: 2,
		ProcessingTimeout:     60 * time.Second,
		UploadDir:             t.TempDir(),
	}
}

// setupCourierServiceWithMedia builds a real, working courier.Service wired
// to a real media.Service. The adapter closures below duplicate (rather
// than import) internal/courier/mediabridge's logic: that package imports
// internal/courier itself, so a test file inside package courier can't
// import it without an import cycle — see internal/orders/media_integration_test.go's
// identical reasoning for the sibling orders package.
func setupCourierServiceWithMedia(t *testing.T, db *gorm.DB) (*Service, *media.Service) {
	t.Helper()
	activityLogger := activity.NewLogger(activity.NewRepository(db))
	ordersRepo := orders.NewRepository(db, time.UTC)
	userRepo := users.NewRepository(db)
	sellerLookup := func(ctx context.Context, id uuid.UUID) (*orders.SellerLookupResult, error) {
		u, err := userRepo.GetByID(ctx, id)
		if err != nil {
			return nil, err
		}
		if u == nil {
			return nil, nil
		}
		return &orders.SellerLookupResult{IsActive: u.IsActive, Role: string(u.Role)}, nil
	}
	ordersSvc := orders.NewService(ordersRepo, nil, nil, nil, nil, activityLogger, db, sellerLookup)

	svc := NewService(NewRepository(db), ordersSvc, activityLogger, db)
	mediaSvc := media.NewService(media.NewRepository(db), courierTestMediaCfg(t))

	attach := func(ctx context.Context, assetID, handoverID, actorID uuid.UUID) (*MediaAssetInfo, error) {
		asset, err := mediaSvc.AttachToOwner(ctx, assetID, media.CategoryCashHandoverProof, "cash_handovers", handoverID, actorID)
		if err != nil {
			switch {
			case errors.Is(err, media.ErrAssetNotFound):
				return nil, fmt.Errorf("%w: %v", ErrMediaAssetNotFound, err)
			case errors.Is(err, media.ErrCategoryMismatch):
				return nil, fmt.Errorf("%w: %v", ErrMediaCategoryMismatch, err)
			case errors.Is(err, media.ErrAlreadyAttached):
				return nil, fmt.Errorf("%w: %v", ErrMediaAlreadyAttached, err)
			default:
				return nil, err
			}
		}
		return &MediaAssetInfo{ID: asset.ID, Width: asset.Width, Height: asset.Height}, nil
	}

	list := func(ctx context.Context, handoverID uuid.UUID) ([]MediaAssetInfo, error) {
		assets, err := mediaSvc.ListByOwner(ctx, "cash_handovers", handoverID)
		if err != nil {
			return nil, err
		}
		out := make([]MediaAssetInfo, 0, len(assets))
		for _, a := range assets {
			out = append(out, MediaAssetInfo{ID: a.ID, Width: a.Width, Height: a.Height})
		}
		return out, nil
	}

	signedURL := func(ctx context.Context, assetID uuid.UUID, variant string) string {
		asset, err := mediaSvc.GetByID(ctx, assetID)
		if err != nil || asset == nil {
			return ""
		}
		signed, err := mediaSvc.SignedURL(asset, variant)
		if err != nil {
			return ""
		}
		return signed.URL
	}

	svc.SetMediaAdapters(attach, list, mediaSvc.ReleaseByID, signedURL)
	return svc, mediaSvc
}

var courierFixturesOnce = map[string][]byte{}

func courierFixture(t *testing.T, name string) []byte {
	t.Helper()
	if len(courierFixturesOnce) == 0 {
		all, err := imagebench.GenerateAll()
		if err != nil {
			t.Fatalf("generate fixtures: %v", err)
		}
		for _, f := range all {
			courierFixturesOnce[f.Name] = f.Bytes
		}
	}
	buf, ok := courierFixturesOnce[name]
	if !ok {
		t.Fatalf("fixture %q not found", name)
	}
	return buf
}

func courierUploadAsset(t *testing.T, mediaSvc *media.Service, category media.Category, uploaderID uuid.UUID, filename string, buf []byte) *media.Asset {
	t.Helper()
	asset, appErr := mediaSvc.Create(context.Background(), media.CreateParams{
		Category:         category,
		UploadedByUserID: uploaderID,
		OriginalFilename: filename,
		DeclaredSize:     int64(len(buf)),
	}, bytes.NewReader(buf))
	if appErr != nil {
		t.Fatalf("upload %s fixture: %v", category, appErr)
	}
	return asset
}

// createDeliveredOrderForCourier inserts a minimal delivered order owned by
// courierID directly (bypassing orders.Service's full lifecycle, which
// isn't the concern of these tests) so FindEligibleHandoverOrders picks it
// up for SubmitHandover.
func createDeliveredOrderForCourier(t *testing.T, db *gorm.DB, courierID uuid.UUID) uuid.UUID {
	t.Helper()
	custRepo := customers.NewRepository(db)
	cust := &customers.Customer{
		ID:       uuid.New(),
		FullName: "Test Customer",
		Phone:    "+1" + uuid.New().String()[:9],
	}
	if err := custRepo.Create(context.Background(), cust); err != nil {
		t.Fatalf("create test customer: %v", err)
	}

	o := &orders.Order{
		ID:            uuid.New(),
		CustomerID:    cust.ID,
		SellerID:      courierID,
		OrderType:     orders.OrderTypeSeller,
		Status:        orders.StatusDelivered,
		CourierID:     &courierID,
		TotalAmount:   100,
		DeliveryFee:   10,
		CourierPayout: 5,
	}
	if err := db.Table("orders").Create(o).Error; err != nil {
		t.Fatalf("create delivered order fixture: %v", err)
	}
	return o.ID
}

// ─── SubmitHandover: media-pipeline proof attach ───────────────────────────

func TestSubmitHandover_MediaAssetIDs_Success(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupCourierServiceWithMedia(t, db)
	c := testutil.CreateUser(t, db, users.RoleCourier)
	createDeliveredOrderForCourier(t, db, c.ID)

	asset1 := courierUploadAsset(t, mediaSvc, media.CategoryCashHandoverProof, c.ID, "proof1.png", courierFixture(t, "transparent.png"))
	asset2 := courierUploadAsset(t, mediaSvc, media.CategoryCashHandoverProof, c.ID, "proof2.png", courierFixture(t, "transparent.png"))

	handover, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{
		MediaAssetIDs: []uuid.UUID{asset1.ID, asset2.ID},
	})
	if err != nil {
		t.Fatalf("SubmitHandover: %v", err)
	}

	resp := svc.ToHandoverResponse(context.Background(), handover)
	if len(resp.MediaAssets) != 2 {
		t.Fatalf("expected 2 resolved media assets, got %d: %+v", len(resp.MediaAssets), resp.MediaAssets)
	}
	for _, a := range resp.MediaAssets {
		if a.URL == "" {
			t.Error("expected a freshly-resolved signed URL for each proof asset")
		}
		if a.Width == nil || *a.Width != 1200 || a.Height == nil || *a.Height != 900 {
			t.Errorf("proof dimensions not denormalized correctly: %v x %v", a.Width, a.Height)
		}
	}
}

func TestSubmitHandover_MoreThanMaxProofs_Rejected_NoOrphan(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupCourierServiceWithMedia(t, db)
	c := testutil.CreateUser(t, db, users.RoleCourier)
	createDeliveredOrderForCourier(t, db, c.ID)

	var ids []uuid.UUID
	for i := 0; i < MaxCashHandoverProofs+1; i++ {
		asset := courierUploadAsset(t, mediaSvc, media.CategoryCashHandoverProof, c.ID, fmt.Sprintf("proof%d.png", i), courierFixture(t, "transparent.png"))
		ids = append(ids, asset.ID)
	}

	_, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{MediaAssetIDs: ids})
	if err == nil {
		t.Fatal("expected rejection for more than MaxCashHandoverProofs assets")
	}

	for _, id := range ids {
		reloaded, gErr := mediaSvc.GetByID(context.Background(), id)
		if gErr != nil {
			t.Fatalf("GetByID: %v", gErr)
		}
		if reloaded == nil || reloaded.OwnerEntityID != nil {
			t.Error("no asset should have been attached when the request was rejected up front")
		}
	}
}

func TestSubmitHandover_CategoryMismatch_Rejected_ReleasesPriorAttaches(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupCourierServiceWithMedia(t, db)
	c := testutil.CreateUser(t, db, users.RoleCourier)
	createDeliveredOrderForCourier(t, db, c.ID)

	goodAsset := courierUploadAsset(t, mediaSvc, media.CategoryCashHandoverProof, c.ID, "proof.png", courierFixture(t, "transparent.png"))
	wrongCategory := courierUploadAsset(t, mediaSvc, media.CategoryAvatar, c.ID, "avatar.png", courierFixture(t, "transparent.png"))

	_, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{
		MediaAssetIDs: []uuid.UUID{goodAsset.ID, wrongCategory.ID},
	})
	if err == nil {
		t.Fatal("expected rejection for a category-mismatched proof asset")
	}

	// GetByID filters deleted_at IS NULL, so a released (quarantined) asset
	// correctly comes back nil here — that IS the compensation succeeding,
	// mirroring TestUpdate_AvatarReplace_QuarantinesOld's identical
	// assertion shape in internal/users/media_integration_test.go.
	reloadedGood, gErr := mediaSvc.GetByID(context.Background(), goodAsset.ID)
	if gErr != nil {
		t.Fatalf("GetByID(goodAsset): %v", gErr)
	}
	if reloadedGood != nil {
		t.Error("the successfully-attached asset before the failure should have been released, not left attached")
	}

	reloadedWrong, gErr := mediaSvc.GetByID(context.Background(), wrongCategory.ID)
	if gErr != nil {
		t.Fatalf("GetByID(wrongCategory): %v", gErr)
	}
	if reloadedWrong == nil || reloadedWrong.OwnerEntityID != nil {
		t.Error("mismatched asset should remain unattached and un-quarantined")
	}
}

func TestSubmitHandover_NoEligibleOrders_ReleasesAttaches(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupCourierServiceWithMedia(t, db)
	c := testutil.CreateUser(t, db, users.RoleCourier)
	// Deliberately no delivered order for this courier.

	asset := courierUploadAsset(t, mediaSvc, media.CategoryCashHandoverProof, c.ID, "proof.png", courierFixture(t, "transparent.png"))

	_, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{
		MediaAssetIDs: []uuid.UUID{asset.ID},
	})
	if err == nil {
		t.Fatal("expected rejection: no eligible delivered orders")
	}

	// See the category-mismatch test above for why nil is the expected
	// (successfully-released) outcome here.
	reloaded, gErr := mediaSvc.GetByID(context.Background(), asset.ID)
	if gErr != nil {
		t.Fatalf("GetByID: %v", gErr)
	}
	if reloaded != nil {
		t.Error("asset attached before the transaction should be released when the transaction itself fails")
	}
}

// TestSubmitHandover_NoEligibleOrders_WithDeclaredAmount_CreatesSettlementHandover
// covers a courier settling old shortfall debt (see GetCashSummary's
// confirmed-handover-shortfall carry-over) when they have no new
// deliveries: declaring a real ActualAmount with zero eligible orders must
// produce a zero-line handover instead of being rejected.
func TestSubmitHandover_NoEligibleOrders_WithDeclaredAmount_CreatesSettlementHandover(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupCourierServiceWithMedia(t, db)
	c := testutil.CreateUser(t, db, users.RoleCourier)
	// Deliberately no delivered order for this courier.

	asset := courierUploadAsset(t, mediaSvc, media.CategoryCashHandoverProof, c.ID, "proof.png", courierFixture(t, "transparent.png"))
	amount := 89.03

	handover, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{
		MediaAssetIDs: []uuid.UUID{asset.ID},
		ActualAmount:  &amount,
	})
	if err != nil {
		t.Fatalf("SubmitHandover (settlement, no eligible orders): %v", err)
	}
	if len(handover.Orders) != 0 {
		t.Errorf("settlement handover should have no order lines, got %d", len(handover.Orders))
	}
	if handover.TotalToReturn != 0 || handover.TotalCollected != 0 || handover.TotalDeliveryFees != 0 {
		t.Errorf("settlement handover totals should all be zero, got to_return=%v collected=%v fees=%v",
			handover.TotalToReturn, handover.TotalCollected, handover.TotalDeliveryFees)
	}
	if handover.ActualReturned == nil || *handover.ActualReturned != amount {
		t.Errorf("ActualReturned = %v, want %v", handover.ActualReturned, amount)
	}
	if handover.Status != HandoverStatusPending {
		t.Errorf("status = %v, want pending", handover.Status)
	}

	// The proof asset must actually attach (not be released as an orphan)
	// since this submission succeeds.
	reloaded, gErr := mediaSvc.GetByID(context.Background(), asset.ID)
	if gErr != nil {
		t.Fatalf("GetByID: %v", gErr)
	}
	if reloaded == nil || reloaded.OwnerEntityID == nil {
		t.Error("proof asset should remain attached to the settlement handover")
	}
}

// TestSubmitHandover_NoEligibleOrders_ZeroDeclaredAmount_StillRejected covers
// the case where ActualAmount is present but non-positive — this must not
// be treated as a settlement submission, since there'd be nothing to record.
func TestSubmitHandover_NoEligibleOrders_ZeroDeclaredAmount_StillRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupCourierServiceWithMedia(t, db)
	c := testutil.CreateUser(t, db, users.RoleCourier)
	// Deliberately no delivered order for this courier.

	zero := 0.0
	_, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{ActualAmount: &zero})
	if err == nil {
		t.Fatal("expected rejection: zero declared amount with no eligible orders")
	}
}

func TestSubmitHandover_LegacyProofURLAndAttachmentsJSON_StillWork(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupCourierServiceWithMedia(t, db)
	c := testutil.CreateUser(t, db, users.RoleCourier)
	createDeliveredOrderForCourier(t, db, c.ID)

	proofURL := "/uploads/legacy-handover.jpg"
	attachmentsJSON := `["/uploads/a.jpg","/uploads/b.jpg"]`

	handover, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{
		ProofURL:        &proofURL,
		AttachmentsJSON: &attachmentsJSON,
	})
	if err != nil {
		t.Fatalf("SubmitHandover (legacy fields): %v", err)
	}
	if handover.ProofURL == nil || *handover.ProofURL != proofURL {
		t.Errorf("ProofURL = %v, want the exact legacy value %q", handover.ProofURL, proofURL)
	}
	if handover.AttachmentsJSON == nil || *handover.AttachmentsJSON != attachmentsJSON {
		t.Errorf("AttachmentsJSON = %v, want the exact legacy value %q", handover.AttachmentsJSON, attachmentsJSON)
	}

	resp := svc.ToHandoverResponse(context.Background(), handover)
	if len(resp.MediaAssets) != 0 {
		t.Errorf("expected no media assets for a legacy-only submission, got %+v", resp.MediaAssets)
	}
}

func TestSubmitHandover_LegacyAndMediaPipeline_Coexist(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupCourierServiceWithMedia(t, db)
	c := testutil.CreateUser(t, db, users.RoleCourier)
	createDeliveredOrderForCourier(t, db, c.ID)

	proofURL := "/uploads/legacy-handover.jpg"
	asset := courierUploadAsset(t, mediaSvc, media.CategoryCashHandoverProof, c.ID, "proof.png", courierFixture(t, "transparent.png"))

	handover, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{
		ProofURL:      &proofURL,
		MediaAssetIDs: []uuid.UUID{asset.ID},
	})
	if err != nil {
		t.Fatalf("SubmitHandover (legacy + pipeline): %v", err)
	}
	if handover.ProofURL == nil || *handover.ProofURL != proofURL {
		t.Errorf("legacy ProofURL not preserved: %v", handover.ProofURL)
	}

	resp := svc.ToHandoverResponse(context.Background(), handover)
	if len(resp.MediaAssets) != 1 {
		t.Fatalf("expected 1 resolved media asset alongside the legacy proof_url, got %d", len(resp.MediaAssets))
	}
}

// ─── Feature disabled: changes nothing ─────────────────────────────────────

func TestSubmitHandover_MediaDisabled_RejectsMediaAssetIDs_NoOrphan(t *testing.T) {
	db := testutil.NewTestDB(t)
	activityLogger := activity.NewLogger(activity.NewRepository(db))
	ordersRepo := orders.NewRepository(db, time.UTC)
	svc := NewService(NewRepository(db), orders.NewService(ordersRepo, nil, nil, nil, nil, activityLogger, db, nil), activityLogger, db)
	c := testutil.CreateUser(t, db, users.RoleCourier)
	createDeliveredOrderForCourier(t, db, c.ID)

	fakeAssetID := uuid.New()
	_, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{
		MediaAssetIDs: []uuid.UUID{fakeAssetID},
	})
	if err == nil {
		t.Fatal("expected rejection: media_asset_ids supplied but media pipeline disabled")
	}
}

func TestSubmitHandover_MediaDisabled_LegacyFlowUnaffected(t *testing.T) {
	db := testutil.NewTestDB(t)
	activityLogger := activity.NewLogger(activity.NewRepository(db))
	ordersRepo := orders.NewRepository(db, time.UTC)
	svc := NewService(NewRepository(db), orders.NewService(ordersRepo, nil, nil, nil, nil, activityLogger, db, nil), activityLogger, db)
	c := testutil.CreateUser(t, db, users.RoleCourier)
	createDeliveredOrderForCourier(t, db, c.ID)

	handover, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{})
	if err != nil {
		t.Fatalf("SubmitHandover (no media fields) must succeed when media is disabled: %v", err)
	}
	if handover.Status != HandoverStatusPending {
		t.Errorf("Status = %v, want pending", handover.Status)
	}
}
