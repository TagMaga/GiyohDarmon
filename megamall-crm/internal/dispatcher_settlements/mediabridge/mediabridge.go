// Package mediabridge adapts internal/media.Service's real methods into
// internal/dispatcher_settlements's narrow, primitive-typed
// AttachSettlementProofFn/ListSettlementProofsFn/ReleaseMediaFn/
// SignedMediaURLFn function types — mirrors internal/courier/mediabridge
// exactly; see that package's doc comment for the import-cycle reasoning.
package mediabridge

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	dispatcher_settlements "github.com/megamall/crm/internal/dispatcher_settlements"
	"github.com/megamall/crm/internal/media"
)

// settlementOwnerType is the owner_entity_type value used for every
// dispatcher-settlement proof asset — there is no proof column on
// dispatcher_settlements; a settlement's proof is found solely via
// media_assets rows whose own owner_entity_type/owner_entity_id point back
// at it (see internal/media.Repository.ListByOwner). Reuses the
// cash_handover_proof category — same kind of content (a receipt/cash
// photo), and dispatcher is already an allowed uploader role for it (see
// internal/media/rbac.go).
const settlementOwnerType = "dispatcher_settlements"

// Adapters builds the four function values
// dispatcher_settlements.Service.SetMediaAdapters needs from a real,
// non-nil *media.Service.
func Adapters(mediaSvc *media.Service) (
	dispatcher_settlements.AttachSettlementProofFn,
	dispatcher_settlements.ListSettlementProofsFn,
	dispatcher_settlements.ReleaseMediaFn,
	dispatcher_settlements.SignedMediaURLFn,
) {
	attach := func(ctx context.Context, assetID, settlementID, actorID uuid.UUID) (*dispatcher_settlements.MediaAssetInfo, error) {
		asset, err := mediaSvc.AttachToOwner(ctx, assetID, media.CategoryCashHandoverProof, settlementOwnerType, settlementID, actorID)
		if err != nil {
			switch {
			case errors.Is(err, media.ErrAssetNotFound):
				return nil, fmt.Errorf("%w: %v", dispatcher_settlements.ErrMediaAssetNotFound, err)
			case errors.Is(err, media.ErrCategoryMismatch):
				return nil, fmt.Errorf("%w: %v", dispatcher_settlements.ErrMediaCategoryMismatch, err)
			case errors.Is(err, media.ErrAlreadyAttached):
				return nil, fmt.Errorf("%w: %v", dispatcher_settlements.ErrMediaAlreadyAttached, err)
			default:
				return nil, err
			}
		}
		return &dispatcher_settlements.MediaAssetInfo{ID: asset.ID, Width: asset.Width, Height: asset.Height}, nil
	}

	list := func(ctx context.Context, settlementID uuid.UUID) ([]dispatcher_settlements.MediaAssetInfo, error) {
		assets, err := mediaSvc.ListByOwner(ctx, settlementOwnerType, settlementID)
		if err != nil {
			return nil, err
		}
		out := make([]dispatcher_settlements.MediaAssetInfo, 0, len(assets))
		for _, a := range assets {
			out = append(out, dispatcher_settlements.MediaAssetInfo{ID: a.ID, Width: a.Width, Height: a.Height})
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
