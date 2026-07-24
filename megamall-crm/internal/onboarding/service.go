package onboarding

import (
	"context"
	"io"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// CreatedMediaAsset is what a CreateMediaFn reports about a freshly-stored
// file — deliberately a plain, local struct rather than importing
// internal/media's own types directly, mirroring users.MediaAssetInfo's
// doc comment (see internal/products/service.go for the original import-
// cycle reasoning this pattern follows throughout the codebase).
type CreatedMediaAsset struct {
	AssetID     uuid.UUID
	ContentType string
	SizeBytes   int64
	Width       *int
	Height      *int
}

// CreateMediaFn uploads a new file directly into the media pipeline
// (category user_document, private visibility), unattached — exactly like
// the normal authenticated upload-then-attach flow, except triggered
// server-side instead of via POST /media, since a public applicant has no
// JWT to call that endpoint with. The resulting asset is later attached to
// a real user by Service.Approve (via users.Service.CreateDocument), or
// released/quarantined by Service.Reject if the application is discarded.
type CreateMediaFn func(ctx context.Context, originalFilename string, declaredSize int64, r io.Reader) (*CreatedMediaAsset, error)

// ReleaseMediaFn quarantines a previously-created (and never attached, or
// no-longer-needed) media asset — mirrors users.ReleaseMediaFn.
type ReleaseMediaFn func(ctx context.Context, assetID uuid.UUID) error

// SignedMediaURLFn mints a fresh, short-lived signed URL for a private
// media asset — mirrors users.SignedMediaURLFn exactly, including the
// "never cached/persisted, resolved on every call" contract.
type SignedMediaURLFn func(ctx context.Context, assetID uuid.UUID, variant string) string

// PendingDocument is one file attached to a public /new submission, parsed
// off the incoming multipart request by handler.go before Service.Create
// ever sees it.
type PendingDocument struct {
	DocumentType     string
	OriginalFilename string
	DeclaredSize     int64
	Reader           io.Reader
}

// Service encapsulates worker-application business logic. It depends on
// users.Service directly (not a narrow injected function) because approval
// reuses real create-user business logic — uniqueness checks, defaults,
// history — not just an existence lookup. See CLAUDE.md's cross-module
// dependency convention.
type Service struct {
	repo    *Repository
	userSvc *users.Service

	// createMedia/releaseMedia/signedMediaURL are nil when
	// MEDIA_PIPELINE_ENABLED=false — see requireMedia. Submissions with no
	// attached documents work identically either way.
	createMedia    CreateMediaFn
	releaseMedia   ReleaseMediaFn
	signedMediaURL SignedMediaURLFn
}

func NewService(repo *Repository, userSvc *users.Service) *Service {
	return &Service{repo: repo, userSvc: userSvc}
}

// SetMediaAdapters injects the media-pipeline adapters after construction —
// mirrors users.Service.SetMediaAdapters exactly.
func (s *Service) SetMediaAdapters(createMedia CreateMediaFn, releaseMedia ReleaseMediaFn, signedMediaURL SignedMediaURLFn) {
	s.createMedia = createMedia
	s.releaseMedia = releaseMedia
	s.signedMediaURL = signedMediaURL
}

func (s *Service) requireMedia() error {
	if s.createMedia == nil {
		return apperrors.BadRequest("document upload is not available right now")
	}
	return nil
}

func (s *Service) releaseAndLog(ctx context.Context, assetID uuid.UUID) {
	if err := s.releaseMedia(ctx, assetID); err != nil {
		log.Printf("[onboarding] failed to release media asset %s during rollback: %v", assetID, err)
	}
}

// Create handles a public, unauthenticated submission from /new. The
// applicant's chosen password is hashed and stored now — never re-collected
// later — so approval can promote it into a real login as-is. docs is
// already validated/parsed multipart file data (see handler.go); any
// upload failure aborts the whole submission before the application row is
// ever created, releasing any documents already stored for this call.
func (s *Service) Create(ctx context.Context, req CreateApplicationRequest, docs []PendingDocument) (*WorkerApplication, error) {
	if len(docs) > 0 {
		if err := s.requireMedia(); err != nil {
			return nil, err
		}
	}

	exists, err := s.userSvc.PhoneExists(ctx, req.Phone)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, apperrors.Conflict("phone number is already registered")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	docRows, err := s.uploadDocuments(ctx, docs)
	if err != nil {
		return nil, err
	}

	a := &WorkerApplication{
		ID:              uuid.New(),
		Phone:           req.Phone,
		Email:           req.Email,
		PasswordHash:    string(hash),
		FullName:        req.FullName,
		Surname:         req.Surname,
		DesiredPosition: req.DesiredPosition,
		DateOfBirth:     req.DateOfBirth,
		Address:         req.Address,
		Status:          StatusPending,
	}

	if err := s.repo.Create(ctx, a); err != nil {
		s.releaseDocs(ctx, docRows)
		if strings.Contains(err.Error(), "pending application") {
			return nil, apperrors.Conflict("this phone number already has a pending application")
		}
		return nil, apperrors.Internal(err)
	}

	for i := range docRows {
		docRows[i].ApplicationID = a.ID
	}
	if err := s.repo.CreateDocuments(ctx, docRows); err != nil {
		s.releaseDocs(ctx, docRows)
		return nil, apperrors.Internal(err)
	}

	return a, nil
}

// uploadDocuments stores each pending file via createMedia, stopping and
// releasing everything already stored on the first failure — a submission
// either gets all its documents or none of them, never a partial set.
func (s *Service) uploadDocuments(ctx context.Context, docs []PendingDocument) ([]WorkerApplicationDocument, error) {
	if len(docs) == 0 {
		return nil, nil
	}

	rows := make([]WorkerApplicationDocument, 0, len(docs))
	for _, doc := range docs {
		asset, err := s.createMedia(ctx, doc.OriginalFilename, doc.DeclaredSize, doc.Reader)
		if err != nil {
			s.releaseDocs(ctx, rows)
			return nil, err
		}
		assetID := asset.AssetID
		rows = append(rows, WorkerApplicationDocument{
			ID:               uuid.New(),
			MediaAssetID:     &assetID,
			OriginalFilename: doc.OriginalFilename,
			ContentType:      &asset.ContentType,
			SizeBytes:        &asset.SizeBytes,
			DocumentType:     NormalizedDocumentType(doc.DocumentType),
			Width:            asset.Width,
			Height:           asset.Height,
		})
	}
	return rows, nil
}

func (s *Service) releaseDocs(ctx context.Context, docs []WorkerApplicationDocument) {
	if s.releaseMedia == nil {
		return
	}
	for _, d := range docs {
		if d.MediaAssetID != nil {
			s.releaseAndLog(ctx, *d.MediaAssetID)
		}
	}
}

func (s *Service) List(ctx context.Context, status Status) ([]WorkerApplication, error) {
	list, err := s.repo.List(ctx, status)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return list, nil
}

func (s *Service) GetByID(ctx context.Context, id uuid.UUID) (*WorkerApplication, error) {
	a, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if a == nil {
		return nil, apperrors.NotFound("worker application")
	}
	return a, nil
}

// GetDetail is GetByID's owner-review counterpart — additionally resolves
// the application's attached documents with freshly-minted signed URLs.
// Only the HR detail endpoint uses this; List and the internal Approve/
// Reject lookups use plain GetByID, which never needs to mint URLs.
func (s *Service) GetDetail(ctx context.Context, id uuid.UUID) (*WorkerApplication, []DocumentResponse, error) {
	a, err := s.GetByID(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	docs, err := s.repo.ListDocuments(ctx, id)
	if err != nil {
		return nil, nil, apperrors.Internal(err)
	}
	out := make([]DocumentResponse, len(docs))
	for i := range docs {
		out[i] = toDocumentResponse(&docs[i])
		if docs[i].MediaAssetID != nil && s.signedMediaURL != nil {
			out[i].URL = s.signedMediaURL(ctx, *docs[i].MediaAssetID, "")
		}
	}
	return a, out, nil
}

// Approve promotes a pending application into a real users row, reusing the
// password hash the applicant already set at submission time (see Create),
// and the role the reviewing owner chose — never a role the applicant
// self-selected. Attached documents are handed over to the new user via
// users.Service.CreateDocument (the same attach + history path HR's normal
// document upload already uses) so they immediately show up on the
// employee's profile — a per-document attach failure is logged but never
// fails the approval itself, since the account and its access already exist
// by that point.
func (s *Service) Approve(ctx context.Context, id uuid.UUID, reviewerID uuid.UUID, role users.Role) (*users.User, error) {
	if role == users.RoleOwner {
		return nil, apperrors.BadRequest("cannot assign the owner role through worker onboarding")
	}

	a, err := s.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.Status != StatusPending {
		return nil, apperrors.Conflict("application is not pending")
	}

	docs, err := s.repo.ListDocuments(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}

	u, err := s.userSvc.CreateWithPasswordHash(ctx, users.CreateUserWithHashRequest{
		Phone:        a.Phone,
		Email:        a.Email,
		PasswordHash: a.PasswordHash,
		FullName:     a.FullName,
		Surname:      a.Surname,
		Position:     a.DesiredPosition,
		Role:         role,
		HireDate:     timePtr(time.Now().UTC()),
		DateOfBirth:  a.DateOfBirth,
		Address:      a.Address,
	})
	if err != nil {
		return nil, err
	}

	if err := s.repo.MarkApproved(ctx, id, reviewerID, u.ID); err != nil {
		return nil, apperrors.Internal(err)
	}

	for _, d := range docs {
		if d.MediaAssetID == nil {
			continue
		}
		documentType := d.DocumentType
		if _, err := s.userSvc.CreateDocument(ctx, u.ID, reviewerID, users.CreateUserDocumentRequest{
			MediaAssetID: d.MediaAssetID,
			DocumentType: &documentType,
		}); err != nil {
			log.Printf("[onboarding] failed to attach application document %s to new user %s: %v", d.ID, u.ID, err)
		}
	}

	return u, nil
}

// Reject discards a pending application outright — there is no "rejected"
// terminal state to keep around, the row is simply deleted so the applicant
// (and their phone number) can freely re-apply later. Any attached
// documents are released (quarantined) rather than left as orphaned private
// files with nothing referencing them.
func (s *Service) Reject(ctx context.Context, id uuid.UUID) error {
	a, err := s.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if a.Status != StatusPending {
		return apperrors.Conflict("application is not pending")
	}

	docs, err := s.repo.ListDocuments(ctx, id)
	if err != nil {
		return apperrors.Internal(err)
	}

	if err := s.repo.Delete(ctx, id); err != nil {
		return apperrors.Internal(err)
	}

	if s.releaseMedia != nil {
		for _, d := range docs {
			if d.MediaAssetID != nil {
				s.releaseAndLog(ctx, *d.MediaAssetID)
			}
		}
	}
	return nil
}

func timePtr(t time.Time) *time.Time { return &t }
