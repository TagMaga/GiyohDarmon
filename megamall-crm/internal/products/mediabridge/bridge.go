// Package mediabridge adapts internal/media.Service's real methods into
// internal/products' narrow, primitive-typed AttachProductImageFn/
// ReleaseMediaFn function types.
//
// This has to live in its own package, separate from both internal/media
// and internal/products: internal/testutil (which internal/media's own
// test files depend on for DB/user fixtures) already imports
// internal/products for its product/inventory fixture helpers, so
// internal/products cannot import internal/media directly without creating
// media[tests]→testutil→products→media, a real import cycle. mediabridge
// imports both freely — it's a leaf package nothing else depends on, used
// by cmd/server/main.go (production wiring) and by internal/products' own
// tests (so tests exercise the exact same adapter code production runs,
// not a second, potentially-drifted reimplementation).
package mediabridge

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/media"
	"github.com/megamall/crm/internal/products"
)

// Adapters builds the two function values products.NewService needs from a
// real, non-nil *media.Service. Callers that want the media pipeline
// disabled simply don't call this and pass nil, nil to products.NewService
// instead — see main.go's "Gated behind MEDIA_PIPELINE_ENABLED" comment.
func Adapters(mediaSvc *media.Service) (products.AttachProductImageFn, products.ReleaseMediaFn) {
	attach := func(ctx context.Context, assetID, productID, actorID uuid.UUID) (*products.MediaAssetInfo, error) {
		asset, err := mediaSvc.AttachToOwner(ctx, assetID, media.CategoryProductImage, "products", productID, actorID)
		if err != nil {
			switch {
			case errors.Is(err, media.ErrAssetNotFound):
				return nil, fmt.Errorf("%w: %v", products.ErrMediaAssetNotFound, err)
			case errors.Is(err, media.ErrCategoryMismatch):
				return nil, fmt.Errorf("%w: %v", products.ErrMediaCategoryMismatch, err)
			case errors.Is(err, media.ErrAlreadyAttached):
				return nil, fmt.Errorf("%w: %v", products.ErrMediaAlreadyAttached, err)
			default:
				return nil, err
			}
		}

		variants, verr := mediaSvc.VariantsOf(asset)
		if verr != nil {
			return nil, verr
		}
		urlFor := func(name string) *string {
			v, ok := variants[name]
			if !ok {
				return nil
			}
			u := mediaSvc.PublicURL(v.StorageKey)
			return &u
		}

		return &products.MediaAssetInfo{
			ID:           asset.ID,
			OriginalURL:  mediaSvc.PublicURL(asset.StorageKey),
			ThumbnailURL: urlFor("thumbnail"),
			CardURL:      urlFor("card"),
			DetailURL:    urlFor("detail"),
			Width:        asset.Width,
			Height:       asset.Height,
		}, nil
	}

	return attach, mediaSvc.ReleaseByID
}
