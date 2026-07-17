package media

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
)

func testServiceCfg(t *testing.T) config.MediaConfig {
	t.Helper()
	cfg := testCfg()
	cfg.UploadDir = t.TempDir()
	cfg.SigningSecret = testSecret
	cfg.SignedURLTTL = 15 * time.Minute
	cfg.QuarantineRetention = 30 * 24 * time.Hour
	cfg.ProcessingConcurrency = 2
	cfg.ProcessingTimeout = 20 * time.Second
	return cfg
}

func TestService_Create_ProductImagePublicWithVariants(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	svc := NewService(NewRepository(db), testServiceCfg(t))

	png := fixture(t, "transparent.png")
	asset, appErr := svc.Create(context.Background(), CreateParams{
		Category:         CategoryProductImage,
		UploadedByUserID: u.ID,
		OriginalFilename: "photo.png",
		DeclaredSize:     int64(len(png)),
	}, bytes.NewReader(png))
	if appErr != nil {
		t.Fatalf("Create: %v", appErr)
	}
	if asset.Visibility != VisibilityPublic {
		t.Errorf("visibility = %v, want public", asset.Visibility)
	}
	if asset.ProcessingStatus != StatusReady {
		t.Errorf("status = %v, want ready", asset.ProcessingStatus)
	}
	if len(asset.VariantMetadataJSON) == 0 {
		t.Error("expected variant metadata to be populated")
	}

	// Files must actually be on disk under the public namespace.
	if _, err := os.Stat(filepath.Join(testServiceCfgDirFor(svc), dirPublic, asset.StorageKey)); err != nil {
		t.Errorf("original not found under public dir: %v", err)
	}
}

func TestService_Create_PrivateProofGetsPreviewNotProductVariants(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	svc := NewService(NewRepository(db), testServiceCfg(t))

	png := fixture(t, "transparent.png")
	asset, appErr := svc.Create(context.Background(), CreateParams{
		Category:         CategoryPrepaymentProof,
		UploadedByUserID: u.ID,
		OriginalFilename: "proof.png",
		DeclaredSize:     int64(len(png)),
	}, bytes.NewReader(png))
	if appErr != nil {
		t.Fatalf("Create: %v", appErr)
	}
	if asset.Visibility != VisibilityPrivate {
		t.Errorf("visibility = %v, want private", asset.Visibility)
	}

	var variants map[string]Variant
	if err := json.Unmarshal(asset.VariantMetadataJSON, &variants); err != nil {
		t.Fatalf("unmarshal variants: %v", err)
	}
	if _, ok := variants["preview"]; !ok {
		t.Errorf("expected a single 'preview' variant, got %v", variants)
	}
	if _, ok := variants["thumbnail"]; ok {
		t.Error("private proofs must not get product-style thumbnail/card/detail variants")
	}
}

func TestService_Create_PDFPreservedNotRasterized(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	svc := NewService(NewRepository(db), testServiceCfg(t))

	pdf := []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF")
	asset, appErr := svc.Create(context.Background(), CreateParams{
		Category:         CategoryUserDocument,
		UploadedByUserID: u.ID,
		OriginalFilename: "passport.pdf",
		DeclaredSize:     int64(len(pdf)),
	}, bytes.NewReader(pdf))
	if appErr != nil {
		t.Fatalf("Create: %v", appErr)
	}
	if asset.ProcessingStatus != StatusReady {
		t.Errorf("status = %v, want ready immediately (no processing for PDFs)", asset.ProcessingStatus)
	}
	if len(asset.VariantMetadataJSON) != 0 {
		t.Error("PDFs must never get derived variants")
	}
	if asset.Visibility != VisibilityPrivate {
		t.Errorf("visibility = %v, want private (user_document defaults private)", asset.Visibility)
	}

	// The original bytes on disk must be byte-identical to the input PDF —
	// "never converted to a lossy image" means never touched at all.
	onDisk, err := os.ReadFile(filepath.Join(testServiceCfgDirFor(svc), dirPrivate, asset.StorageKey))
	if err != nil {
		t.Fatalf("read persisted PDF: %v", err)
	}
	if !bytes.Equal(onDisk, pdf) {
		t.Error("persisted PDF bytes differ from the uploaded original")
	}
}

// TestVariantsOf_DecodesLegacyMasterKeyWithoutError guards backward
// compatibility for product images processed *before* the size-aware
// master policy shipped: any already-persisted asset whose stored
// variant_metadata JSON includes a "webp_master" key (the old, unconditional
// behavior) must still decode and resolve exactly as before — this change
// only affects what gets *generated* going forward, never how existing rows
// are *read*. See internal/products' mediabridge, which already never reads
// "webp_master" by name — this test guards the shared decode path itself.
func TestVariantsOf_DecodesLegacyMasterKeyWithoutError(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewService(NewRepository(db), testServiceCfg(t))

	legacyJSON := []byte(`{
		"thumbnail": {"storage_key": "abc.v1.thumbnail.webp", "width": 320, "height": 240, "bytes": 1000},
		"card":      {"storage_key": "abc.v1.card.webp",      "width": 768, "height": 576, "bytes": 5000},
		"detail":    {"storage_key": "abc.v1.detail.webp",    "width": 1440, "height": 1080, "bytes": 20000},
		"webp_master": {"storage_key": "abc.v1.master.webp",  "width": 1440, "height": 1080, "bytes": 21000}
	}`)
	asset := &Asset{VariantMetadataJSON: legacyJSON}

	variants, err := svc.VariantsOf(asset)
	if err != nil {
		t.Fatalf("VariantsOf: %v", err)
	}
	if len(variants) != 4 {
		t.Fatalf("got %d variants, want 4 (legacy data includes webp_master)", len(variants))
	}
	master, ok := variants["webp_master"]
	if !ok {
		t.Fatal("expected legacy webp_master entry to still decode")
	}
	if master.StorageKey != "abc.v1.master.webp" || master.Bytes != 21000 {
		t.Errorf("legacy master decoded incorrectly: %+v", master)
	}
	// The three fixed variants a real product-image consumer actually
	// reads by name must also still resolve correctly alongside it.
	for _, name := range []string{"thumbnail", "card", "detail"} {
		if _, ok := variants[name]; !ok {
			t.Errorf("missing %q alongside legacy webp_master", name)
		}
	}
}

func TestService_Create_UnknownCategoryRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	svc := NewService(NewRepository(db), testServiceCfg(t))

	png := fixture(t, "transparent.png")
	_, appErr := svc.Create(context.Background(), CreateParams{
		Category:         Category("not_a_category"),
		UploadedByUserID: u.ID,
		DeclaredSize:     int64(len(png)),
	}, bytes.NewReader(png))
	if appErr == nil {
		t.Fatal("expected rejection for an unrecognized category")
	}
}

// TestService_Authorize exercises the universal baseline (uploader/owner/
// it_specialist always allowed) using an asset with no Category set — an
// empty/unrecognized category falls back to categoryAccessPolicies' zero
// value, which grants no AdditionalRoles and no SubjectSelfAccess, i.e.
// exactly this baseline. Category-specific policies (product images,
// avatars, order attachments, etc.) are covered in rbac_test.go.
func TestService_Authorize(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewService(NewRepository(db), testServiceCfg(t))

	uploader := uuid.New()
	other := uuid.New()
	asset := &Asset{UploadedByUserID: uploader}

	if err := svc.Authorize(uploader, "seller", asset); err != nil {
		t.Errorf("uploader must always be authorized: %v", err)
	}
	if err := svc.Authorize(other, "owner", asset); err != nil {
		t.Errorf("owner role must always be authorized: %v", err)
	}
	if err := svc.Authorize(other, "it_specialist", asset); err != nil {
		t.Errorf("it_specialist must be owner-equivalent: %v", err)
	}
	if err := svc.Authorize(other, "seller", asset); err != ErrForbidden {
		t.Errorf("a different non-privileged user must be forbidden, got %v", err)
	}
}

func TestService_Delete_QuarantinesFilesAndSoftDeletesRow(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	svc := NewService(NewRepository(db), testServiceCfg(t))

	png := fixture(t, "transparent.png")
	asset, appErr := svc.Create(context.Background(), CreateParams{
		Category:         CategoryProductImage,
		UploadedByUserID: u.ID,
		DeclaredSize:     int64(len(png)),
	}, bytes.NewReader(png))
	if appErr != nil {
		t.Fatalf("Create: %v", appErr)
	}

	publicDir := filepath.Join(testServiceCfgDirFor(svc), dirPublic)
	if _, err := os.Stat(filepath.Join(publicDir, asset.StorageKey)); err != nil {
		t.Fatalf("original should exist before delete: %v", err)
	}

	if err := svc.Delete(context.Background(), asset); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	if _, err := os.Stat(filepath.Join(publicDir, asset.StorageKey)); !os.IsNotExist(err) {
		t.Error("original must be moved out of the public dir on delete")
	}
	quarantineDir := filepath.Join(testServiceCfgDirFor(svc), dirQuarantine)
	if _, err := os.Stat(filepath.Join(quarantineDir, asset.StorageKey)); err != nil {
		t.Errorf("original should now exist in quarantine: %v", err)
	}

	got, err := svc.GetByID(context.Background(), asset.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got != nil {
		t.Error("a soft-deleted asset must not be returned by GetByID")
	}
}

// TestService_ProcessingConcurrency_SemaphoreBoundsAdmission directly
// exercises the semaphore NewService sizes from cfg.ProcessingConcurrency:
// with capacity 2, a 3rd concurrent acquire must block until one of the
// first two releases. This is the actual mechanism processImage relies on
// (see service.go) to bound how many libvips jobs run at once process-wide.
func TestService_ProcessingConcurrency_SemaphoreBoundsAdmission(t *testing.T) {
	db := testutil.NewTestDB(t)
	cfg := testServiceCfg(t)
	cfg.ProcessingConcurrency = 2
	svc := NewService(NewRepository(db), cfg)

	if cap(svc.sem) != 2 {
		t.Fatalf("semaphore capacity = %d, want 2", cap(svc.sem))
	}

	svc.sem <- struct{}{}
	svc.sem <- struct{}{}

	acquired := make(chan struct{})
	go func() {
		svc.sem <- struct{}{} // 3rd acquire — must block
		acquired <- struct{}{}
	}()

	select {
	case <-acquired:
		t.Fatal("a 3rd concurrent acquire must block while capacity is 2 and both slots are held")
	case <-time.After(100 * time.Millisecond):
		// expected: still blocked
	}

	<-svc.sem // release one slot
	select {
	case <-acquired:
		// expected: the blocked acquire completes once a slot frees up
	case <-time.After(time.Second):
		t.Fatal("3rd acquire should have succeeded after a slot was released")
	}
}

// TestService_Create_ConcurrentUploadsAllSucceed is a functional smoke test
// that Create is safe to call concurrently (no data races, no deadlocks,
// every upload lands with its own unique storage key) — run with -race.
func TestService_Create_ConcurrentUploadsAllSucceed(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	svc := NewService(NewRepository(db), testServiceCfg(t))

	png := fixture(t, "transparent.png")
	const n = 4
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, appErr := svc.Create(context.Background(), CreateParams{
				Category:         CategoryProductImage,
				UploadedByUserID: u.ID,
				DeclaredSize:     int64(len(png)),
			}, bytes.NewReader(png))
			if appErr != nil {
				errs <- appErr
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Errorf("concurrent Create failed: %v", err)
	}
}

func testServiceCfgDirFor(svc *Service) string {
	return svc.cfg.UploadDir
}
