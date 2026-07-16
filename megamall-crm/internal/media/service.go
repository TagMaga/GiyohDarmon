package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/config"
	apperrors "github.com/megamall/crm/pkg/errors"
)

// visibility-scoped subdirectories under cfg.UploadDir. Splitting by
// visibility (rather than one flat directory) is what lets the public
// delivery route serve files with zero DB lookup and zero risk of ever
// serving a private file unsigned: the two namespaces are physically
// separate, so "is this key public" is answered by which directory it's
// found under, and delivery.go never has to trust a caller-supplied
// visibility flag.
const (
	dirPublic     = "public"
	dirPrivate    = "private"
	dirQuarantine = "quarantine"
)

// Service is the business-logic layer tying validation (validate.go),
// processing (processing.go), storage (storage.go), signing (signing.go)
// and persistence (repository.go) into the actual upload/delete/deliver
// entry points the HTTP handler calls.
type Service struct {
	repo *Repository
	cfg  config.MediaConfig
	sem  chan struct{} // bounds concurrent image-processing jobs process-wide
}

func NewService(repo *Repository, cfg config.MediaConfig) *Service {
	n := cfg.ProcessingConcurrency
	if n < 1 {
		n = 1
	}
	return &Service{repo: repo, cfg: cfg, sem: make(chan struct{}, n)}
}

// ErrForbidden is returned by Authorize when the caller may not act on an
// asset. Handlers must map it to a generic response (404 for delivery, 403
// for the authenticated management endpoints) — see handler.go.
var ErrForbidden = errors.New("not authorized for this media asset")

// Create validates, persists, and processes a new upload in one call. r
// must yield exactly declaredSize bytes (see Validate). The category is
// mandatory and must be one of the fixed recognized values — an upload
// without an explicit recognized category is rejected outright, never
// defaulted.
func (s *Service) Create(ctx context.Context, params CreateParams, r io.Reader) (*Asset, *apperrors.AppError) {
	if !params.Category.Valid() {
		return nil, apperrors.BadRequest(ErrUnknownCategory.Error())
	}

	vf, verr := Validate(s.cfg, params.Category, r, params.DeclaredSize)
	if verr != nil {
		return nil, apperrors.BadRequest(verr.Message)
	}

	key, err := NewStorageKey(vf.Ext)
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("generate storage key: %w", err))
	}

	visibility := params.Category.DefaultVisibility()
	dir := s.visibilityDir(visibility)

	if err := WriteOriginal(dir, key, vf.Bytes); err != nil {
		return nil, apperrors.Internal(fmt.Errorf("persist original: %w", err))
	}

	asset := &Asset{
		ID:                 uuid.New(),
		StorageKey:         key,
		OriginalFilename:   params.OriginalFilename,
		DetectedMimeType:   vf.ContentType,
		OriginalSizeBytes:  int64(len(vf.Bytes)),
		ChecksumSHA256:     vf.ChecksumHex,
		Visibility:         visibility,
		Category:           params.Category,
		OwnerEntityID:      params.OwnerEntityID,
		UploadedByUserID:   params.UploadedByUserID,
		ProcessingStatus:   StatusPending,
		OriginalStorageKey: key,
	}
	if params.OwnerEntityType != "" {
		asset.OwnerEntityType = &params.OwnerEntityType
	}
	if vf.IsImage {
		w, h := vf.Width, vf.Height
		asset.Width, asset.Height = &w, &h
	}

	if err := s.repo.Create(ctx, asset); err != nil {
		return nil, apperrors.Internal(err)
	}

	// Non-image documents (PDFs) are preserved as-is and never rasterized —
	// nothing further to process, mark ready immediately.
	if !vf.IsImage {
		if err := s.repo.UpdateProcessingResult(ctx, asset.ID, StatusReady, nil, nil, nil); err != nil {
			return nil, apperrors.Internal(err)
		}
		asset.ProcessingStatus = StatusReady
		return asset, nil
	}

	if err := s.processImage(ctx, asset, dir, key, vf); err != nil {
		// Processing failure leaves the original on disk (already durably
		// written above) and the row marked failed — nothing is lost, the
		// upload can be retried/reprocessed from original_storage_key.
		if uerr := s.repo.UpdateProcessingResult(ctx, asset.ID, StatusFailed, nil, nil, nil); uerr != nil {
			log.Printf("[media] failed to record processing failure for %s: %v", asset.ID, uerr)
		}
		return nil, apperrors.Internal(fmt.Errorf("process image: %w", err))
	}

	return asset, nil
}

// processImage runs the concurrency-limited variant generation for an
// image asset and records the result. The semaphore bounds how many of
// these run at once process-wide, independent of how many HTTP requests
// are in flight — see the libvips benchmark (BENCHMARK_RESULTS.md) for why
// 2 is the tested-safe default on this host's memory budget.
func (s *Service) processImage(ctx context.Context, asset *Asset, dir, key string, vf *ValidatedFile) error {
	select {
	case s.sem <- struct{}{}:
		defer func() { <-s.sem }()
	case <-ctx.Done():
		return ctx.Err()
	}

	if err := s.repo.UpdateProcessingResult(ctx, asset.ID, StatusProcessing, nil, nil, nil); err != nil {
		return err
	}

	var variants map[string]Variant
	if asset.Category == CategoryProductImage {
		v, _, err := ProcessProductImage(ctx, s.cfg.ProcessingTimeout, dir, key, vf.Bytes)
		if err != nil {
			return err
		}
		variants = v
	} else {
		v, err := ProcessPrivateProofPreview(ctx, s.cfg.ProcessingTimeout, dir, key, vf.Bytes)
		if err != nil {
			return err
		}
		variants = map[string]Variant{"preview": v}
	}

	variantJSON, err := json.Marshal(variants)
	if err != nil {
		return fmt.Errorf("marshal variant metadata: %w", err)
	}
	w, h := vf.Width, vf.Height
	if err := s.repo.UpdateProcessingResult(ctx, asset.ID, StatusReady, variantJSON, &w, &h); err != nil {
		return err
	}
	asset.ProcessingStatus = StatusReady
	asset.VariantMetadataJSON = variantJSON
	return nil
}

// Authorize is the baseline ownership check: the uploader may always act on
// their own asset; any owner-equivalent role may act on anything. Domain
// modules that attach media to a business object with its own RBAC (an
// order, a courier's cash handover) should perform their own authorization
// before calling Service directly rather than relying solely on this — this
// is the "authorization-through-owning-object" extension point described in
// the Phase 1 spec; only the generic HTTP endpoints in handler.go use this
// baseline today. See deliverables report, "remaining questions."
func (s *Service) Authorize(callerID uuid.UUID, callerRole string, asset *Asset) error {
	if callerRole == "owner" || callerRole == "it_specialist" {
		return nil
	}
	if asset.UploadedByUserID == callerID {
		return nil
	}
	return ErrForbidden
}

// GetByID returns the asset or nil (not found is not an error here — the
// caller decides how to respond, see handler.go which always maps a miss
// to a generic 404 for the delivery paths).
func (s *Service) GetByID(ctx context.Context, id uuid.UUID) (*Asset, error) {
	return s.repo.GetByID(ctx, id)
}

// PublicURL is the stable, cacheable URL for a public variant/original —
// no signature needed since dirPublic only ever contains assets whose
// visibility is public (enforced at Create, never changed after).
func (s *Service) PublicURL(key string) string {
	return "/media/public/" + key
}

// SignedURL mints a short-lived HMAC URL for a private asset's original or
// a named variant. Returns ErrForbidden's sibling (a plain error, not
// ErrForbidden itself — callers already ran Authorize before calling this)
// only for "variant does not exist"; expiry/signature failures happen at
// verification time, not here.
func (s *Service) SignedURL(asset *Asset, variant string) (SignedURLResponse, error) {
	key := asset.StorageKey
	if variant != "" && variant != "original" {
		var variants map[string]Variant
		if len(asset.VariantMetadataJSON) > 0 {
			if err := json.Unmarshal(asset.VariantMetadataJSON, &variants); err != nil {
				return SignedURLResponse{}, fmt.Errorf("decode variant metadata: %w", err)
			}
		}
		v, ok := variants[variant]
		if !ok {
			return SignedURLResponse{}, fmt.Errorf("unknown variant %q", variant)
		}
		key = v.StorageKey
	}

	expiresAt := time.Now().Add(s.cfg.SignedURLTTL)
	query := NewSignedURLQuery(s.cfg.SigningSecret, key, variant, s.cfg.SignedURLTTL)
	return SignedURLResponse{
		URL:       fmt.Sprintf("/media/private/%s?%s", key, query),
		ExpiresAt: expiresAt,
	}, nil
}

// Delete removes the DB association and quarantines every physical file
// belonging to the asset (original + all variants) in one call — the
// files are moved, never immediately unlinked, so the retention-window
// purge job (PurgeExpiredQuarantine) is the only path that ever permanently
// deletes private evidence.
func (s *Service) Delete(ctx context.Context, asset *Asset) error {
	dir := s.visibilityDir(asset.Visibility)
	keys := []string{asset.OriginalStorageKey}
	if asset.StorageKey != asset.OriginalStorageKey {
		keys = append(keys, asset.StorageKey)
	}
	if len(asset.VariantMetadataJSON) > 0 {
		var variants map[string]Variant
		if err := json.Unmarshal(asset.VariantMetadataJSON, &variants); err == nil {
			for _, v := range variants {
				keys = append(keys, v.StorageKey)
			}
		}
	}
	for _, k := range keys {
		if err := quarantineFile(dir, s.quarantineDir(), k); err != nil && !os.IsNotExist(err) {
			log.Printf("[media] quarantine move failed for asset %s key %s: %v", asset.ID, k, err)
		}
	}
	return s.repo.SoftDeleteAndQuarantine(ctx, asset.ID)
}

// PurgeExpiredQuarantine physically deletes quarantined files whose
// retention window has elapsed. The DB row is deliberately left in place
// (deleted_at/quarantined_at already record what happened and when) —
// only the file is unrecoverable after this; the metadata trail survives
// as a permanent audit record, which is cheap to keep and is exactly what
// "don't immediately permanently delete important private evidence" is
// guarding against for the file itself, not the fact that it once existed.
func (s *Service) PurgeExpiredQuarantine(ctx context.Context, limit int) (int, error) {
	cutoff := time.Now().Add(-s.cfg.QuarantineRetention)
	rows, err := s.repo.ListPurgeable(ctx, cutoff, limit)
	if err != nil {
		return 0, err
	}
	purged := 0
	for _, a := range rows {
		keys := map[string]struct{}{a.OriginalStorageKey: {}, a.StorageKey: {}}
		if len(a.VariantMetadataJSON) > 0 {
			var variants map[string]Variant
			if err := json.Unmarshal(a.VariantMetadataJSON, &variants); err == nil {
				for _, v := range variants {
					keys[v.StorageKey] = struct{}{}
				}
			}
		}
		for k := range keys {
			p := filepath.Join(s.quarantineDir(), k)
			if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
				log.Printf("[media] purge failed for %s: %v", p, err)
				continue
			}
		}
		purged++
	}
	return purged, nil
}

func (s *Service) visibilityDir(v Visibility) string {
	if v == VisibilityPublic {
		return filepath.Join(s.cfg.UploadDir, dirPublic)
	}
	return filepath.Join(s.cfg.UploadDir, dirPrivate)
}

func (s *Service) quarantineDir() string {
	return filepath.Join(s.cfg.UploadDir, dirQuarantine)
}

// quarantineFile moves key from srcDir into quarantineDir via rename (same
// filesystem, so this is atomic and doesn't risk a partially-moved file).
func quarantineFile(srcDir, quarantineDir, key string) error {
	if !SafeStorageKey(key) {
		return fmt.Errorf("refusing to quarantine unsafe key %q", key)
	}
	if err := os.MkdirAll(quarantineDir, 0o750); err != nil {
		return fmt.Errorf("ensure quarantine dir: %w", err)
	}
	src := filepath.Join(srcDir, key)
	dst := filepath.Join(quarantineDir, key)
	if err := os.Rename(src, dst); err != nil {
		return err
	}
	return nil
}
