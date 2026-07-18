// Package mediabridge adapts internal/media.Service's real methods into
// internal/logistics' narrow, primitive-typed ListCashHandoverProofsFn/
// SignedMediaURLFn function types — mirrors internal/courier/mediabridge,
// read-only (internal/logistics only displays cash-handover proofs on the
// owner dashboard; it never attaches/uploads them). See
// internal/orders/mediabridge/bridge.go's doc comment for the full
// import-cycle reasoning this shares.
package mediabridge

import (
	"context"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/logistics"
	"github.com/megamall/crm/internal/media"
)

// cashHandoverOwnerType matches internal/courier/mediabridge's constant of
// the same name — both packages resolve the same underlying media_assets
// rows (owner_entity_type = "cash_handovers"), just for different
// consumers (courier/dispatcher endpoints vs. the owner logistics
// dashboard read here).
const cashHandoverOwnerType = "cash_handovers"

// Adapters builds the two function values logistics.Handler.SetMediaAdapters
// needs from a real, non-nil *media.Service.
func Adapters(mediaSvc *media.Service) (logistics.ListCashHandoverProofsFn, logistics.SignedMediaURLFn) {
	list := func(ctx context.Context, handoverID uuid.UUID) ([]logistics.MediaAssetInfo, error) {
		assets, err := mediaSvc.ListByOwner(ctx, cashHandoverOwnerType, handoverID)
		if err != nil {
			return nil, err
		}
		out := make([]logistics.MediaAssetInfo, 0, len(assets))
		for _, a := range assets {
			out = append(out, logistics.MediaAssetInfo{ID: a.ID, Width: a.Width, Height: a.Height})
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

	return list, signedMediaURL
}
