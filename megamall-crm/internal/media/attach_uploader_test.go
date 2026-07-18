package media

// attach_uploader_test.go — Phase 1 security-review follow-up:
// Service.AttachToOwner must reject a caller who did not upload the asset
// themselves, even when the category matches and the asset is otherwise
// unattached — closing the "attach-jacking" gap where any authenticated
// caller who learned another user's unattached-asset ID could claim that
// upload as their own before the rightful uploader did. See
// AttachToOwner's doc comment for the full reasoning.

import (
	"bytes"
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
)

func TestAttachToOwner_WrongUploader_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	uploader := testutil.CreateUser(t, db, users.RoleSeller)
	otherUser := testutil.CreateUser(t, db, users.RoleSeller)
	svc := NewService(NewRepository(db), testServiceCfg(t))

	png := fixture(t, "transparent.png")
	asset, appErr := svc.Create(context.Background(), CreateParams{
		Category:         CategoryAvatar,
		UploadedByUserID: uploader.ID,
		OriginalFilename: "avatar.png",
		DeclaredSize:     int64(len(png)),
	}, bytes.NewReader(png))
	if appErr != nil {
		t.Fatalf("Create: %v", appErr)
	}

	// otherUser (not the uploader) tries to attach uploader's asset to
	// their own record.
	_, err := svc.AttachToOwner(context.Background(), asset.ID, CategoryAvatar, "users", otherUser.ID, otherUser.ID)
	if err == nil {
		t.Fatal("expected rejection when the caller is not the asset's uploader")
	}
	if err != ErrAssetNotFound {
		t.Errorf("expected ErrAssetNotFound (same generic error as a truly missing asset, not a distinguishing one), got %v", err)
	}

	// The asset must remain unattached and un-quarantined — the rejected
	// attempt shouldn't have any side effect.
	reloaded, gErr := svc.GetByID(context.Background(), asset.ID)
	if gErr != nil {
		t.Fatalf("GetByID: %v", gErr)
	}
	if reloaded == nil || reloaded.OwnerEntityID != nil {
		t.Error("asset should remain unattached after a rejected cross-user attach attempt")
	}
}

func TestAttachToOwner_CorrectUploader_Succeeds(t *testing.T) {
	db := testutil.NewTestDB(t)
	uploader := testutil.CreateUser(t, db, users.RoleSeller)
	svc := NewService(NewRepository(db), testServiceCfg(t))

	png := fixture(t, "transparent.png")
	asset, appErr := svc.Create(context.Background(), CreateParams{
		Category:         CategoryAvatar,
		UploadedByUserID: uploader.ID,
		OriginalFilename: "avatar.png",
		DeclaredSize:     int64(len(png)),
	}, bytes.NewReader(png))
	if appErr != nil {
		t.Fatalf("Create: %v", appErr)
	}

	attached, err := svc.AttachToOwner(context.Background(), asset.ID, CategoryAvatar, "users", uploader.ID, uploader.ID)
	if err != nil {
		t.Fatalf("AttachToOwner (correct uploader): %v", err)
	}
	if attached.OwnerEntityID == nil || *attached.OwnerEntityID != uploader.ID {
		t.Errorf("expected asset attached to %s, got %v", uploader.ID, attached.OwnerEntityID)
	}
}

func TestAttachToOwner_OwnerActingOnBehalf_UsesActorAsUploader(t *testing.T) {
	// Mirrors internal/users' "owner uploads and attaches an avatar on
	// another user's behalf" flow: the uploader (and thus the required
	// expectUploaderID) is the acting owner, not the avatar's eventual
	// subject (ownerEntityID).
	db := testutil.NewTestDB(t)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	subject := testutil.CreateUser(t, db, users.RoleSeller)
	svc := NewService(NewRepository(db), testServiceCfg(t))

	png := fixture(t, "transparent.png")
	asset, appErr := svc.Create(context.Background(), CreateParams{
		Category:         CategoryAvatar,
		UploadedByUserID: owner.ID,
		OriginalFilename: "avatar.png",
		DeclaredSize:     int64(len(png)),
	}, bytes.NewReader(png))
	if appErr != nil {
		t.Fatalf("Create: %v", appErr)
	}

	attached, err := svc.AttachToOwner(context.Background(), asset.ID, CategoryAvatar, "users", subject.ID, owner.ID)
	if err != nil {
		t.Fatalf("AttachToOwner (owner-on-behalf-of): %v", err)
	}
	if attached.OwnerEntityID == nil || *attached.OwnerEntityID != subject.ID {
		t.Errorf("expected asset attached to subject %s, got %v", subject.ID, attached.OwnerEntityID)
	}
}

func TestAttachToOwner_NonexistentUploaderID_RejectedSameAsMissingAsset(t *testing.T) {
	db := testutil.NewTestDB(t)
	uploader := testutil.CreateUser(t, db, users.RoleSeller)
	svc := NewService(NewRepository(db), testServiceCfg(t))

	png := fixture(t, "transparent.png")
	asset, appErr := svc.Create(context.Background(), CreateParams{
		Category:         CategoryAvatar,
		UploadedByUserID: uploader.ID,
		OriginalFilename: "avatar.png",
		DeclaredSize:     int64(len(png)),
	}, bytes.NewReader(png))
	if appErr != nil {
		t.Fatalf("Create: %v", appErr)
	}

	fakeCaller := uuid.New()
	_, err := svc.AttachToOwner(context.Background(), asset.ID, CategoryAvatar, "users", fakeCaller, fakeCaller)
	if err != ErrAssetNotFound {
		t.Errorf("expected ErrAssetNotFound, got %v", err)
	}
}
