package users_test

// media_integration_test.go — Phase 1 (remaining uploads): avatar and
// user_document ↔ centralized media pipeline integration tests. Covers
// attach/replace/delete quarantine discipline, RBAC-relevant category
// mismatches, legacy avatar_url/file_url fallback, signed-URL resolution
// on read, and "feature disabled changes nothing" — mirrors
// internal/products/media_integration_test.go's structure exactly.
//
// Uses a scratch DB (via internal/testutil) and a temporary upload
// directory only — never production.

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/media"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	usersmediabridge "github.com/megamall/crm/internal/users/mediabridge"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/tools/imagebench"
	"gorm.io/gorm"
)

const testMediaSecret = "users-media-integration-test-secret"

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
		ProcessingTimeout:     60 * time.Second,
		UploadDir:             t.TempDir(),
	}
}

// setupWithMedia builds a real, working users.Service wired to a real
// media.Service, exactly mirroring how usersmediabridge.Adapters wires
// cmd/server/main.go when MEDIA_PIPELINE_ENABLED is true.
func setupWithMedia(t *testing.T, db *gorm.DB) (*users.Service, *media.Service) {
	t.Helper()
	mediaSvc := media.NewService(media.NewRepository(db), testMediaCfg(t))
	attachAvatar, attachDoc, release, signedURL := usersmediabridge.Adapters(mediaSvc)
	svc := users.NewService(users.NewRepository(db))
	svc.SetMediaAdapters(attachAvatar, attachDoc, release, signedURL)
	return svc, mediaSvc
}

// setupWithoutMedia mirrors a MEDIA_PIPELINE_ENABLED=false deploy: the
// adapters are simply never set, exactly as main.go leaves them when the
// flag is off.
func setupWithoutMedia(t *testing.T, db *gorm.DB) *users.Service {
	t.Helper()
	return users.NewService(users.NewRepository(db))
}

var fixturesOnce = map[string][]byte{}

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

func uploadAsset(t *testing.T, mediaSvc *media.Service, category media.Category, uploaderID uuid.UUID, filename string, buf []byte) *media.Asset {
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

// ─── Avatar: attach via PatchMe (self) and Update (owner-on-behalf-of) ─────

func TestPatchMe_AvatarMediaAssetID_Success(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	u := testutil.CreateUser(t, db, users.RoleSeller)

	asset := uploadAsset(t, mediaSvc, media.CategoryAvatar, u.ID, "avatar.png", fixture(t, "transparent.png"))

	updated, err := svc.PatchMe(context.Background(), u.ID, users.PatchMeRequest{AvatarMediaAssetID: &asset.ID})
	if err != nil {
		t.Fatalf("PatchMe: %v", err)
	}
	if updated.AvatarMediaAssetID == nil || *updated.AvatarMediaAssetID != asset.ID {
		t.Errorf("AvatarMediaAssetID not set correctly: %+v", updated.AvatarMediaAssetID)
	}
	if updated.AvatarWidth == nil || *updated.AvatarWidth != 1200 || updated.AvatarHeight == nil || *updated.AvatarHeight != 900 {
		t.Errorf("avatar dimensions not denormalized correctly: %v x %v", updated.AvatarWidth, updated.AvatarHeight)
	}
	if updated.AvatarURL == nil || *updated.AvatarURL == "" {
		t.Error("expected a freshly-resolved signed AvatarURL after attach")
	}

	// Re-fetch confirms persistence (of the FK/dimensions — not the URL,
	// which is never persisted) and confirms GetByID also resolves a fresh
	// signed URL on read.
	reloaded, err := svc.GetByID(context.Background(), u.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if reloaded.AvatarMediaAssetID == nil || *reloaded.AvatarMediaAssetID != asset.ID {
		t.Fatalf("avatar_media_asset_id did not persist: %+v", reloaded.AvatarMediaAssetID)
	}
	if reloaded.AvatarURL == nil || *reloaded.AvatarURL == "" {
		t.Error("expected GetByID to resolve a fresh signed AvatarURL for a pipeline-backed avatar")
	}
}

func TestUpdate_AvatarMediaAssetID_OwnerOnBehalfOf(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	target := testutil.CreateUser(t, db, users.RoleCourier)
	owner := testutil.CreateUser(t, db, users.RoleOwner)

	asset := uploadAsset(t, mediaSvc, media.CategoryAvatar, owner.ID, "avatar.png", fixture(t, "transparent.png"))

	updated, err := svc.Update(context.Background(), target.ID, users.UpdateUserRequest{AvatarMediaAssetID: &asset.ID}, owner.ID)
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.AvatarMediaAssetID == nil || *updated.AvatarMediaAssetID != asset.ID {
		t.Error("owner-on-behalf-of avatar attach did not set AvatarMediaAssetID")
	}
}

func TestUpdate_AvatarReplace_QuarantinesOld(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	u := testutil.CreateUser(t, db, users.RoleSeller)

	oldAsset := uploadAsset(t, mediaSvc, media.CategoryAvatar, u.ID, "old.png", fixture(t, "transparent.png"))
	if _, err := svc.PatchMe(context.Background(), u.ID, users.PatchMeRequest{AvatarMediaAssetID: &oldAsset.ID}); err != nil {
		t.Fatalf("initial PatchMe: %v", err)
	}

	newAsset := uploadAsset(t, mediaSvc, media.CategoryAvatar, u.ID, "new.png", fixture(t, "near_limit_7500x5300.jpg"))
	if _, err := svc.PatchMe(context.Background(), u.ID, users.PatchMeRequest{AvatarMediaAssetID: &newAsset.ID}); err != nil {
		t.Fatalf("replace PatchMe: %v", err)
	}

	oldReloaded, err := mediaSvc.GetByID(context.Background(), oldAsset.ID)
	if err != nil {
		t.Fatalf("GetByID(oldAsset): %v", err)
	}
	if oldReloaded != nil {
		t.Error("old avatar asset was not quarantined after replace")
	}

	newReloaded, err := mediaSvc.GetByID(context.Background(), newAsset.ID)
	if err != nil || newReloaded == nil {
		t.Fatalf("new avatar asset should still exist: %v", err)
	}
}

func TestPatchMe_AvatarCategoryMismatch_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	u := testutil.CreateUser(t, db, users.RoleSeller)

	wrongCategory := uploadAsset(t, mediaSvc, media.CategoryProductImage, u.ID, "product.png", fixture(t, "transparent.png"))

	_, err := svc.PatchMe(context.Background(), u.ID, users.PatchMeRequest{AvatarMediaAssetID: &wrongCategory.ID})
	if err == nil {
		t.Fatal("expected rejection for a category-mismatched avatar asset")
	}

	reloaded, gErr := mediaSvc.GetByID(context.Background(), wrongCategory.ID)
	if gErr != nil {
		t.Fatalf("GetByID: %v", gErr)
	}
	if reloaded == nil || reloaded.OwnerEntityID != nil {
		t.Error("mismatched asset should remain unattached and un-quarantined")
	}
}

func TestUpdate_AvatarURLAndMediaAssetID_BothSet_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	u := testutil.CreateUser(t, db, users.RoleSeller)
	asset := uploadAsset(t, mediaSvc, media.CategoryAvatar, u.ID, "avatar.png", fixture(t, "transparent.png"))

	url := "/uploads/avatars/legacy.jpg"
	_, err := svc.Update(context.Background(), u.ID, users.UpdateUserRequest{AvatarURL: &url, AvatarMediaAssetID: &asset.ID}, u.ID)
	if err == nil {
		t.Fatal("expected rejection when both avatar_url and avatar_media_asset_id are set")
	}
}

func TestUpdate_LegacyAvatarURL_StillWorks(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupWithMedia(t, db)
	u := testutil.CreateUser(t, db, users.RoleSeller)

	url := "/uploads/avatars/" + u.ID.String() + ".jpg"
	updated, err := svc.Update(context.Background(), u.ID, users.UpdateUserRequest{AvatarURL: &url}, u.ID)
	if err != nil {
		t.Fatalf("Update (legacy avatar_url): %v", err)
	}
	if updated.AvatarURL == nil || *updated.AvatarURL != url {
		t.Errorf("AvatarURL = %v, want the exact legacy value %q", updated.AvatarURL, url)
	}
	if updated.AvatarMediaAssetID != nil {
		t.Error("a legacy avatar_url update must not set AvatarMediaAssetID")
	}
}

// ─── User documents: attach, mutual exclusivity, delete quarantine ────────

func TestCreateDocument_MediaAssetID_Success(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	subject := testutil.CreateUser(t, db, users.RoleSeller)
	owner := testutil.CreateUser(t, db, users.RoleOwner)

	asset := uploadAsset(t, mediaSvc, media.CategoryUserDocument, owner.ID, "passport.png", fixture(t, "transparent.png"))
	docType := "passport"

	doc, err := svc.CreateDocument(context.Background(), subject.ID, owner.ID, users.CreateUserDocumentRequest{
		MediaAssetID: &asset.ID,
		DocumentType: &docType,
	})
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}
	if doc.MediaAssetID == nil || *doc.MediaAssetID != asset.ID {
		t.Errorf("MediaAssetID not set correctly: %+v", doc.MediaAssetID)
	}
	if doc.OriginalFilename != "passport.png" {
		t.Errorf("OriginalFilename = %q, want the asset's own recorded filename", doc.OriginalFilename)
	}
	if doc.ContentType == nil || *doc.ContentType == "" {
		t.Error("expected ContentType to be sourced from the media asset's detected MIME type")
	}
	if doc.FileURL == "" {
		t.Error("expected a freshly-resolved signed FileURL after attach")
	}

	docs, err := svc.ListDocuments(context.Background(), subject.ID)
	if err != nil {
		t.Fatalf("ListDocuments: %v", err)
	}
	if len(docs) != 1 || docs[0].FileURL == "" {
		t.Fatalf("expected 1 document with a resolved FileURL on list, got %+v", docs)
	}
}

func TestCreateDocument_BothFieldsRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	subject := testutil.CreateUser(t, db, users.RoleSeller)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	asset := uploadAsset(t, mediaSvc, media.CategoryUserDocument, owner.ID, "doc.png", fixture(t, "transparent.png"))

	_, err := svc.CreateDocument(context.Background(), subject.ID, owner.ID, users.CreateUserDocumentRequest{
		FileURL:          "/uploads/legacy.pdf",
		OriginalFilename: "legacy.pdf",
		MediaAssetID:     &asset.ID,
	})
	if err == nil {
		t.Fatal("expected rejection when both file_url and media_asset_id are set")
	}
}

func TestCreateDocument_NeitherFieldRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := setupWithoutMedia(t, db)
	subject := testutil.CreateUser(t, db, users.RoleSeller)
	owner := testutil.CreateUser(t, db, users.RoleOwner)

	_, err := svc.CreateDocument(context.Background(), subject.ID, owner.ID, users.CreateUserDocumentRequest{})
	if err == nil {
		t.Fatal("expected rejection when neither file_url nor media_asset_id is set")
	}
}

func TestDeleteDocument_QuarantinesAsset(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	subject := testutil.CreateUser(t, db, users.RoleSeller)
	owner := testutil.CreateUser(t, db, users.RoleOwner)

	asset := uploadAsset(t, mediaSvc, media.CategoryUserDocument, owner.ID, "doc.png", fixture(t, "transparent.png"))
	doc, err := svc.CreateDocument(context.Background(), subject.ID, owner.ID, users.CreateUserDocumentRequest{MediaAssetID: &asset.ID})
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}

	if err := svc.DeleteDocument(context.Background(), subject.ID, doc.ID, owner.ID); err != nil {
		t.Fatalf("DeleteDocument: %v", err)
	}

	reloaded, gErr := mediaSvc.GetByID(context.Background(), asset.ID)
	if gErr != nil {
		t.Fatalf("GetByID: %v", gErr)
	}
	if reloaded != nil {
		t.Error("media asset was not quarantined by DeleteDocument")
	}
}

func TestCreateDocument_LegacyFileURLStillWorks(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupWithMedia(t, db)
	subject := testutil.CreateUser(t, db, users.RoleSeller)
	owner := testutil.CreateUser(t, db, users.RoleOwner)

	doc, err := svc.CreateDocument(context.Background(), subject.ID, owner.ID, users.CreateUserDocumentRequest{
		FileURL:          "/uploads/legacy.pdf",
		OriginalFilename: "legacy.pdf",
	})
	if err != nil {
		t.Fatalf("CreateDocument (legacy): %v", err)
	}
	if doc.MediaAssetID != nil {
		t.Error("a legacy file_url document must not have a MediaAssetID")
	}
	if doc.FileURL != "/uploads/legacy.pdf" {
		t.Errorf("FileURL = %q, want the exact legacy value", doc.FileURL)
	}
}

// ─── Feature disabled: changes nothing ─────────────────────────────────────

func TestPatchMe_MediaDisabled_RejectsAvatarMediaAssetID(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := setupWithoutMedia(t, db)
	u := testutil.CreateUser(t, db, users.RoleSeller)

	fakeAssetID := uuid.New()
	_, err := svc.PatchMe(context.Background(), u.ID, users.PatchMeRequest{AvatarMediaAssetID: &fakeAssetID})
	if err == nil {
		t.Fatal("expected rejection: avatar_media_asset_id supplied but media pipeline disabled")
	}
	appErr, ok := err.(*apperrors.AppError)
	if !ok {
		t.Fatalf("expected *apperrors.AppError, got %T", err)
	}
	if appErr.StatusCode != 400 {
		t.Errorf("status = %d, want 400", appErr.StatusCode)
	}
}

func TestPatchMe_MediaDisabled_LegacyFlowUnaffected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := setupWithoutMedia(t, db)
	u := testutil.CreateUser(t, db, users.RoleSeller)

	name := "Updated Name"
	updated, err := svc.PatchMe(context.Background(), u.ID, users.PatchMeRequest{FullName: &name})
	if err != nil {
		t.Fatalf("PatchMe (no avatar fields) must succeed when media is disabled: %v", err)
	}
	if updated.FullName != name {
		t.Errorf("FullName = %q, want %q", updated.FullName, name)
	}
}

func TestCreateDocument_MediaDisabled_RejectsMediaAssetID_NoOrphan(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := setupWithoutMedia(t, db)
	subject := testutil.CreateUser(t, db, users.RoleSeller)
	owner := testutil.CreateUser(t, db, users.RoleOwner)

	fakeAssetID := uuid.New()
	_, err := svc.CreateDocument(context.Background(), subject.ID, owner.ID, users.CreateUserDocumentRequest{MediaAssetID: &fakeAssetID})
	if err == nil {
		t.Fatal("expected rejection: media_asset_id supplied but media pipeline disabled")
	}

	docs, lErr := svc.ListDocuments(context.Background(), subject.ID)
	if lErr != nil {
		t.Fatalf("ListDocuments: %v", lErr)
	}
	if len(docs) != 0 {
		t.Fatal("a document row was created even though the media request was rejected")
	}
}
