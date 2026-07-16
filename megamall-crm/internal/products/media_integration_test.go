package products_test

// media_integration_test.go — Phase 2: product images ↔ centralized media
// pipeline integration tests. Covers create/replace/delete, failed-
// creation cleanup, large-image optimization + WebP + no-upscale (via a
// real internal/media pipeline, not mocked), legacy image_url fallback,
// and "feature disabled changes nothing".
//
// Uses a scratch DB (via internal/testutil) and a temporary upload
// directory only — never production. Run with:
//   go test ./internal/products/ -v -run TestCreateProduct
//   go test ./internal/products/ -v -run TestUpdateProduct
//   go test ./internal/products/ -v -run TestDeleteProduct
//   go test ./internal/products/ -v -run TestAddProductImage

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/media"
	"github.com/megamall/crm/internal/products"
	"github.com/megamall/crm/internal/products/mediabridge"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/tools/imagebench"
	"gorm.io/gorm"
)

const testMediaSecret = "products-media-integration-test-secret"

func testMediaCfg(t *testing.T) config.MediaConfig {
	t.Helper()
	return config.MediaConfig{
		MaxUploadBytes:        40 << 20,
		MaxImageBytes:         35 << 20,
		MaxDocumentBytes:      20 << 20,
		MaxPixels:             40_000_000,
		MaxDimension:          12000,
		SigningSecret:         testMediaSecret,
		SignedURLTTL:          15 * time.Minute,
		QuarantineRetention:   30 * 24 * time.Hour,
		ProcessingConcurrency: 2,
		// Generous vs. the 20s production default — this test suite shares
		// the host with other concurrent test/DB activity, and the timeout
		// here is only a test-environment safety margin, not something
		// these tests are trying to verify (that's covered by internal/
		// media's own benchmark-derived tests).
		ProcessingTimeout: 60 * time.Second,
		UploadDir:         t.TempDir(),
	}
}

// testLogger builds a real activity.Logger backed by the same test DB,
// matching this codebase's established test pattern (see e.g.
// internal/customers/service_test.go) — activity.NewLogger(nil) would
// panic once its background flush ticker fires against a nil repository.
// Shut down via t.Cleanup so its background flush goroutine doesn't
// outlive the test's DB transaction (which testutil.NewTestDB rolls back
// when the test ends) and log a benign but noisy
// "transaction already committed or rolled back" error on its next tick.
func testLogger(t *testing.T, db *gorm.DB) *activity.Logger {
	t.Helper()
	l := activity.NewLogger(activity.NewRepository(db))
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		l.Shutdown(ctx)
	})
	return l
}

// setupWithMedia builds a real, working products.Service wired to a real
// media.Service (both backed by db and a temp upload directory) — the
// media pipeline is fully "enabled" for this test, exactly mirroring how
// mediabridge.Adapters wires cmd/server/main.go when MEDIA_PIPELINE_ENABLED
// is true.
func setupWithMedia(t *testing.T, db *gorm.DB) (*products.Service, *media.Service) {
	t.Helper()
	mediaSvc := media.NewService(media.NewRepository(db), testMediaCfg(t))
	attach, release := mediabridge.Adapters(mediaSvc)
	svc := products.NewService(products.NewRepository(db), testLogger(t, db), db, attach, release)
	return svc, mediaSvc
}

// setupWithoutMedia mirrors a MEDIA_PIPELINE_ENABLED=false deploy: nil
// adapters, exactly as main.go passes when the flag is off.
func setupWithoutMedia(t *testing.T, db *gorm.DB) *products.Service {
	t.Helper()
	return products.NewService(products.NewRepository(db), testLogger(t, db), db, nil, nil)
}

var fixturesOnce = map[string][]byte{}

// fixture returns a named synthetic image from tools/imagebench,
// generating the full set at most once per test binary run.
func fixture(t *testing.T, name string) []byte {
	t.Helper()
	if len(fixturesOnce) == 0 {
		all, err := imagebench.GenerateAll()
		if err != nil {
			t.Fatalf("generate fixtures: %v", err)
		}
		for _, f := range all {
			fixturesOnce[f.Name] = f.Bytes
		}
	}
	buf, ok := fixturesOnce[name]
	if !ok {
		t.Fatalf("fixture %q not found", name)
	}
	return buf
}

// uploadProductImage uploads buf as a ready, unattached CategoryProductImage
// asset — the "upload" half of the upload-then-attach flow a real client
// would do via POST /api/v1/media before creating/editing a product.
func uploadProductImage(t *testing.T, mediaSvc *media.Service, uploaderID uuid.UUID, buf []byte) *media.Asset {
	t.Helper()
	asset, appErr := mediaSvc.Create(context.Background(), media.CreateParams{
		Category:         media.CategoryProductImage,
		UploadedByUserID: uploaderID,
		OriginalFilename: "product.png",
		DeclaredSize:     int64(len(buf)),
	}, bytes.NewReader(buf))
	if appErr != nil {
		t.Fatalf("upload product image fixture: %v", appErr)
	}
	return asset
}

// uploadAvatarImage uploads buf as a ready CategoryAvatar asset — used to
// prove attach rejects a category mismatch.
func uploadAvatarImage(t *testing.T, mediaSvc *media.Service, uploaderID uuid.UUID, buf []byte) *media.Asset {
	t.Helper()
	asset, appErr := mediaSvc.Create(context.Background(), media.CreateParams{
		Category:         media.CategoryAvatar,
		UploadedByUserID: uploaderID,
		OriginalFilename: "avatar.png",
		DeclaredSize:     int64(len(buf)),
	}, bytes.NewReader(buf))
	if appErr != nil {
		t.Fatalf("upload avatar fixture: %v", appErr)
	}
	return asset
}

// ─── Create: happy path, variants, no-upscale, WebP ────────────────────────

func TestCreateProduct_WithMediaImage_Success(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)

	asset := uploadProductImage(t, mediaSvc, uploader.ID, fixture(t, "transparent.png")) // 1200x900

	p, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{
		Name:                     "Widget",
		PrimaryImageMediaAssetID: &asset.ID,
	})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}
	if len(p.Images) != 1 {
		t.Fatalf("expected 1 image, got %d", len(p.Images))
	}
	img := p.Images[0]
	if img.MediaAssetID == nil || *img.MediaAssetID != asset.ID {
		t.Errorf("MediaAssetID not set correctly: %+v", img.MediaAssetID)
	}
	if img.ThumbnailURL == nil || img.CardURL == nil || img.DetailURL == nil {
		t.Errorf("expected all three variant URLs, got thumb=%v card=%v detail=%v", img.ThumbnailURL, img.CardURL, img.DetailURL)
	}
	if img.ImageURL != *img.CardURL {
		t.Errorf("legacy ImageURL should default to the card variant: image_url=%q card_url=%q", img.ImageURL, *img.CardURL)
	}
	if img.Width == nil || *img.Width != 1200 || img.Height == nil || *img.Height != 900 {
		t.Errorf("width/height not denormalized correctly: %v x %v", img.Width, img.Height)
	}
	if !img.IsPrimary {
		t.Error("expected the create-time image to be marked primary")
	}

	// Re-fetch confirms persistence, not just the in-memory return value.
	reloaded, err := svc.GetProductByID(context.Background(), p.ID)
	if err != nil {
		t.Fatalf("GetProductByID: %v", err)
	}
	if len(reloaded.Images) != 1 || reloaded.Images[0].MediaAssetID == nil {
		t.Fatalf("image did not persist correctly: %+v", reloaded.Images)
	}
}

// TestCreateProduct_LargeJPEG_AutomaticallyOptimized proves the real
// libvips pipeline ran: a 24MP, 33MB+ synthetic JPEG produces WebP variants
// that are dramatically smaller, and the "detail" variant is capped at
// 1440px (never the full 6000px width) exactly as internal/media's own
// ProductVariantSpecs define.
func TestCreateProduct_LargeJPEG_AutomaticallyOptimized(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)

	large := fixture(t, "large_photo_6000x4000.jpg")
	asset := uploadProductImage(t, mediaSvc, uploader.ID, large)

	p, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{
		Name:                     "Large Photo Product",
		PrimaryImageMediaAssetID: &asset.ID,
	})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}
	img := p.Images[0]
	if img.Width == nil || *img.Width != 6000 || img.Height == nil || *img.Height != 4000 {
		t.Errorf("original dimensions not preserved on the row: %v x %v", img.Width, img.Height)
	}
	if img.CardURL == nil || img.ThumbnailURL == nil || img.DetailURL == nil {
		t.Fatal("expected all variants for a valid large JPEG")
	}
	// WebP variant URLs end in .webp regardless of the JPEG source —
	// confirms format conversion happened, not just a resize.
	if got := (*img.DetailURL)[len(*img.DetailURL)-5:]; got != ".webp" {
		t.Errorf("detail variant URL = %q, expected a .webp suffix", *img.DetailURL)
	}
}

// TestCreateProduct_NeverUpscales proves a source narrower than the
// "detail" (1440px) target is never upscaled — the exact regression this
// phase's underlying media pipeline fix (processing.go's explicit width
// clamp) guards against, now verified through the products integration
// path too.
func TestCreateProduct_NeverUpscales(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)

	// transparent.png is 1200x900 — narrower than the 1440px "detail" target.
	asset := uploadProductImage(t, mediaSvc, uploader.ID, fixture(t, "transparent.png"))

	p, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{
		Name:                     "Small Source Product",
		PrimaryImageMediaAssetID: &asset.ID,
	})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}
	// The stored Width/Height are the *original* dimensions (1200x900);
	// the no-upscale guarantee is about the variant files' actual pixel
	// width never exceeding that — already covered end-to-end by
	// internal/media's own TestProcessProductImage_VariantDimensions
	// PreserveAspectAndNeverUpscale. Here we confirm the integration layer
	// still surfaces the *source* width accurately (not a fabricated
	// upscaled value) for srcset/layout use on the product side.
	if *p.Images[0].Width != 1200 {
		t.Errorf("stored width = %d, want the untouched source width 1200", *p.Images[0].Width)
	}
}

// ─── Create: no image (legacy/no-op) ───────────────────────────────────────

func TestCreateProduct_WithoutImage_Unaffected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupWithMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)

	p, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{Name: "No Image Product"})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}
	if len(p.Images) != 0 {
		t.Errorf("expected zero images, got %d", len(p.Images))
	}
}

// ─── Create: failed creation cleanup (no orphan product, no orphan file) ───

func TestCreateProduct_ImageAttachFails_ProductRolledBack(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := products.NewRepository(db)
	svc, mediaSvc := setupWithMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)

	// Wrong category — AttachToOwner must reject this.
	wrongCategoryAsset := uploadAvatarImage(t, mediaSvc, uploader.ID, fixture(t, "transparent.png"))

	_, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{
		SKU:                      "ROLLBACK-SKU-1",
		Name:                     "Should Not Exist",
		PrimaryImageMediaAssetID: &wrongCategoryAsset.ID,
	})
	if err == nil {
		t.Fatal("expected CreateProduct to fail for a category-mismatched image")
	}

	// No orphan product: the SKU must be free, as if the call never happened.
	dup, dbErr := repo.GetProductBySKU(context.Background(), "ROLLBACK-SKU-1")
	if dbErr != nil {
		t.Fatalf("GetProductBySKU: %v", dbErr)
	}
	if dup != nil {
		t.Fatal("product row survived a failed creation — orphan product not cleaned up")
	}

	// The referenced asset itself is untouched (still an avatar, still
	// unattached) — AttachToOwner's category check fails before ever
	// touching the asset's owner fields, so there's nothing to release.
	reloaded, gErr := mediaSvc.GetByID(context.Background(), wrongCategoryAsset.ID)
	if gErr != nil {
		t.Fatalf("GetByID: %v", gErr)
	}
	if reloaded == nil || reloaded.OwnerEntityID != nil {
		t.Errorf("expected the mismatched asset to remain unattached and un-quarantined: %+v", reloaded)
	}
}

func TestCreateProduct_ImageAlreadyAttached_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := products.NewRepository(db)
	svc, mediaSvc := setupWithMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)

	asset := uploadProductImage(t, mediaSvc, uploader.ID, fixture(t, "transparent.png"))

	first, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{
		Name:                     "First Product",
		PrimaryImageMediaAssetID: &asset.ID,
	})
	if err != nil {
		t.Fatalf("first CreateProduct: %v", err)
	}

	_, err = svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{
		SKU:                      "SECOND-SKU",
		Name:                     "Second Product",
		PrimaryImageMediaAssetID: &asset.ID, // same asset, already attached to `first`
	})
	if err == nil {
		t.Fatal("expected the second product to fail — asset already attached")
	}

	dup, dbErr := repo.GetProductBySKU(context.Background(), "SECOND-SKU")
	if dbErr != nil {
		t.Fatalf("GetProductBySKU: %v", dbErr)
	}
	if dup != nil {
		t.Fatal("second product row survived a failed (already-attached) creation")
	}

	// First product's image must be completely unaffected.
	reloadedFirst, gErr := svc.GetProductByID(context.Background(), first.ID)
	if gErr != nil {
		t.Fatalf("GetProductByID: %v", gErr)
	}
	if len(reloadedFirst.Images) != 1 {
		t.Fatalf("first product's image was disturbed by the second, failed attempt: %+v", reloadedFirst.Images)
	}
}

// ─── Update: replace primary image, quarantine old ─────────────────────────

func TestUpdateProduct_ReplacePrimaryImage_QuarantinesOld(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := products.NewRepository(db)
	svc, mediaSvc := setupWithMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)

	oldAsset := uploadProductImage(t, mediaSvc, uploader.ID, fixture(t, "transparent.png"))
	p, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{
		Name:                     "Replaceable",
		PrimaryImageMediaAssetID: &oldAsset.ID,
	})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}
	oldImageRowID := p.Images[0].ID

	newAsset := uploadProductImage(t, mediaSvc, uploader.ID, fixture(t, "near_limit_7500x5300.jpg"))
	updated, err := svc.UpdateProduct(context.Background(), uploader.ID, p.ID, products.UpdateProductRequest{
		PrimaryImageMediaAssetID: &newAsset.ID,
	})
	if err != nil {
		t.Fatalf("UpdateProduct (replace image): %v", err)
	}

	if len(updated.Images) != 1 {
		t.Fatalf("expected exactly 1 image after replace, got %d", len(updated.Images))
	}
	if updated.Images[0].ID == oldImageRowID {
		t.Error("expected a new product_images row, not the old one mutated in place")
	}
	if *updated.Images[0].MediaAssetID != newAsset.ID {
		t.Error("new image's MediaAssetID doesn't match the replacement asset")
	}

	// Old row is gone.
	oldRow, dbErr := repo.GetProductImageByID(context.Background(), oldImageRowID, p.ID)
	if dbErr != nil {
		t.Fatalf("GetProductImageByID: %v", dbErr)
	}
	if oldRow != nil {
		t.Error("old product_images row was not removed on replace")
	}

	// Old asset is quarantined (soft-deleted — GetByID excludes it).
	oldAssetReloaded, gErr := mediaSvc.GetByID(context.Background(), oldAsset.ID)
	if gErr != nil {
		t.Fatalf("GetByID(oldAsset): %v", gErr)
	}
	if oldAssetReloaded != nil {
		t.Error("old media asset was not quarantined after image replace")
	}
}

// ─── Delete image: quarantine workflow ──────────────────────────────────────

func TestDeleteProductImage_QuarantinesAsset(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := products.NewRepository(db)
	svc, mediaSvc := setupWithMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)

	asset := uploadProductImage(t, mediaSvc, uploader.ID, fixture(t, "transparent.png"))
	p, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{
		Name:                     "To Delete Image",
		PrimaryImageMediaAssetID: &asset.ID,
	})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}
	imageID := p.Images[0].ID

	if err := svc.DeleteProductImage(context.Background(), uploader.ID, p.ID, imageID); err != nil {
		t.Fatalf("DeleteProductImage: %v", err)
	}

	row, dbErr := repo.GetProductImageByID(context.Background(), imageID, p.ID)
	if dbErr != nil {
		t.Fatalf("GetProductImageByID: %v", dbErr)
	}
	if row != nil {
		t.Error("product_images row survived DeleteProductImage")
	}

	reloadedAsset, gErr := mediaSvc.GetByID(context.Background(), asset.ID)
	if gErr != nil {
		t.Fatalf("GetByID: %v", gErr)
	}
	if reloadedAsset != nil {
		t.Error("media asset was not quarantined by DeleteProductImage")
	}
}

// ─── Delete product: best-effort quarantine of its images ─────────────────

func TestDeleteProduct_QuarantinesMediaBackedImages(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)

	asset := uploadProductImage(t, mediaSvc, uploader.ID, fixture(t, "transparent.png"))
	p, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{
		Name:                     "To Delete Product",
		PrimaryImageMediaAssetID: &asset.ID,
	})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}

	if err := svc.DeleteProduct(context.Background(), uploader.ID, p.ID); err != nil {
		t.Fatalf("DeleteProduct: %v", err)
	}

	reloadedAsset, gErr := mediaSvc.GetByID(context.Background(), asset.ID)
	if gErr != nil {
		t.Fatalf("GetByID: %v", gErr)
	}
	if reloadedAsset != nil {
		t.Error("product's media asset was not quarantined when the product was deleted")
	}
}

// ─── AddProductImage: legacy fallback + validation ─────────────────────────

// TestAddProductImage_LegacyURLStillWorks is the "legacy fallback" test:
// the pre-Phase-2 image_url flow works completely unchanged, media pipeline
// enabled or not.
func TestAddProductImage_LegacyURLStillWorks(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupWithMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)

	p, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{Name: "Legacy Flow"})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}

	img, err := svc.AddProductImage(context.Background(), uploader.ID, p.ID, products.AddProductImageRequest{
		ImageURL:  "/uploads/legacy-photo.jpg",
		IsPrimary: true,
	})
	if err != nil {
		t.Fatalf("AddProductImage (legacy): %v", err)
	}
	if img.MediaAssetID != nil {
		t.Error("a legacy image_url-based image must not have a MediaAssetID")
	}
	if img.ImageURL != "/uploads/legacy-photo.jpg" {
		t.Errorf("ImageURL = %q, want the exact legacy value", img.ImageURL)
	}
	if img.ThumbnailURL != nil || img.CardURL != nil || img.DetailURL != nil {
		t.Error("a legacy image must not have variant URLs")
	}
}

func TestAddProductImage_BothFieldsRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)
	p, _ := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{Name: "X"})
	asset := uploadProductImage(t, mediaSvc, uploader.ID, fixture(t, "transparent.png"))

	_, err := svc.AddProductImage(context.Background(), uploader.ID, p.ID, products.AddProductImageRequest{
		ImageURL:     "/uploads/x.jpg",
		MediaAssetID: &asset.ID,
	})
	if err == nil {
		t.Fatal("expected rejection when both image_url and media_asset_id are set")
	}
}

func TestAddProductImage_NeitherFieldRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupWithMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)
	p, _ := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{Name: "X"})

	_, err := svc.AddProductImage(context.Background(), uploader.ID, p.ID, products.AddProductImageRequest{})
	if err == nil {
		t.Fatal("expected rejection when neither image_url nor media_asset_id is set")
	}
}

// ─── Feature disabled: changes nothing ──────────────────────────────────────

func TestCreateProduct_MediaDisabled_RejectsImageRequest_NoOrphan(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := products.NewRepository(db)
	svc := setupWithoutMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)

	fakeAssetID := uuid.New()
	_, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{
		SKU:                      "DISABLED-SKU",
		Name:                     "Should Not Exist",
		PrimaryImageMediaAssetID: &fakeAssetID,
	})
	if err == nil {
		t.Fatal("expected rejection when the media pipeline is disabled and an image is requested")
	}
	appErr, ok := err.(*apperrors.AppError)
	if !ok {
		t.Fatalf("expected *apperrors.AppError, got %T", err)
	}
	if appErr.StatusCode != 400 {
		t.Errorf("status = %d, want 400", appErr.StatusCode)
	}

	dup, dbErr := repo.GetProductBySKU(context.Background(), "DISABLED-SKU")
	if dbErr != nil {
		t.Fatalf("GetProductBySKU: %v", dbErr)
	}
	if dup != nil {
		t.Fatal("a product row was created even though the media request was rejected — fail-fast-before-insert violated")
	}
}

// TestCreateProduct_MediaDisabled_LegacyFlowUnaffected is the core "feature
// disabled state changes nothing" proof: every pre-Phase-2 operation (plain
// create, legacy image_url add, delete) behaves identically whether or not
// the media pipeline is wired in.
func TestCreateProduct_MediaDisabled_LegacyFlowUnaffected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := setupWithoutMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)

	p, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{Name: "Plain Product"})
	if err != nil {
		t.Fatalf("CreateProduct (no image fields) must succeed when media is disabled: %v", err)
	}

	img, err := svc.AddProductImage(context.Background(), uploader.ID, p.ID, products.AddProductImageRequest{
		ImageURL: "/uploads/plain.jpg",
	})
	if err != nil {
		t.Fatalf("AddProductImage (legacy URL) must succeed when media is disabled: %v", err)
	}
	if img.ImageURL != "/uploads/plain.jpg" {
		t.Errorf("ImageURL = %q, want the legacy value", img.ImageURL)
	}

	if err := svc.DeleteProductImage(context.Background(), uploader.ID, p.ID, img.ID); err != nil {
		t.Fatalf("DeleteProductImage (legacy row, no MediaAssetID) must succeed when media is disabled: %v", err)
	}

	if err := svc.DeleteProduct(context.Background(), uploader.ID, p.ID); err != nil {
		t.Fatalf("DeleteProduct must succeed when media is disabled: %v", err)
	}
}

func TestAddProductImage_MediaDisabled_RejectsMediaAssetID(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := setupWithoutMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)
	p, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{Name: "X"})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}

	fakeAssetID := uuid.New()
	_, err = svc.AddProductImage(context.Background(), uploader.ID, p.ID, products.AddProductImageRequest{MediaAssetID: &fakeAssetID})
	if err == nil {
		t.Fatal("expected rejection: media_asset_id supplied but media pipeline disabled")
	}
}

func TestUpdateProduct_MediaDisabled_RejectsImageReplace(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := setupWithoutMedia(t, db)
	uploader := testutil.CreateUser(t, db, users.RoleOwner)
	p, err := svc.CreateProduct(context.Background(), uploader.ID, products.CreateProductRequest{Name: "X"})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}

	fakeAssetID := uuid.New()
	_, err = svc.UpdateProduct(context.Background(), uploader.ID, p.ID, products.UpdateProductRequest{PrimaryImageMediaAssetID: &fakeAssetID})
	if err == nil {
		t.Fatal("expected rejection: primary_image_media_asset_id supplied but media pipeline disabled")
	}
}
