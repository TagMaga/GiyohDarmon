package dispatcher_settlements

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
)

// MediaAssetInfo is what an external media-pipeline integration reports
// about a settlement proof asset — deliberately a plain, local struct
// rather than importing internal/media's own types directly, mirroring
// internal/courier.MediaAssetInfo's import-cycle reasoning.
type MediaAssetInfo struct {
	ID     uuid.UUID
	Width  *int
	Height *int
}

// AttachSettlementProofFn claims a previously-uploaded, unattached media
// asset (category cash_handover_proof — reused, same kind of content) as
// settlementID's proof image. Returns (wrapped, check with errors.Is)
// ErrMediaAssetNotFound / ErrMediaCategoryMismatch / ErrMediaAlreadyAttached.
// actorID must be the asset's own uploader (the dispatcher submitting).
type AttachSettlementProofFn func(ctx context.Context, assetID, settlementID, actorID uuid.UUID) (*MediaAssetInfo, error)

// ListSettlementProofsFn returns every media asset currently attached to
// settlementID — there is no proof column on dispatcher_settlements; the
// asset rows' own owner_entity_type/owner_entity_id is the link, mirroring
// cash_handovers' equivalent.
type ListSettlementProofsFn func(ctx context.Context, settlementID uuid.UUID) ([]MediaAssetInfo, error)

// ReleaseMediaFn quarantines a previously-attached (or attach-then-
// abandoned) media asset — the compensating action for a failed Submit.
type ReleaseMediaFn func(ctx context.Context, assetID uuid.UUID) error

// SignedMediaURLFn mints a fresh, short-lived signed URL for a private
// media asset's given variant. Never cached or persisted.
type SignedMediaURLFn func(ctx context.Context, assetID uuid.UUID, variant string) string

var (
	ErrMediaAssetNotFound    = errors.New("media asset not found")
	ErrMediaCategoryMismatch = errors.New("media asset category mismatch")
	ErrMediaAlreadyAttached  = errors.New("media asset is already attached")
)

type Service struct {
	repo *Repository

	// attachProof/listProofs/releaseMedia/signedMediaURL are nil when
	// MEDIA_PIPELINE_ENABLED=false. Set via SetMediaAdapters after
	// construction — mirrors internal/courier.Service.SetMediaAdapters.
	attachProof    AttachSettlementProofFn
	listProofs     ListSettlementProofsFn
	releaseMedia   ReleaseMediaFn
	signedMediaURL SignedMediaURLFn
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// SetMediaAdapters injects the media-pipeline adapters after construction —
// called from main.go once *media.Service exists.
func (s *Service) SetMediaAdapters(attach AttachSettlementProofFn, list ListSettlementProofsFn, release ReleaseMediaFn, signedURL SignedMediaURLFn) {
	s.attachProof = attach
	s.listProofs = list
	s.releaseMedia = release
	s.signedMediaURL = signedURL
}

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

func (s *Service) releaseAndLog(ctx context.Context, assetID uuid.UUID) {
	if s.releaseMedia == nil {
		return
	}
	if err := s.releaseMedia(ctx, assetID); err != nil {
		log.Printf("[dispatcher_settlements] failed to release media asset %s during rollback: %v", assetID, err)
	}
}

// resolveMediaAssets lists settlementID's attached proof assets and mints a
// fresh signed URL for each — never persisted, resolved on every read.
// Returns nil when the pipeline is disabled or the settlement has no proof.
func (s *Service) resolveMediaAssets(ctx context.Context, settlementID uuid.UUID) []MediaAssetView {
	if s.listProofs == nil {
		return nil
	}
	infos, err := s.listProofs(ctx, settlementID)
	if err != nil {
		log.Printf("[dispatcher_settlements] failed to list proofs for %s: %v", settlementID, err)
		return nil
	}
	assets := make([]MediaAssetView, 0, len(infos))
	for _, info := range infos {
		if s.signedMediaURL == nil {
			continue
		}
		url := s.signedMediaURL(ctx, info.ID, "preview")
		if url == "" {
			continue
		}
		thumbURL := s.signedMediaURL(ctx, info.ID, "thumb")
		assets = append(assets, MediaAssetView{ID: info.ID, URL: url, ThumbURL: thumbURL, Width: info.Width, Height: info.Height})
	}
	return assets
}

// GetSummaryForOwner returns the four KPI figures, optionally scoped to one
// dispatcher and/or a date range.
func (s *Service) GetSummaryForOwner(ctx context.Context, f SummaryFilter) (Summary, error) {
	return s.repo.GetSummary(ctx, f)
}

// GetSummaryForDispatcher is the same aggregation, hard-scoped to the caller
// so a dispatcher can never see another dispatcher's figures.
func (s *Service) GetSummaryForDispatcher(ctx context.Context, dispatcherID uuid.UUID, from, to *time.Time) (Summary, error) {
	return s.repo.GetSummary(ctx, SummaryFilter{DispatcherID: &dispatcherID, From: from, To: to})
}

// ListForOwner returns settlement history across all (or one) dispatcher,
// with proof media resolved per row.
func (s *Service) ListForOwner(ctx context.Context, f ListFilter, p pagination.Params) ([]Row, int, error) {
	rows, total, err := s.repo.List(ctx, f, p)
	if err != nil {
		return nil, 0, err
	}
	if err := s.attachOwnerName(ctx, rows); err != nil {
		return nil, 0, err
	}
	for i := range rows {
		rows[i].MediaAssets = s.resolveMediaAssets(ctx, rows[i].ID)
	}
	return rows, total, nil
}

// ListForDispatcher is the same listing, hard-scoped to the caller.
func (s *Service) ListForDispatcher(ctx context.Context, dispatcherID uuid.UUID, p pagination.Params) ([]Row, int, error) {
	rows, total, err := s.repo.List(ctx, ListFilter{DispatcherID: &dispatcherID}, p)
	if err != nil {
		return nil, 0, err
	}
	if err := s.attachOwnerName(ctx, rows); err != nil {
		return nil, 0, err
	}
	for i := range rows {
		rows[i].MediaAssets = s.resolveMediaAssets(ctx, rows[i].ID)
	}
	return rows, total, nil
}

// attachOwnerName fills in every row's OwnerName with a single lookup,
// rather than once per row.
func (s *Service) attachOwnerName(ctx context.Context, rows []Row) error {
	if len(rows) == 0 {
		return nil
	}
	name, err := s.repo.PrimaryOwnerName(ctx)
	if err != nil {
		return apperrors.Internal(err)
	}
	for i := range rows {
		rows[i].OwnerName = name
	}
	return nil
}

// Submit creates a pending settlement for the dispatcher's full current
// outstanding balance (received - already-confirmed-paid). The amount is
// always computed server-side from OutstandingBalance, never taken from the
// request, so a dispatcher can't submit an arbitrary figure. ProofAssetID,
// if given, is attached before the row is created (mirrors
// courier.Service.SubmitHandover's pre-attach pattern) so a failed create
// doesn't leave an orphaned, permanently-attached asset.
func (s *Service) Submit(ctx context.Context, dispatcherID uuid.UUID, req CreateRequest) (*Settlement, error) {
	balance, err := s.repo.OutstandingBalance(ctx, dispatcherID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if balance <= 0 {
		return nil, apperrors.BadRequest("нет непереданных средств для передачи компании")
	}

	settlementID := uuid.New()
	if req.ProofAssetID != nil {
		if s.attachProof == nil {
			return nil, apperrors.BadRequest("the media pipeline is not enabled")
		}
		if _, err := s.attachProof(ctx, *req.ProofAssetID, settlementID, dispatcherID); err != nil {
			return nil, mediaAttachError(err)
		}
	}

	settlement := &Settlement{
		ID:           settlementID,
		DispatcherID: dispatcherID,
		Amount:       balance,
		Status:       StatusPending,
		Comment:      req.Comment,
	}
	if err := s.repo.Create(ctx, settlement); err != nil {
		if req.ProofAssetID != nil {
			s.releaseAndLog(ctx, *req.ProofAssetID)
		}
		return nil, apperrors.Internal(err)
	}
	return settlement, nil
}

// Confirm approves a pending settlement with the owner's counted amount —
// owner-only, enforced by routing.
func (s *Service) Confirm(ctx context.Context, reviewerID, id uuid.UUID, actualReceived float64, adminNote *string) (*Settlement, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, apperrors.NotFound("settlement")
	}
	if existing.Status != StatusPending {
		return nil, apperrors.BadRequest("заявка уже рассмотрена")
	}
	updated, err := s.repo.Confirm(ctx, id, reviewerID, actualReceived, adminNote)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return updated, nil
}

// Reject declines a pending settlement with a required reason.
func (s *Service) Reject(ctx context.Context, reviewerID, id uuid.UUID, reason string) (*Settlement, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, apperrors.NotFound("settlement")
	}
	if existing.Status != StatusPending {
		return nil, apperrors.BadRequest("заявка уже рассмотрена")
	}
	updated, err := s.repo.Reject(ctx, id, reviewerID, reason)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return updated, nil
}

// Edit corrects an already-finalized (confirmed/rejected) settlement —
// mirrors logistics.Service.EditHandover's post-decision correction flow.
func (s *Service) Edit(ctx context.Context, editorID, id uuid.UUID, req EditRequest) (*Settlement, error) {
	updated, err := s.repo.Edit(ctx, id, editorID, req)
	if err != nil {
		return nil, err
	}
	return updated, nil
}

// ListEdits returns a settlement's full edit history, oldest first.
func (s *Service) ListEdits(ctx context.Context, id uuid.UUID) ([]EditRow, error) {
	if _, err := s.repo.FindByID(ctx, id); err != nil {
		return nil, apperrors.NotFound("settlement")
	}
	return s.repo.ListEdits(ctx, id)
}
