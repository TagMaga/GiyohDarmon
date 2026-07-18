// Package mediabridge adapts internal/media.Service's real methods into
// internal/courier's narrow, primitive-typed AttachCashHandoverProofFn/
// ListCashHandoverProofsFn/ReleaseMediaFn/SignedMediaURLFn function types —
// mirrors internal/orders/mediabridge exactly; see that package's doc
// comment for the full import-cycle reasoning (internal/testutil, which
// internal/media's own tests depend on, already imports internal/courier
// for fixtures, so courier cannot import media directly without a cycle).
package mediabridge

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/courier"
	"github.com/megamall/crm/internal/media"
)

// cashHandoverOwnerType is the owner_entity_type value used for every
// cash-handover proof asset — there is no cash_handovers.media_asset_id
// column; a handover's proofs are found solely via media_assets rows whose
// own owner_entity_type/owner_entity_id point back at it (see
// internal/media.Repository.ListByOwner).
const cashHandoverOwnerType = "cash_handovers"

// Adapters builds the four function values courier.Service.SetMediaAdapters
// needs from a real, non-nil *media.Service. Callers that want the media
// pipeline disabled simply don't call this and never call
// SetMediaAdapters, leaving courier.Service's adapters nil.
func Adapters(mediaSvc *media.Service) (courier.AttachCashHandoverProofFn, courier.ListCashHandoverProofsFn, courier.ReleaseMediaFn, courier.SignedMediaURLFn) {
	attach := func(ctx context.Context, assetID, handoverID, actorID uuid.UUID) (*courier.MediaAssetInfo, error) {
		asset, err := mediaSvc.AttachToOwner(ctx, assetID, media.CategoryCashHandoverProof, cashHandoverOwnerType, handoverID, actorID)
		if err != nil {
			switch {
			case errors.Is(err, media.ErrAssetNotFound):
				return nil, fmt.Errorf("%w: %v", courier.ErrMediaAssetNotFound, err)
			case errors.Is(err, media.ErrCategoryMismatch):
				return nil, fmt.Errorf("%w: %v", courier.ErrMediaCategoryMismatch, err)
			case errors.Is(err, media.ErrAlreadyAttached):
				return nil, fmt.Errorf("%w: %v", courier.ErrMediaAlreadyAttached, err)
			default:
				return nil, err
			}
		}
		return &courier.MediaAssetInfo{ID: asset.ID, Width: asset.Width, Height: asset.Height}, nil
	}

	list := func(ctx context.Context, handoverID uuid.UUID) ([]courier.MediaAssetInfo, error) {
		assets, err := mediaSvc.ListByOwner(ctx, cashHandoverOwnerType, handoverID)
		if err != nil {
			return nil, err
		}
		out := make([]courier.MediaAssetInfo, 0, len(assets))
		for _, a := range assets {
			out = append(out, courier.MediaAssetInfo{ID: a.ID, Width: a.Width, Height: a.Height})
		}
		return out, nil
	}

	signedMediaURL := func(ctx context.Context, assetID uuid.UUID, variant string) string {
		asset, err := mediaSvc.GetByID(ctx, assetID)
		if err != nil || asset == nil {
			return ""
		}
		signed, err := mediaSvc.SignedURL(asset, variant)
		if err != nil {
			return ""
		}
		return signed.URL
	}

	return attach, list, mediaSvc.ReleaseByID, signedMediaURL
}
