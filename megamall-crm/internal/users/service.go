package users

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12
const documentStatusUploaded = "uploaded"
const documentStatusVerified = "verified"
const documentStatusRejected = "rejected"

// SessionRevokerFn revokes all active sessions (refresh tokens) for a user.
// Injected after construction (avoids a circular import on internal/auth) and
// called whenever a user is deactivated or deleted, so their existing tokens
// stop working immediately instead of remaining valid until they expire.
type SessionRevokerFn func(ctx context.Context, userID uuid.UUID) error

// MediaAssetInfo is what an external media-pipeline integration reports
// about a freshly-attached media asset (avatar or user document).
// Deliberately a plain, local struct rather than importing internal/media's
// own types directly — see internal/products/service.go's MediaAssetInfo
// doc comment for the import-cycle reasoning this mirrors exactly.
//
// OriginalFilename/ContentType/SizeBytes are only populated (and only
// meaningful) for AttachUserDocumentFn — a document's own recorded
// metadata should come from what internal/media actually detected/stored,
// not from client-supplied request fields, so CreateDocument sources them
// from here rather than trusting req.ContentType/req.SizeBytes when a
// media asset is attached. AttachAvatarFn leaves them zero-valued.
type MediaAssetInfo struct {
	OriginalFilename string
	ContentType      string
	SizeBytes        int64
	Width            *int
	Height           *int
}

// AttachAvatarFn claims a previously-uploaded, unattached media asset
// (category avatar) as userID's avatar. actorID must be the asset's own
// uploader (see media.Service.AttachToOwner) — the caller making the
// current request (self, or an owner acting on userID's behalf), not
// necessarily userID itself. Returns (wrapped, check with errors.Is)
// ErrMediaAssetNotFound / ErrMediaCategoryMismatch / ErrMediaAlreadyAttached
// for the caller to map via mediaAttachError.
type AttachAvatarFn func(ctx context.Context, assetID, userID, actorID uuid.UUID) (*MediaAssetInfo, error)

// AttachUserDocumentFn claims a previously-uploaded, unattached media asset
// (category user_document) as userID's document. Same sentinel-error
// contract and actorID semantics as AttachAvatarFn.
type AttachUserDocumentFn func(ctx context.Context, assetID, userID, actorID uuid.UUID) (*MediaAssetInfo, error)

// ReleaseMediaFn quarantines a previously-attached (or attach-then-
// abandoned) media asset — the compensating action for a failed
// create/replace, wired to internal/media.Service.ReleaseByID in main.go.
type ReleaseMediaFn func(ctx context.Context, assetID uuid.UUID) error

// SignedMediaURLFn mints a fresh, short-lived signed URL for a private
// media asset's given variant ("preview" for images, "" for the original —
// e.g. a PDF document, which is never rasterized). Never cached or
// persisted — resolved on every call, since signed URLs expire after
// MediaConfig.SignedURLTTL. Returns "" if the asset can no longer be
// resolved (e.g. quarantined): callers fall back to the legacy URL column
// in that case rather than failing the whole request — see
// resolveAvatarURL/resolveDocumentURL.
type SignedMediaURLFn func(ctx context.Context, assetID uuid.UUID, variant string) string

// Sentinel errors an AttachAvatarFn/AttachUserDocumentFn implementation
// should wrap so mediaAttachError can map them to the right client-facing
// response.
var (
	ErrMediaAssetNotFound    = errors.New("media asset not found")
	ErrMediaCategoryMismatch = errors.New("media asset category mismatch")
	ErrMediaAlreadyAttached  = errors.New("media asset is already attached")
)

// Service encapsulates all user business logic.
type Service struct {
	repo           *Repository
	sessionRevoker SessionRevokerFn

	// attachAvatar/attachUserDocument/releaseMedia/signedMediaURL are nil
	// when MEDIA_PIPELINE_ENABLED=false — see requireMedia. Every method
	// that would use them checks requireMedia first, so a disabled deploy
	// behaves identically to a build that never had media integration
	// wired in at all for any request that doesn't reference
	// avatar_media_asset_id / a document's media_asset_id.
	attachAvatar       AttachAvatarFn
	attachUserDocument AttachUserDocumentFn
	releaseMedia       ReleaseMediaFn
	signedMediaURL     SignedMediaURLFn
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// SetMediaAdapters injects the media-pipeline adapters after construction —
// called from main.go once *media.Service exists (inside the "if
// cfg.Media.Enabled" block), mirroring SetSessionRevoker's post-construction
// wiring. This avoids reordering userSvc's construction in main.go, which
// several earlier closures (teamForUserFn, authSvc.SetRoleResolver, etc.)
// already capture ahead of where the media pipeline is set up. All four
// adapters stay nil when the pipeline is disabled — see requireMedia.
func (s *Service) SetMediaAdapters(attachAvatar AttachAvatarFn, attachUserDocument AttachUserDocumentFn, releaseMedia ReleaseMediaFn, signedMediaURL SignedMediaURLFn) {
	s.attachAvatar = attachAvatar
	s.attachUserDocument = attachUserDocument
	s.releaseMedia = releaseMedia
	s.signedMediaURL = signedMediaURL
}

// requireMedia returns a clear, user-facing error when the caller supplied
// a media-pipeline-backed field but the pipeline is disabled.
func (s *Service) requireMedia() error {
	if s.attachAvatar == nil {
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
		log.Printf("[users] failed to release media asset %s during rollback: %v", assetID, err)
	}
}

// resolveAvatarURL mints a fresh signed URL for u's avatar when it's
// pipeline-backed, overwriting the in-memory copy's AvatarURL before it's
// serialized to a response — never persisted back to the DB. Falls back to
// the stored legacy AvatarURL if the pipeline is disabled or the asset can
// no longer be resolved (e.g. quarantined), so a caller always gets
// whatever's best-available rather than an error.
func (s *Service) resolveAvatarURL(ctx context.Context, u *User) {
	if u.AvatarMediaAssetID == nil || s.signedMediaURL == nil {
		return
	}
	if url := s.signedMediaURL(ctx, *u.AvatarMediaAssetID, "preview"); url != "" {
		u.AvatarURL = &url
	}
}

// resolveDocumentURL is resolveAvatarURL's counterpart for UserDocument —
// variant "" resolves to the original file (documents like PDFs are never
// rasterized into a "preview" variant, see ProcessPrivateProofPreview's
// image-only gate).
func (s *Service) resolveDocumentURL(ctx context.Context, d *UserDocument) {
	if d.MediaAssetID == nil || s.signedMediaURL == nil {
		return
	}
	variant := "preview"
	if d.ContentType != nil && !strings.HasPrefix(*d.ContentType, "image/") {
		variant = ""
	}
	if url := s.signedMediaURL(ctx, *d.MediaAssetID, variant); url != "" {
		d.FileURL = url
	}
}

// SetSessionRevoker injects the session-revocation hook. Called from main.go
// after all services are constructed.
func (s *Service) SetSessionRevoker(fn SessionRevokerFn) {
	s.sessionRevoker = fn
}

func (s *Service) Create(ctx context.Context, req CreateUserRequest) (*User, error) {
	if !req.Role.IsValid() {
		return nil, apperrors.BadRequest(fmt.Sprintf("invalid role: %s", req.Role))
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("hash password: %w", err))
	}

	u := &User{
		ID:           uuid.New(),
		Phone:        req.Phone,
		Email:        req.Email,
		PasswordHash: string(hash),
		FullName:     req.FullName,
		Surname:      req.Surname,
		Position:     req.Position,
		Role:         req.Role,
		IsActive:     true,
		Status:       StatusOnline,
		HireDate:     req.HireDate,
		DateOfBirth:  req.DateOfBirth,
		Address:      req.Address,
	}

	if err := s.repo.Create(ctx, u); err != nil {
		if strings.Contains(err.Error(), "phone already registered") {
			return nil, apperrors.Conflict("phone number is already registered")
		}
		if strings.Contains(err.Error(), "email already registered") {
			return nil, apperrors.Conflict("email address is already registered")
		}
		return nil, apperrors.Internal(err)
	}

	return u, nil
}

func (s *Service) GetByID(ctx context.Context, id uuid.UUID) (*User, error) {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}
	s.resolveAvatarURL(ctx, u)
	return u, nil
}

func (s *Service) CanViewUser(ctx context.Context, actorID uuid.UUID, actorRole string, targetID uuid.UUID) (bool, error) {
	if actorID == targetID || actorRole == string(RoleOwner) {
		return true, nil
	}

	if actorRole != string(RoleManager) && actorRole != string(RoleSalesTeamLead) {
		return false, nil
	}

	ok, err := s.repo.ShareTeam(ctx, actorID, targetID)
	if err != nil {
		return false, apperrors.Internal(err)
	}
	return ok, nil
}

// List returns users matching filter. Non-owner callers (manager, sales_team_lead)
// are scoped to their own hierarchy team — they can never list users outside it.
func (s *Service) List(ctx context.Context, actorID uuid.UUID, actorRole string, filter ListUsersFilter, p pagination.Params) ([]User, int, error) {
	if actorRole != string(RoleOwner) {
		teamID, err := s.repo.GetTeamIDForUser(ctx, actorID)
		if err != nil {
			return nil, 0, apperrors.Internal(err)
		}
		if teamID == nil {
			return []User{}, 0, nil
		}
		filter.TeamID = teamID
	}

	list, total, err := s.repo.List(ctx, filter, p)
	if err != nil {
		return nil, 0, apperrors.Internal(err)
	}
	for i := range list {
		s.resolveAvatarURL(ctx, &list[i])
	}
	return list, total, nil
}

func (s *Service) Update(ctx context.Context, id uuid.UUID, req UpdateUserRequest, actorIDs ...uuid.UUID) (*User, error) {
	if req.AvatarURL != nil && req.AvatarMediaAssetID != nil {
		return nil, apperrors.BadRequest("exactly one of avatar_url or avatar_media_asset_id may be set")
	}
	if req.AvatarMediaAssetID != nil {
		if err := s.requireMedia(); err != nil {
			return nil, err
		}
	}

	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}

	before := *u
	if req.Phone != nil {
		u.Phone = *req.Phone
	}
	if req.FullName != nil {
		u.FullName = *req.FullName
	}
	if req.Surname != nil {
		u.Surname = req.Surname
	}
	if req.Position != nil {
		u.Position = req.Position
	}
	if req.Role != nil {
		if !req.Role.IsValid() {
			return nil, apperrors.BadRequest(fmt.Sprintf("invalid role: %s", *req.Role))
		}
		u.Role = *req.Role
	}
	if req.IsActive != nil {
		u.IsActive = *req.IsActive
	}
	if req.AvatarURL != nil {
		u.AvatarURL = req.AvatarURL
		u.AvatarMediaAssetID = nil
		u.AvatarWidth = nil
		u.AvatarHeight = nil
	}
	var newAvatarAssetID *uuid.UUID
	if req.AvatarMediaAssetID != nil {
		actorID := id
		if len(actorIDs) > 0 {
			actorID = actorIDs[0]
		}
		info, attachErr := s.attachAvatar(ctx, *req.AvatarMediaAssetID, u.ID, actorID)
		if attachErr != nil {
			return nil, mediaAttachError(attachErr)
		}
		newAvatarAssetID = req.AvatarMediaAssetID
		u.AvatarMediaAssetID = req.AvatarMediaAssetID
		u.AvatarWidth = info.Width
		u.AvatarHeight = info.Height
	}
	if req.Status != nil {
		if !req.Status.IsValid() {
			return nil, apperrors.BadRequest(fmt.Sprintf("invalid status: %s", *req.Status))
		}
		u.Status = *req.Status
	}
	if req.HireDate != nil {
		u.HireDate = req.HireDate
	}
	if req.DateOfBirth != nil {
		u.DateOfBirth = req.DateOfBirth
	}
	if req.Address != nil {
		u.Address = req.Address
	}
	if req.NewPassword != nil && *req.NewPassword != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.NewPassword), bcryptCost)
		if err != nil {
			return nil, apperrors.Internal(fmt.Errorf("hash password: %w", err))
		}
		u.PasswordHash = string(hash)
	}
	u.UpdatedAt = time.Now().UTC()

	if err := s.repo.Update(ctx, u); err != nil {
		if newAvatarAssetID != nil {
			s.releaseAndLog(ctx, *newAvatarAssetID)
		}
		if strings.Contains(err.Error(), "phone already registered") {
			return nil, apperrors.Conflict("phone number is already registered")
		}
		if strings.Contains(err.Error(), "email already registered") {
			return nil, apperrors.Conflict("email address is already registered")
		}
		return nil, apperrors.Internal(err)
	}

	// Replace discipline: the new avatar asset is attached and persisted
	// FIRST (above); only once that succeeds do we release the previous
	// one, so the user never has a moment with no valid avatar reference
	// if the operation fails partway through.
	if newAvatarAssetID != nil && before.AvatarMediaAssetID != nil {
		s.releaseAndLog(ctx, *before.AvatarMediaAssetID)
	}

	if err := s.recordProfileHistory(ctx, &before, u, req, actorIDs...); err != nil {
		return nil, err
	}

	// Deactivation must revoke existing sessions immediately — otherwise a
	// deactivated user's already-issued tokens keep working. It must also
	// clear this user as anyone else's hierarchy parent, so they stop
	// appearing as a manager in someone's upward chain while deactivated.
	if before.IsActive && !u.IsActive {
		if s.sessionRevoker != nil {
			if err := s.sessionRevoker(ctx, u.ID); err != nil {
				return nil, apperrors.Internal(fmt.Errorf("revoke sessions: %w", err))
			}
		}
		if err := s.repo.ClearAsHierarchyParent(ctx, u.ID); err != nil {
			return nil, apperrors.Internal(err)
		}
	}

	s.resolveAvatarURL(ctx, u)
	return u, nil
}

func (s *Service) recordProfileHistory(ctx context.Context, before *User, after *User, req UpdateUserRequest, actorIDs ...uuid.UUID) error {
	var changedBy *uuid.UUID
	if len(actorIDs) > 0 {
		changedBy = &actorIDs[0]
	}
	changes := make([]UserHistory, 0, 8)
	add := func(field string, oldValue *string, newValue *string) {
		if stringPtrValue(oldValue) == stringPtrValue(newValue) {
			return
		}
		changes = append(changes, UserHistory{
			ID:        uuid.New(),
			UserID:    after.ID,
			FieldName: field,
			OldValue:  oldValue,
			NewValue:  newValue,
			ChangedBy: changedBy,
		})
	}

	if req.FullName != nil {
		add("full_name", stringPtr(before.FullName), stringPtr(after.FullName))
	}
	if req.Phone != nil {
		add("phone", stringPtr(before.Phone), stringPtr(after.Phone))
	}
	if req.Role != nil {
		add("role", stringPtr(string(before.Role)), stringPtr(string(after.Role)))
	}
	if req.IsActive != nil {
		add("is_active", stringPtr(fmt.Sprintf("%t", before.IsActive)), stringPtr(fmt.Sprintf("%t", after.IsActive)))
	}
	if req.AvatarURL != nil {
		add("avatar_url", before.AvatarURL, after.AvatarURL)
	}
	if req.AvatarMediaAssetID != nil {
		add("avatar_media_asset_id", uuidPtrValue(before.AvatarMediaAssetID), uuidPtrValue(after.AvatarMediaAssetID))
	}
	if req.Status != nil {
		add("status", stringPtr(string(before.Status)), stringPtr(string(after.Status)))
	}
	if req.HireDate != nil {
		add("hire_date", datePtrValue(before.HireDate), datePtrValue(after.HireDate))
	}
	if req.DateOfBirth != nil {
		add("date_of_birth", datePtrValue(before.DateOfBirth), datePtrValue(after.DateOfBirth))
	}
	if req.Address != nil {
		add("address", before.Address, after.Address)
	}
	// Password resets are never diffed by value — only that a reset happened
	// and who did it. before/after here are both password hashes, which must
	// never appear in the audit trail even hashed.
	if req.NewPassword != nil && *req.NewPassword != "" {
		changes = append(changes, UserHistory{
			ID:        uuid.New(),
			UserID:    after.ID,
			FieldName: "password_reset",
			ChangedBy: changedBy,
		})
	}

	for i := range changes {
		if err := s.repo.CreateHistory(ctx, &changes[i]); err != nil {
			return apperrors.Internal(err)
		}
	}
	return nil
}

func stringPtr(value string) *string {
	v := value
	return &v
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func datePtrValue(value *time.Time) *string {
	if value == nil {
		return nil
	}
	return stringPtr(value.Format("2006-01-02"))
}

func uuidPtrValue(value *uuid.UUID) *string {
	if value == nil {
		return nil
	}
	return stringPtr(value.String())
}

func normalizedDocumentType(value *string) string {
	if value == nil {
		return "other"
	}
	switch strings.TrimSpace(*value) {
	case "passport", "contract", "certificate", "diploma", "medical", "other":
		return strings.TrimSpace(*value)
	default:
		return "other"
	}
}

// PatchMe updates only the fields a user is allowed to edit for themselves.
func (s *Service) PatchMe(ctx context.Context, id uuid.UUID, req PatchMeRequest) (*User, error) {
	if req.AvatarMediaAssetID != nil {
		if err := s.requireMedia(); err != nil {
			return nil, err
		}
	}

	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}
	if req.FullName != nil {
		fullName := strings.TrimSpace(*req.FullName)
		if fullName == "" {
			return nil, apperrors.BadRequest("full_name is required")
		}
		u.FullName = fullName
	}
	if req.DateOfBirth != nil {
		u.DateOfBirth = req.DateOfBirth
	}

	previousAvatarAssetID := u.AvatarMediaAssetID
	var newAvatarAssetID *uuid.UUID
	if req.AvatarMediaAssetID != nil {
		info, attachErr := s.attachAvatar(ctx, *req.AvatarMediaAssetID, u.ID, id)
		if attachErr != nil {
			return nil, mediaAttachError(attachErr)
		}
		newAvatarAssetID = req.AvatarMediaAssetID
		u.AvatarMediaAssetID = req.AvatarMediaAssetID
		u.AvatarWidth = info.Width
		u.AvatarHeight = info.Height
	}

	u.UpdatedAt = time.Now().UTC()
	if err := s.repo.Update(ctx, u); err != nil {
		if newAvatarAssetID != nil {
			s.releaseAndLog(ctx, *newAvatarAssetID)
		}
		return nil, apperrors.Internal(err)
	}

	// See Update's identical replace discipline: attach+persist the new
	// asset before releasing the old one.
	if newAvatarAssetID != nil && previousAvatarAssetID != nil {
		s.releaseAndLog(ctx, *previousAvatarAssetID)
	}

	s.resolveAvatarURL(ctx, u)
	return u, nil
}

func (s *Service) ChangePassword(ctx context.Context, id uuid.UUID, req ChangePasswordRequest) error {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return apperrors.Internal(err)
	}
	if u == nil {
		return apperrors.NotFound("user")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		return &apperrors.AppError{
			Code:       apperrors.CodeInvalidPassword,
			StatusCode: 400,
			Message:    "current password is incorrect",
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcryptCost)
	if err != nil {
		return apperrors.Internal(fmt.Errorf("hash password: %w", err))
	}

	if err := s.repo.UpdatePassword(ctx, id, string(hash)); err != nil {
		return apperrors.Internal(err)
	}

	return nil
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		if err.Error() == "user not found" {
			return apperrors.NotFound("user")
		}
		return apperrors.Internal(err)
	}
	if s.sessionRevoker != nil {
		if err := s.sessionRevoker(ctx, id); err != nil {
			return apperrors.Internal(fmt.Errorf("revoke sessions: %w", err))
		}
	}
	if err := s.repo.ClearAsHierarchyParent(ctx, id); err != nil {
		return apperrors.Internal(err)
	}
	return nil
}

func (s *Service) ListDocuments(ctx context.Context, userID uuid.UUID) ([]UserDocument, error) {
	u, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}
	if u.Role == RoleOwner {
		return []UserDocument{}, nil
	}
	docs, err := s.repo.ListDocuments(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	for i := range docs {
		s.resolveDocumentURL(ctx, &docs[i])
	}
	return docs, nil
}

// CreateDocument accepts either a legacy FileURL or a media-pipeline
// MediaAssetID (exactly one). When MediaAssetID is used, OriginalFilename/
// ContentType/SizeBytes are sourced from the media asset's own recorded
// metadata rather than trusted from the request — see MediaAssetInfo's doc
// comment.
func (s *Service) CreateDocument(ctx context.Context, userID uuid.UUID, uploadedBy uuid.UUID, req CreateUserDocumentRequest) (*UserDocument, error) {
	hasURL := strings.TrimSpace(req.FileURL) != ""
	hasAsset := req.MediaAssetID != nil
	if hasURL == hasAsset {
		return nil, apperrors.BadRequest("exactly one of file_url or media_asset_id is required")
	}
	if hasAsset {
		if err := s.requireMedia(); err != nil {
			return nil, err
		}
	}

	u, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}
	if u.Role == RoleOwner {
		return nil, apperrors.BadRequest("owner documents are not supported")
	}

	doc := &UserDocument{
		ID:                 uuid.New(),
		UserID:             userID,
		DocumentType:       normalizedDocumentType(req.DocumentType),
		ExpiresAt:          req.ExpiresAt,
		VerificationStatus: documentStatusUploaded,
		UploadedBy:         &uploadedBy,
	}

	if hasURL {
		filename := strings.TrimSpace(req.OriginalFilename)
		if filename == "" {
			return nil, apperrors.BadRequest("original_filename is required")
		}
		doc.FileURL = strings.TrimSpace(req.FileURL)
		doc.OriginalFilename = filename
		doc.ContentType = req.ContentType
		doc.SizeBytes = req.SizeBytes
	} else {
		info, attachErr := s.attachUserDocument(ctx, *req.MediaAssetID, userID, uploadedBy)
		if attachErr != nil {
			return nil, mediaAttachError(attachErr)
		}
		doc.MediaAssetID = req.MediaAssetID
		doc.OriginalFilename = info.OriginalFilename
		doc.ContentType = &info.ContentType
		doc.SizeBytes = &info.SizeBytes
		doc.Width = info.Width
		doc.Height = info.Height
	}

	if err := s.repo.CreateDocument(ctx, doc); err != nil {
		if hasAsset {
			s.releaseAndLog(ctx, *req.MediaAssetID)
		}
		return nil, apperrors.Internal(err)
	}
	if err := s.createHistory(ctx, userID, "document_uploaded", nil, stringPtr(doc.OriginalFilename), &uploadedBy); err != nil {
		return nil, err
	}
	s.resolveDocumentURL(ctx, doc)
	return doc, nil
}

func (s *Service) UpdateDocumentStatus(ctx context.Context, userID uuid.UUID, documentID uuid.UUID, actorID uuid.UUID, req UpdateUserDocumentStatusRequest) (*UserDocument, error) {
	nextStatus := strings.TrimSpace(req.VerificationStatus)
	if nextStatus != documentStatusUploaded && nextStatus != documentStatusVerified && nextStatus != documentStatusRejected {
		return nil, apperrors.BadRequest("invalid document status")
	}
	current, err := s.repo.GetDocument(ctx, userID, documentID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if current == nil {
		return nil, apperrors.NotFound("user document")
	}
	if current.VerificationStatus == nextStatus {
		return current, nil
	}
	updated, err := s.repo.UpdateDocumentStatus(ctx, userID, documentID, nextStatus)
	if err != nil {
		if err.Error() == "user document not found" {
			return nil, apperrors.NotFound("user document")
		}
		return nil, apperrors.Internal(err)
	}
	field := "document_status"
	if nextStatus == documentStatusVerified {
		field = "document_verified"
	}
	if nextStatus == documentStatusRejected {
		field = "document_rejected"
	}
	if err := s.createHistory(ctx, userID, field, stringPtr(current.VerificationStatus), stringPtr(updated.OriginalFilename), &actorID); err != nil {
		return nil, err
	}
	return updated, nil
}

func (s *Service) DeleteDocument(ctx context.Context, userID uuid.UUID, documentID uuid.UUID, actorIDs ...uuid.UUID) error {
	doc, err := s.repo.GetDocument(ctx, userID, documentID)
	if err != nil {
		return apperrors.Internal(err)
	}
	if err := s.repo.DeleteDocument(ctx, userID, documentID); err != nil {
		if err.Error() == "user document not found" {
			return apperrors.NotFound("user document")
		}
		return apperrors.Internal(err)
	}
	if doc != nil {
		// Best-effort: quarantine the underlying media asset too, so a
		// deleted document doesn't leave an orphaned private file behind.
		// Never fails the delete itself — see releaseAndLog's doc comment.
		if doc.MediaAssetID != nil && s.releaseMedia != nil {
			s.releaseAndLog(ctx, *doc.MediaAssetID)
		}
		var changedBy *uuid.UUID
		if len(actorIDs) > 0 {
			changedBy = &actorIDs[0]
		}
		if err := s.createHistory(ctx, userID, "document_deleted", stringPtr(doc.OriginalFilename), nil, changedBy); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) ListHistory(ctx context.Context, userID uuid.UUID) ([]UserHistory, error) {
	u, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}
	history, err := s.repo.ListHistory(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return history, nil
}

func (s *Service) ListAllHistory(ctx context.Context) ([]UserHistory, error) {
	history, err := s.repo.ListAllHistory(ctx)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return history, nil
}

func (s *Service) createHistory(ctx context.Context, userID uuid.UUID, field string, oldValue *string, newValue *string, changedBy *uuid.UUID) error {
	if err := s.repo.CreateHistory(ctx, &UserHistory{
		ID:        uuid.New(),
		UserID:    userID,
		FieldName: field,
		OldValue:  oldValue,
		NewValue:  newValue,
		ChangedBy: changedBy,
	}); err != nil {
		return apperrors.Internal(err)
	}
	return nil
}
