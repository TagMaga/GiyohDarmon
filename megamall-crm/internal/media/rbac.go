package media

// rbac.go — Per-category access policy for Service.Authorize.
//
// AUDIT (2026-07-16): the original Authorize implementation allowed only
// the uploader themselves or an owner-equivalent role ("owner"/
// "it_specialist") — nobody else, regardless of category. That is too
// restrictive for every category except CategoryUserDocument: e.g. a
// warehouse_manager who did not personally upload a given product image
// could not delete it even though internal/products lets any
// warehouse_manager manage any product; a dispatcher could not view a
// prepayment proof uploaded by a seller even though internal/orders lets
// any of {owner, dispatcher, seller, manager, sales_team_lead} manage any
// order's prepayments. This file fixes that by mirroring each category's
// owning domain module's *role-level* RBAC, as read directly from that
// module's routes.go on 2026-07-16 (exact source cited per entry below).
//
// EXPLICIT LIMITATION (matches the task's "do not connect domain modules
// yet" instruction): this mirrors role-level access only. It does not call
// into internal/orders, internal/products, internal/users, or
// internal/courier, and so cannot verify true per-object ownership (e.g.
// "is this seller actually assigned to the order this attachment belongs
// to"). It is only as scoped as the mirrored module already is at the
// route-gate level — for order_attachment/prepayment_proof this is not a
// narrowing from the real resource's own access model, since orders.go's
// route-level RBAC itself grants any of {owner, sales_team_lead, manager,
// seller, dispatcher} access to any order via GET /orders/:id, with no
// per-row ownership filter visible at that layer either. Real per-object
// scoping requires the cross-module integration explicitly deferred to a
// later phase — see the Phase 1 report's "remaining questions" and
// Service.Authorize's own doc comment.
//
// Keeping this table in sync when a domain module's RBAC changes is a
// manual step until that integration happens; rbac_test.go pins the
// intended matrix so a drift is at least caught as a failing test, not a
// silent authorization change.

// CategoryAccessPolicy describes who — beyond the uploader and an
// owner-equivalent role (always allowed unconditionally, see
// Service.Authorize) — may view/manage assets in a given category.
type CategoryAccessPolicy struct {
	// AdditionalRoles may access any asset in this category, beyond the
	// uploader and owner/it_specialist.
	AdditionalRoles []string
	// SubjectSelfAccess, when true, additionally allows the user identified
	// by owner_entity_id (only when owner_entity_type == "users") to access
	// their own asset even when someone else (e.g. an owner acting on their
	// behalf) was the uploader.
	SubjectSelfAccess bool
}

// categoryAccessPolicies is the per-category policy table. A category with
// no entry (the zero value) grants access to only the uploader and an
// owner-equivalent role — this is CategoryUserDocument's actual, audited
// policy (see its entry below), not an oversight.
var categoryAccessPolicies = map[Category]CategoryAccessPolicy{
	// Mirrors internal/products/routes.go's writeRoles ("owner",
	// "warehouse_manager"). Product images are public anyway (see
	// Category.DefaultVisibility) — this only gates the authenticated
	// management endpoints (GET/DELETE/signed-url, the last of which
	// Handler.MintSignedURL rejects outright for public assets), never
	// viewing the file itself.
	CategoryProductImage: {AdditionalRoles: []string{"warehouse_manager"}},

	// Mirrors internal/users/handler.go: "POST /users/me/avatar" (any
	// authenticated user, their own) and "POST /users/:id/avatar"
	// (owner-only, on another user's behalf). SubjectSelfAccess covers a
	// user viewing/replacing their own avatar even when an owner uploaded
	// it for them — in that case UploadedByUserID is the owner's ID, not
	// the subject's, so the uploader check alone would wrongly exclude
	// the person the avatar actually belongs to.
	CategoryAvatar: {SubjectSelfAccess: true},

	// Mirrors internal/orders/routes.go's attachmentWriteRoles, which is
	// identical to orderRoles as of 2026-07-16: {"owner",
	// "sales_team_lead", "manager", "seller", "dispatcher"}. "courier" is
	// deliberately excluded — orders.go grants couriers comment
	// read/write but not attachment access.
	CategoryOrderAttachment: {AdditionalRoles: []string{"sales_team_lead", "manager", "seller", "dispatcher"}},

	// Mirrors internal/orders/routes.go's prepaymentRoles: {"owner",
	// "dispatcher", "seller", "manager", "sales_team_lead"}. Prepayment
	// *verification* (approve/reject) is further restricted to
	// {"owner","dispatcher"} by orders' own verifyRoles/service logic —
	// that's a business-action restriction on a different endpoint
	// entirely, not a media-visibility restriction, so it doesn't apply
	// here: any of prepaymentRoles may still view the proof image itself.
	CategoryPrepaymentProof: {AdditionalRoles: []string{"sales_team_lead", "manager", "seller", "dispatcher"}},

	// Mirrors internal/users/handler.go's document routes — ListDocuments/
	// CreateDocument/UpdateDocumentStatus/DeleteDocument are ALL gated
	// `middleware.RequireRoles(string(RoleOwner))` with no self-view path
	// at all, even for the document's own subject. This is the audited,
	// intentional existing policy for HR/passport-class documents, not an
	// omission — do not add AdditionalRoles or SubjectSelfAccess here
	// without an explicit product decision to change that upstream policy
	// first (and update both places together).
	CategoryUserDocument: {},

	// Mirrors internal/courier/routes.go's courierRoles ("courier",
	// "owner" — a courier's own handovers, via MyHandovers, which is
	// already covered by the uploader check since couriers submit their
	// own handover proofs) and internal/dispatch/routes.go's
	// dispatcherRoles ("dispatcher", "owner" — dispatcher sees/confirms
	// *all* couriers' handovers via ListAllHandovers). "courier" is
	// deliberately NOT in AdditionalRoles: no route lets one courier see
	// another courier's handovers, so only self-access (uploader check)
	// applies for that role.
	CategoryCashHandoverProof: {AdditionalRoles: []string{"dispatcher"}},
}
