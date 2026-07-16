package media

// rbac_test.go — Pins the per-category access matrix designed in rbac.go,
// so a future edit to categoryAccessPolicies (or a regression in
// Service.Authorize) is caught as a failing test rather than a silent
// authorization change. No database required — Authorize only reads the
// in-memory Asset struct passed to it.

import (
	"testing"

	"github.com/google/uuid"
)

func usersEntityType() *string {
	s := "users"
	return &s
}

func ordersEntityType() *string {
	s := "orders"
	return &s
}

// assetFor builds a minimal Asset for a given category/uploader, optionally
// with an owner_entity_type/owner_entity_id (used for SubjectSelfAccess
// cases).
func assetFor(category Category, uploader uuid.UUID, ownerType *string, ownerID *uuid.UUID) *Asset {
	return &Asset{
		Category:         category,
		UploadedByUserID: uploader,
		OwnerEntityType:  ownerType,
		OwnerEntityID:    ownerID,
	}
}

func TestAuthorize_OwnerAndITSpecialist_AlwaysAllowed_AllCategories(t *testing.T) {
	svc := NewService(nil, testServiceCfg(t))
	uploader := uuid.New()
	caller := uuid.New()

	for _, cat := range []Category{
		CategoryProductImage, CategoryAvatar, CategoryOrderAttachment,
		CategoryPrepaymentProof, CategoryUserDocument, CategoryCashHandoverProof,
	} {
		asset := assetFor(cat, uploader, nil, nil)
		if err := svc.Authorize(caller, "owner", asset); err != nil {
			t.Errorf("category %s: owner should always be authorized, got %v", cat, err)
		}
		if err := svc.Authorize(caller, "it_specialist", asset); err != nil {
			t.Errorf("category %s: it_specialist should always be authorized, got %v", cat, err)
		}
	}
}

func TestAuthorize_Uploader_AlwaysAllowed_AllCategories(t *testing.T) {
	svc := NewService(nil, testServiceCfg(t))
	uploader := uuid.New()

	for _, cat := range []Category{
		CategoryProductImage, CategoryAvatar, CategoryOrderAttachment,
		CategoryPrepaymentProof, CategoryUserDocument, CategoryCashHandoverProof,
	} {
		asset := assetFor(cat, uploader, nil, nil)
		// Uploader's own role is deliberately a low-privilege one
		// ("seller") to prove the uploader check doesn't depend on role.
		if err := svc.Authorize(uploader, "seller", asset); err != nil {
			t.Errorf("category %s: uploader should always be authorized regardless of role, got %v", cat, err)
		}
	}
}

func TestAuthorize_ProductImage_WarehouseManagerAllowed_OthersRejected(t *testing.T) {
	svc := NewService(nil, testServiceCfg(t))
	uploader := uuid.New()
	other := uuid.New()
	asset := assetFor(CategoryProductImage, uploader, nil, nil)

	if err := svc.Authorize(other, "warehouse_manager", asset); err != nil {
		t.Errorf("warehouse_manager should manage any product image, got %v", err)
	}
	for _, role := range []string{"seller", "dispatcher", "manager", "sales_team_lead", "courier"} {
		if err := svc.Authorize(other, role, asset); err != ErrForbidden {
			t.Errorf("role %q should NOT manage a product image it didn't upload, got %v", role, err)
		}
	}
}

func TestAuthorize_Avatar_SubjectSelfAccess(t *testing.T) {
	svc := NewService(nil, testServiceCfg(t))
	uploaderOwner := uuid.New() // e.g. an owner uploading on the subject's behalf
	subject := uuid.New()       // the user the avatar belongs to
	stranger := uuid.New()

	asset := assetFor(CategoryAvatar, uploaderOwner, usersEntityType(), &subject)

	if err := svc.Authorize(subject, "seller", asset); err != nil {
		t.Errorf("the avatar's subject should be able to access it even though someone else uploaded it, got %v", err)
	}
	if err := svc.Authorize(stranger, "seller", asset); err != ErrForbidden {
		t.Errorf("an unrelated seller must NOT access another user's avatar, got %v", err)
	}
}

func TestAuthorize_Avatar_NoSubjectSelfAccessWithoutUsersOwnerEntity(t *testing.T) {
	svc := NewService(nil, testServiceCfg(t))
	uploader := uuid.New()
	someID := uuid.New()

	// owner_entity_type is "orders", not "users" — SubjectSelfAccess must
	// only ever match a "users" owner entity, never coincidentally match a
	// caller ID against some other entity's ID.
	asset := assetFor(CategoryAvatar, uploader, ordersEntityType(), &someID)

	if err := svc.Authorize(someID, "seller", asset); err != ErrForbidden {
		t.Errorf("SubjectSelfAccess must not match a non-'users' owner_entity_type, got %v", err)
	}
}

func TestAuthorize_OrderAttachment_MatchesOrdersRoleSet(t *testing.T) {
	svc := NewService(nil, testServiceCfg(t))
	uploader := uuid.New()
	other := uuid.New()
	asset := assetFor(CategoryOrderAttachment, uploader, nil, nil)

	for _, role := range []string{"sales_team_lead", "manager", "seller", "dispatcher"} {
		if err := svc.Authorize(other, role, asset); err != nil {
			t.Errorf("role %q should access any order attachment (mirrors orders.go attachmentWriteRoles), got %v", role, err)
		}
	}
	for _, role := range []string{"courier", "warehouse_manager"} {
		if err := svc.Authorize(other, role, asset); err != ErrForbidden {
			t.Errorf("role %q must NOT access an order attachment it didn't upload, got %v", role, err)
		}
	}
}

func TestAuthorize_PrepaymentProof_MatchesOrdersPrepaymentRoleSet(t *testing.T) {
	svc := NewService(nil, testServiceCfg(t))
	uploader := uuid.New()
	other := uuid.New()
	asset := assetFor(CategoryPrepaymentProof, uploader, nil, nil)

	for _, role := range []string{"sales_team_lead", "manager", "seller", "dispatcher"} {
		if err := svc.Authorize(other, role, asset); err != nil {
			t.Errorf("role %q should access any prepayment proof (mirrors orders.go prepaymentRoles), got %v", role, err)
		}
	}
	for _, role := range []string{"courier", "warehouse_manager"} {
		if err := svc.Authorize(other, role, asset); err != ErrForbidden {
			t.Errorf("role %q must NOT access a prepayment proof it didn't upload, got %v", role, err)
		}
	}
}

// TestAuthorize_UserDocument_StrictlyOwnerOnly is the most important
// negative case in this file: HR/passport-class documents must remain
// owner-only with NO self-view, exactly matching internal/users/handler.go's
// existing document routes (all gated RequireRoles(RoleOwner) with no
// self-service path). Even the document's own subject must be rejected.
func TestAuthorize_UserDocument_StrictlyOwnerOnly(t *testing.T) {
	svc := NewService(nil, testServiceCfg(t))
	uploaderOwner := uuid.New()
	subject := uuid.New()

	// Even if owner_entity_type/id point at the document's subject (as a
	// real HR-document upload would set them), that subject must still be
	// rejected — CategoryUserDocument's policy has no SubjectSelfAccess.
	asset := assetFor(CategoryUserDocument, uploaderOwner, usersEntityType(), &subject)

	if err := svc.Authorize(subject, "seller", asset); err != ErrForbidden {
		t.Errorf("a user must NOT be able to self-view their own HR document — got %v, want ErrForbidden", err)
	}
	for _, role := range []string{"manager", "sales_team_lead", "dispatcher", "warehouse_manager", "courier"} {
		if err := svc.Authorize(uuid.New(), role, asset); err != ErrForbidden {
			t.Errorf("role %q must NOT access an HR document — got %v, want ErrForbidden", role, err)
		}
	}
}

func TestAuthorize_CashHandoverProof_DispatcherAllowed_OtherCouriersRejected(t *testing.T) {
	svc := NewService(nil, testServiceCfg(t))
	uploaderCourier := uuid.New() // the courier who submitted the handover
	otherCourier := uuid.New()
	dispatcher := uuid.New()
	asset := assetFor(CategoryCashHandoverProof, uploaderCourier, nil, nil)

	if err := svc.Authorize(dispatcher, "dispatcher", asset); err != nil {
		t.Errorf("dispatcher should see any courier's cash handover proof, got %v", err)
	}
	if err := svc.Authorize(otherCourier, "courier", asset); err != ErrForbidden {
		t.Errorf("a different courier must NOT see another courier's handover proof, got %v", err)
	}
	// The uploading courier themselves is allowed via the uploader check,
	// not via AdditionalRoles.
	if err := svc.Authorize(uploaderCourier, "courier", asset); err != nil {
		t.Errorf("the submitting courier should see their own handover proof, got %v", err)
	}
}
