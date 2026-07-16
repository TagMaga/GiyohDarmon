package media

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
)

// newTestAsset returns a minimal, valid Asset ready for repo.Create,
// belonging to uploader. Tests that need a specific field override it
// after this returns.
func newTestAsset(uploader uuid.UUID) *Asset {
	key := uuid.New().String() + ".jpg"
	return &Asset{
		ID:                 uuid.New(),
		StorageKey:         key,
		OriginalFilename:   "photo.jpg",
		DetectedMimeType:   "image/jpeg",
		OriginalSizeBytes:  12345,
		ChecksumSHA256:     "deadbeef",
		Visibility:         VisibilityPublic,
		Category:           CategoryProductImage,
		UploadedByUserID:   uploader,
		ProcessingStatus:   StatusPending,
		OriginalStorageKey: key,
	}
}

func TestRepository_CreateAndGetByID(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	repo := NewRepository(db)

	a := newTestAsset(u.ID)
	if err := repo.Create(context.Background(), a); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := repo.GetByID(context.Background(), a.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got == nil {
		t.Fatal("expected asset, got nil")
	}
	if got.StorageKey != a.StorageKey || got.Category != CategoryProductImage {
		t.Errorf("got %+v, want matching StorageKey/Category", got)
	}
}

func TestRepository_GetByID_MissingReturnsNilNoError(t *testing.T) {
	db := testutil.NewTestDB(t)
	repo := NewRepository(db)

	got, err := repo.GetByID(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("expected nil error for a missing row, got %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil asset for a missing row, got %+v", got)
	}
}

func TestRepository_GetByStorageKey_MatchesOriginalOrCurrent(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	repo := NewRepository(db)

	a := newTestAsset(u.ID)
	if err := repo.Create(context.Background(), a); err != nil {
		t.Fatalf("Create: %v", err)
	}

	byOriginal, err := repo.GetByStorageKey(context.Background(), a.OriginalStorageKey)
	if err != nil || byOriginal == nil {
		t.Fatalf("lookup by original_storage_key failed: err=%v got=%v", err, byOriginal)
	}
	if byOriginal.ID != a.ID {
		t.Errorf("wrong asset returned")
	}
}

func TestRepository_UpdateProcessingResult(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	repo := NewRepository(db)

	a := newTestAsset(u.ID)
	if err := repo.Create(context.Background(), a); err != nil {
		t.Fatalf("Create: %v", err)
	}

	w, h := 320, 240
	variantJSON := []byte(`{"thumbnail":{"storage_key":"x.webp","width":320,"height":240,"bytes":1000}}`)
	if err := repo.UpdateProcessingResult(context.Background(), a.ID, StatusReady, variantJSON, &w, &h); err != nil {
		t.Fatalf("UpdateProcessingResult: %v", err)
	}

	got, err := repo.GetByID(context.Background(), a.ID)
	if err != nil || got == nil {
		t.Fatalf("GetByID after update: err=%v got=%v", err, got)
	}
	if got.ProcessingStatus != StatusReady {
		t.Errorf("processing_status = %v, want ready", got.ProcessingStatus)
	}
	if got.Width == nil || *got.Width != 320 || got.Height == nil || *got.Height != 240 {
		t.Errorf("width/height not persisted correctly: %+v", got)
	}
	if len(got.VariantMetadataJSON) == 0 {
		t.Error("variant_metadata not persisted")
	}
}

func TestRepository_SoftDeleteAndQuarantine(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	repo := NewRepository(db)

	a := newTestAsset(u.ID)
	if err := repo.Create(context.Background(), a); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := repo.SoftDeleteAndQuarantine(context.Background(), a.ID); err != nil {
		t.Fatalf("SoftDeleteAndQuarantine: %v", err)
	}

	got, err := repo.GetByID(context.Background(), a.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got != nil {
		t.Fatal("GetByID must not return a soft-deleted asset")
	}

	purgeable, err := repo.ListPurgeable(context.Background(), time.Now().Add(time.Hour), 10)
	if err != nil {
		t.Fatalf("ListPurgeable: %v", err)
	}
	found := false
	for _, p := range purgeable {
		if p.ID == a.ID {
			found = true
		}
	}
	if !found {
		t.Error("quarantined asset should appear in ListPurgeable once its window has passed")
	}
}

func TestRepository_ListPurgeable_RespectsRetentionWindow(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	repo := NewRepository(db)

	a := newTestAsset(u.ID)
	if err := repo.Create(context.Background(), a); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := repo.SoftDeleteAndQuarantine(context.Background(), a.ID); err != nil {
		t.Fatalf("SoftDeleteAndQuarantine: %v", err)
	}

	// cutoff in the past — the asset was JUST quarantined, so it should
	// not be purgeable yet under a retention window that hasn't elapsed.
	notYet, err := repo.ListPurgeable(context.Background(), time.Now().Add(-time.Hour), 10)
	if err != nil {
		t.Fatalf("ListPurgeable: %v", err)
	}
	for _, p := range notYet {
		if p.ID == a.ID {
			t.Fatal("a just-quarantined asset must not be purgeable before its retention window elapses")
		}
	}
}

func TestRepository_ListOrphanedByOwner(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	repo := NewRepository(db)

	stillExists := uuid.New()
	orphaned := uuid.New()

	a1 := newTestAsset(u.ID)
	ownerType := "orders"
	a1.OwnerEntityType = &ownerType
	a1.OwnerEntityID = &stillExists
	if err := repo.Create(context.Background(), a1); err != nil {
		t.Fatalf("Create a1: %v", err)
	}

	a2 := newTestAsset(u.ID)
	a2.OwnerEntityType = &ownerType
	a2.OwnerEntityID = &orphaned
	if err := repo.Create(context.Background(), a2); err != nil {
		t.Fatalf("Create a2: %v", err)
	}

	rows, err := repo.ListOrphanedByOwner(context.Background(), "orders", []uuid.UUID{stillExists})
	if err != nil {
		t.Fatalf("ListOrphanedByOwner: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != a2.ID {
		t.Errorf("expected exactly the orphaned asset (owner %s no longer exists), got %d rows", orphaned, len(rows))
	}
}

// TestRepository_ZeroProductCleanDB verifies media repository operations work
// correctly against a schema with no product/order/other business data at
// all — the media_assets table has no FK to products, so a media asset can
// exist (e.g. mid-upload-then-attach) before any owning object does.
func TestRepository_ZeroProductCleanDB(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleOwner)
	repo := NewRepository(db)

	a := newTestAsset(u.ID)
	a.OwnerEntityType = nil
	a.OwnerEntityID = nil // no owning object yet — upload-then-attach flow
	if err := repo.Create(context.Background(), a); err != nil {
		t.Fatalf("Create with no owner: %v", err)
	}
	got, err := repo.GetByID(context.Background(), a.ID)
	if err != nil || got == nil {
		t.Fatalf("GetByID: err=%v got=%v", err, got)
	}
}
