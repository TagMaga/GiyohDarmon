// Package mediabridge adapts internal/media.Service's real methods into
// internal/orders' narrow, primitive-typed AttachOrderAttachmentFn/
// AttachPrepaymentProofFn/ReleaseMediaFn/SignedMediaURLFn function types —
// mirrors internal/products/mediabridge exactly; see that package's doc
// comment for the full import-cycle reasoning (internal/testutil, which
// internal/media's own tests depend on, already imports internal/orders
// for fixtures, so orders cannot import media directly without a cycle).
package mediabridge

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/media"
	"github.com/megamall/crm/internal/orders"
)

// Adapters builds the four function values orders.Service.SetMediaAdapters
// needs from a real, non-nil *media.Service. Callers that want the media
// pipeline disabled simply don't call this and never call
// SetMediaAdapters, leaving orders.Service's adapters nil.
func Adapters(mediaSvc *media.Service) (orders.AttachOrderAttachmentFn, orders.AttachPrepaymentProofFn, orders.ReleaseMediaFn, orders.SignedMediaURLFn) {
	attachOrderAttachment := func(ctx context.Context, assetID, orderID uuid.UUID) (*orders.MediaAssetInfo, error) {
		return attach(ctx, mediaSvc, assetID, media.CategoryOrderAttachment, "orders", orderID)
	}
	attachPrepaymentProof := func(ctx context.Context, assetID, orderID uuid.UUID) (*orders.MediaAssetInfo, error) {
		return attach(ctx, mediaSvc, assetID, media.CategoryPrepaymentProof, "orders", orderID)
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

	return attachOrderAttachment, attachPrepaymentProof, mediaSvc.ReleaseByID, signedMediaURL
}

func attach(ctx context.Context, mediaSvc *media.Service, assetID uuid.UUID, category media.Category, ownerEntityType string, ownerEntityID uuid.UUID) (*orders.MediaAssetInfo, error) {
	asset, err := mediaSvc.AttachToOwner(ctx, assetID, category, ownerEntityType, ownerEntityID)
	if err != nil {
		switch {
		case errors.Is(err, media.ErrAssetNotFound):
			return nil, fmt.Errorf("%w: %v", orders.ErrMediaAssetNotFound, err)
		case errors.Is(err, media.ErrCategoryMismatch):
			return nil, fmt.Errorf("%w: %v", orders.ErrMediaCategoryMismatch, err)
		case errors.Is(err, media.ErrAlreadyAttached):
			return nil, fmt.Errorf("%w: %v", orders.ErrMediaAlreadyAttached, err)
		default:
			return nil, err
		}
	}

	return &orders.MediaAssetInfo{
		Width:  asset.Width,
		Height: asset.Height,
	}, nil
}
