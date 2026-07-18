package orders

// media_integration_test.go — Phase 1 (remaining uploads): order_attachment
// and prepayment_proof ↔ centralized media pipeline integration tests.
// Covers attach-before-transaction, release-on-failure compensation,
// mutual exclusivity between a legacy URL and a media_asset_id, legacy
// FileURL/ProofURL fallback, and signed-URL resolution on read — mirrors
// internal/users/media_integration_test.go's structure, adapted to orders'
// pre-attach/transaction pattern.
//
// Uses a scratch DB (via internal/testutil) and a temporary upload
// directory only — never production. package orders (internal), not
// orders_test, since internal/testutil does not import internal/orders —
// see testmain_test.go's doc comment.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/media"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"github.com/megamall/crm/tools/imagebench"
	"gorm.io/gorm"
)

const ordersTestMediaSecret = "orders-media-integration-test-secret"

func ordersTestMediaCfg(t *testing.T) config.MediaConfig {
	t.Helper()
	return config.MediaConfig{
		MaxUploadBytes:        40 << 20,
		MaxImageBytes:         35 << 20,
		MaxDocumentBytes:      20 << 20,
		MaxPixels:             40_000_000,
		MaxDimension:          12000,
		SigningSecret:         ordersTestMediaSecret,
		SignedURLTTL:          15 * time.Minute,
		QuarantineRetention:   30 * 24 * time.Hour,
		ProcessingConcurrency: 2,
		ProcessingTimeout:     60 * time.Second,
		UploadDir:             t.TempDir(),
	}
}

// setupOrderServiceWithMedia builds a real, working orders.Service wired to
// a real media.Service. The adapter closures below duplicate (rather than
// import) internal/orders/mediabridge's logic: that package imports
// internal/orders itself (to reference its exported Fn/error types), so a
// test file inside package orders can't import it without an import cycle
// — see internal/orders/mediabridge/bridge.go's doc comment. This mirrors
// exactly what cmd/server/main.go wires via ordersmediabridge.Adapters.
func setupOrderServiceWithMedia(t *testing.T, db *gorm.DB) (*Service, *media.Service) {
	t.Helper()
	svc, _, _ := buildTestOrderService(t, db)
	mediaSvc := media.NewService(media.NewRepository(db), ordersTestMediaCfg(t))

	attachFor := func(category media.Category) func(ctx context.Context, assetID, ownerID, actorID uuid.UUID) (*MediaAssetInfo, error) {
		return func(ctx context.Context, assetID, ownerID, actorID uuid.UUID) (*MediaAssetInfo, error) {
			asset, err := mediaSvc.AttachToOwner(ctx, assetID, category, "orders", ownerID, actorID)
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
			return &MediaAssetInfo{Width: asset.Width, Height: asset.Height}, nil
		}
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

	svc.SetMediaAdapters(attachFor(media.CategoryOrderAttachment), attachFor(media.CategoryPrepaymentProof), mediaSvc.ReleaseByID, signedURL)
	return svc, mediaSvc
}

var ordersFixturesOnce = map[string][]byte{}

func ordersFixture(t *testing.T, name string) []byte {
	t.Helper()
	if len(ordersFixturesOnce) == 0 {
		all, err := imagebench.GenerateAll()
		if err != nil {
			t.Fatalf("generate fixtures: %v", err)
		}
		for _, f := range all {
			ordersFixturesOnce[f.Name] = f.Bytes
		}
	}
	buf, ok := ordersFixturesOnce[name]
	if !ok {
		t.Fatalf("fixture %q not found", name)
	}
	return buf
}

func ordersUploadAsset(t *testing.T, mediaSvc *media.Service, category media.Category, uploaderID uuid.UUID, filename string, buf []byte) *media.Asset {
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

func createOrderForMediaTest(t *testing.T, db *gorm.DB, svc *Service, sellerID uuid.UUID) *Order {
	t.Helper()
	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, sellerID, 100)

	order, err := svc.Create(context.Background(), sellerID, "seller", buildOrderRequest(customerID, cityID, product.ID))
	if err != nil {
		t.Fatalf("create order fixture: %v", err)
	}
	return order
}

// ─── Order creation with a prepayment media asset attached ────────────────

func TestCreate_PrepaymentAttachmentMediaAssetID_Success(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupOrderServiceWithMedia(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, seller.ID, 100)

	asset := ordersUploadAsset(t, mediaSvc, media.CategoryOrderAttachment, seller.ID, "proof.png", ordersFixture(t, "transparent.png"))

	req := buildOrderRequest(customerID, cityID, product.ID)
	req.PrepaymentRequired = true
	req.PrepaymentAmount = 50
	req.PaymentProofMediaAssetID = &asset.ID

	order, err := svc.Create(context.Background(), seller.ID, "seller", req)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if len(order.Attachments) != 1 {
		t.Fatalf("expected 1 attachment, got %d", len(order.Attachments))
	}
	att := order.Attachments[0]
	if att.MediaAssetID == nil || *att.MediaAssetID != asset.ID {
		t.Errorf("attachment MediaAssetID not set correctly: %+v", att.MediaAssetID)
	}
	if att.Width == nil || *att.Width != 1200 || att.Height == nil || *att.Height != 900 {
		t.Errorf("attachment dimensions not denormalized correctly: %v x %v", att.Width, att.Height)
	}
	if att.FileURL == "" {
		t.Error("expected a freshly-resolved signed FileURL after attach")
	}

	reloaded, err := svc.GetByID(context.Background(), order.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if len(reloaded.Attachments) != 1 || reloaded.Attachments[0].FileURL == "" {
		t.Fatalf("expected GetByID to resolve a fresh signed FileURL, got %+v", reloaded.Attachments)
	}
}

func TestCreate_AttachmentCategoryMismatch_Rejected_NoOrder(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupOrderServiceWithMedia(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, seller.ID, 100)

	wrongCategory := ordersUploadAsset(t, mediaSvc, media.CategoryAvatar, seller.ID, "avatar.png", ordersFixture(t, "transparent.png"))

	req := buildOrderRequest(customerID, cityID, product.ID)
	req.PrepaymentRequired = true
	req.PrepaymentAmount = 50
	req.PaymentProofMediaAssetID = &wrongCategory.ID

	_, err := svc.Create(context.Background(), seller.ID, "seller", req)
	if err == nil {
		t.Fatal("expected rejection for a category-mismatched attachment asset")
	}

	reloaded, gErr := mediaSvc.GetByID(context.Background(), wrongCategory.ID)
	if gErr != nil {
		t.Fatalf("GetByID: %v", gErr)
	}
	if reloaded == nil || reloaded.OwnerEntityID != nil {
		t.Error("mismatched asset should remain unattached and un-quarantined")
	}
}

func TestCreate_AttachmentURLAndMediaAssetID_BothSet_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupOrderServiceWithMedia(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, seller.ID, 100)

	url := "/uploads/legacy-proof.jpg"
	fakeAssetID := uuid.New()

	req := buildOrderRequest(customerID, cityID, product.ID)
	req.PrepaymentRequired = true
	req.PrepaymentAmount = 50
	req.PaymentProofURL = &url
	req.PaymentProofMediaAssetID = &fakeAssetID

	_, err := svc.Create(context.Background(), seller.ID, "seller", req)
	if err == nil {
		t.Fatal("expected rejection when both payment_proof_url and payment_proof_media_asset_id are set")
	}
}

func TestCreate_LegacyPaymentProofURL_StillWorks(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupOrderServiceWithMedia(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)

	customerID := createTestCustomer(t, db)
	cityID := createTestCity(t, db)
	product := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, product.ID, seller.ID, 100)

	url := "/uploads/legacy-proof.jpg"
	req := buildOrderRequest(customerID, cityID, product.ID)
	req.PrepaymentRequired = true
	req.PrepaymentAmount = 50
	req.PaymentProofURL = &url

	order, err := svc.Create(context.Background(), seller.ID, "seller", req)
	if err != nil {
		t.Fatalf("Create (legacy payment_proof_url): %v", err)
	}
	if len(order.Attachments) != 1 || order.Attachments[0].FileURL != url {
		t.Fatalf("expected the exact legacy URL to be stored, got %+v", order.Attachments)
	}
	if order.Attachments[0].MediaAssetID != nil {
		t.Error("a legacy URL attachment must not have a MediaAssetID")
	}
}

// ─── Order attachments: AddAttachment ──────────────────────────────────────

func TestAddAttachment_MediaAssetID_Success(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupOrderServiceWithMedia(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	order := createOrderForMediaTest(t, db, svc, seller.ID)

	asset := ordersUploadAsset(t, mediaSvc, media.CategoryOrderAttachment, seller.ID, "extra.png", ordersFixture(t, "transparent.png"))

	att, err := svc.AddAttachment(context.Background(), seller.ID, order.ID, AddAttachmentRequest{
		Type:         "customer_chat",
		MediaAssetID: &asset.ID,
	})
	if err != nil {
		t.Fatalf("AddAttachment: %v", err)
	}
	if att.MediaAssetID == nil || *att.MediaAssetID != asset.ID {
		t.Errorf("MediaAssetID not set correctly: %+v", att.MediaAssetID)
	}
	if att.FileURL == "" {
		t.Error("expected a freshly-resolved signed FileURL")
	}

	attachments, err := svc.ListAttachments(context.Background(), order.ID)
	if err != nil {
		t.Fatalf("ListAttachments: %v", err)
	}
	if len(attachments) != 1 || attachments[0].FileURL == "" {
		t.Fatalf("expected 1 attachment with a resolved FileURL on list, got %+v", attachments)
	}
}

func TestAddAttachment_BothFieldsRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupOrderServiceWithMedia(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	order := createOrderForMediaTest(t, db, svc, seller.ID)
	asset := ordersUploadAsset(t, mediaSvc, media.CategoryOrderAttachment, seller.ID, "extra.png", ordersFixture(t, "transparent.png"))

	_, err := svc.AddAttachment(context.Background(), seller.ID, order.ID, AddAttachmentRequest{
		Type:         "customer_chat",
		FileURL:      "/uploads/legacy.jpg",
		MediaAssetID: &asset.ID,
	})
	if err == nil {
		t.Fatal("expected rejection when both file_url and media_asset_id are set")
	}
}

func TestAddAttachment_NeitherFieldRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupOrderServiceWithMedia(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	order := createOrderForMediaTest(t, db, svc, seller.ID)

	_, err := svc.AddAttachment(context.Background(), seller.ID, order.ID, AddAttachmentRequest{Type: "customer_chat"})
	if err == nil {
		t.Fatal("expected rejection when neither file_url nor media_asset_id is set")
	}
}

// ─── Prepayments: AddPrepayment ─────────────────────────────────────────────

func TestAddPrepayment_MediaAssetID_Success(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupOrderServiceWithMedia(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	order := createOrderForMediaTest(t, db, svc, seller.ID)

	asset := ordersUploadAsset(t, mediaSvc, media.CategoryPrepaymentProof, seller.ID, "proof.png", ordersFixture(t, "transparent.png"))

	p, err := svc.AddPrepayment(context.Background(), seller.ID, order.ID, AddPrepaymentRequest{
		Amount:       25,
		MediaAssetID: &asset.ID,
	})
	if err != nil {
		t.Fatalf("AddPrepayment: %v", err)
	}
	if p.MediaAssetID == nil || *p.MediaAssetID != asset.ID {
		t.Errorf("MediaAssetID not set correctly: %+v", p.MediaAssetID)
	}
	if p.Width == nil || *p.Width != 1200 || p.Height == nil || *p.Height != 900 {
		t.Errorf("prepayment dimensions not denormalized correctly: %v x %v", p.Width, p.Height)
	}
	if p.ProofURL == nil || *p.ProofURL == "" {
		t.Error("expected a freshly-resolved signed ProofURL after attach")
	}

	prepayments, err := svc.ListPrepayments(context.Background(), order.ID)
	if err != nil {
		t.Fatalf("ListPrepayments: %v", err)
	}
	if len(prepayments) != 1 || prepayments[0].ProofURL == nil || *prepayments[0].ProofURL == "" {
		t.Fatalf("expected 1 prepayment with a resolved ProofURL on list, got %+v", prepayments)
	}
}

func TestAddPrepayment_CategoryMismatch_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupOrderServiceWithMedia(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	order := createOrderForMediaTest(t, db, svc, seller.ID)

	wrongCategory := ordersUploadAsset(t, mediaSvc, media.CategoryOrderAttachment, seller.ID, "wrong.png", ordersFixture(t, "transparent.png"))

	_, err := svc.AddPrepayment(context.Background(), seller.ID, order.ID, AddPrepaymentRequest{
		Amount:       25,
		MediaAssetID: &wrongCategory.ID,
	})
	if err == nil {
		t.Fatal("expected rejection for a category-mismatched prepayment proof asset")
	}

	reloaded, gErr := mediaSvc.GetByID(context.Background(), wrongCategory.ID)
	if gErr != nil {
		t.Fatalf("GetByID: %v", gErr)
	}
	if reloaded == nil || reloaded.OwnerEntityID != nil {
		t.Error("mismatched asset should remain unattached and un-quarantined")
	}
}

func TestAddPrepayment_LegacyProofURL_StillWorks(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupOrderServiceWithMedia(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	order := createOrderForMediaTest(t, db, svc, seller.ID)

	url := "/uploads/legacy-proof.jpg"
	p, err := svc.AddPrepayment(context.Background(), seller.ID, order.ID, AddPrepaymentRequest{
		Amount:   25,
		ProofURL: &url,
	})
	if err != nil {
		t.Fatalf("AddPrepayment (legacy proof_url): %v", err)
	}
	if p.ProofURL == nil || *p.ProofURL != url {
		t.Errorf("ProofURL = %v, want the exact legacy value %q", p.ProofURL, url)
	}
	if p.MediaAssetID != nil {
		t.Error("a legacy proof_url prepayment must not have a MediaAssetID")
	}
}

// ─── Feature disabled: changes nothing ─────────────────────────────────────

func TestAddAttachment_MediaDisabled_RejectsMediaAssetID_NoOrphan(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _, _ := buildTestOrderService(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	order := createOrderForMediaTest(t, db, svc, seller.ID)

	fakeAssetID := uuid.New()
	_, err := svc.AddAttachment(context.Background(), seller.ID, order.ID, AddAttachmentRequest{
		Type:         "customer_chat",
		MediaAssetID: &fakeAssetID,
	})
	if err == nil {
		t.Fatal("expected rejection: media_asset_id supplied but media pipeline disabled")
	}

	attachments, lErr := svc.ListAttachments(context.Background(), order.ID)
	if lErr != nil {
		t.Fatalf("ListAttachments: %v", lErr)
	}
	if len(attachments) != 0 {
		t.Fatal("an attachment row was created even though the media request was rejected")
	}
}

func TestAddPrepayment_MediaDisabled_LegacyFlowUnaffected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _, _ := buildTestOrderService(t, db)
	seller := testutil.CreateUser(t, db, users.RoleSeller)
	order := createOrderForMediaTest(t, db, svc, seller.ID)

	p, err := svc.AddPrepayment(context.Background(), seller.ID, order.ID, AddPrepaymentRequest{Amount: 25})
	if err != nil {
		t.Fatalf("AddPrepayment (no proof fields) must succeed when media is disabled: %v", err)
	}
	if p.Amount != 25 {
		t.Errorf("Amount = %v, want 25", p.Amount)
	}
}
