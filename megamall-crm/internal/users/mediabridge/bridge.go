// Package mediabridge adapts internal/media.Service's real methods into
// internal/users' narrow, primitive-typed AttachAvatarFn/
// AttachUserDocumentFn/ReleaseMediaFn/SignedMediaURLFn function types —
// mirrors internal/products/mediabridge exactly; see that package's doc
// comment for the full import-cycle reasoning (internal/testutil, which
// internal/media's own tests depend on, already imports internal/users for
// fixtures, so users cannot import media directly without a cycle).
package mediabridge

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/media"
	"github.com/megamall/crm/internal/users"
)

// Adapters builds the four function values users.NewService needs from a
// real, non-nil *media.Service. Callers that want the media pipeline
// disabled simply don't call this and pass nil, nil, nil, nil to
// users.NewService instead.
func Adapters(mediaSvc *media.Service) (users.AttachAvatarFn, users.AttachUserDocumentFn, users.ReleaseMediaFn, users.SignedMediaURLFn) {
	attachAvatar := func(ctx context.Context, assetID, userID uuid.UUID) (*users.MediaAssetInfo, error) {
		return attach(ctx, mediaSvc, assetID, media.CategoryAvatar, "users", userID)
	}
	attachUserDocument := func(ctx context.Context, assetID, userID uuid.UUID) (*users.MediaAssetInfo, error) {
		return attach(ctx, mediaSvc, assetID, media.CategoryUserDocument, "users", userID)
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

	return attachAvatar, attachUserDocument, mediaSvc.ReleaseByID, signedMediaURL
}

func attach(ctx context.Context, mediaSvc *media.Service, assetID uuid.UUID, category media.Category, ownerEntityType string, ownerEntityID uuid.UUID) (*users.MediaAssetInfo, error) {
	asset, err := mediaSvc.AttachToOwner(ctx, assetID, category, ownerEntityType, ownerEntityID)
	if err != nil {
		switch {
		case errors.Is(err, media.ErrAssetNotFound):
			return nil, fmt.Errorf("%w: %v", users.ErrMediaAssetNotFound, err)
		case errors.Is(err, media.ErrCategoryMismatch):
			return nil, fmt.Errorf("%w: %v", users.ErrMediaCategoryMismatch, err)
		case errors.Is(err, media.ErrAlreadyAttached):
			return nil, fmt.Errorf("%w: %v", users.ErrMediaAlreadyAttached, err)
		default:
			return nil, err
		}
	}

	return &users.MediaAssetInfo{
		OriginalFilename: asset.OriginalFilename,
		ContentType:      asset.DetectedMimeType,
		SizeBytes:        asset.OriginalSizeBytes,
		Width:            asset.Width,
		Height:           asset.Height,
	}, nil
}
