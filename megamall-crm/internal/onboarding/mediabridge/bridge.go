// Package mediabridge adapts internal/media.Service's real methods into
// internal/onboarding's narrow, primitive-typed CreateMediaFn/ReleaseMediaFn/
// SignedMediaURLFn function types — mirrors internal/users/mediabridge, with
// one difference: onboarding needs to *create* a brand-new asset directly
// (CreateMediaFn), not attach a previously-uploaded one, since a public
// applicant has no JWT to call the authenticated POST /media endpoint with
// in the first place. See internal/onboarding/service.go's CreateMediaFn
// doc comment.
package mediabridge

import (
	"context"
	"io"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/media"
	"github.com/megamall/crm/internal/onboarding"
)

// Adapters builds the three function values onboarding.NewService's
// SetMediaAdapters needs from a real, non-nil *media.Service. Callers that
// want the media pipeline disabled simply don't call this and pass
// nil, nil, nil to onboardingSvc.SetMediaAdapters instead.
func Adapters(mediaSvc *media.Service) (onboarding.CreateMediaFn, onboarding.ReleaseMediaFn, onboarding.SignedMediaURLFn) {
	createMedia := func(ctx context.Context, originalFilename string, declaredSize int64, r io.Reader) (*onboarding.CreatedMediaAsset, error) {
		// UploadedByUserID is uuid.Nil — there is no authenticated uploader
		// for a public application; media.Service.Authorize still lets any
		// owner-level caller view/manage the asset regardless (see
		// internal/media/service.go's Authorize: owner/it_specialist always
		// passes, independent of UploadedByUserID). OwnerEntityType/ID are
		// left empty so the asset stays "unattached," exactly like the
		// normal upload-then-attach flow every authenticated client uses —
		// Service.Approve attaches it to the new user afterward via
		// users.Service.CreateDocument.
		asset, appErr := mediaSvc.Create(ctx, media.CreateParams{
			Category:         media.CategoryUserDocument,
			UploadedByUserID: uuid.Nil,
			OriginalFilename: originalFilename,
			DeclaredSize:     declaredSize,
		}, r)
		if appErr != nil {
			return nil, appErr
		}
		return &onboarding.CreatedMediaAsset{
			AssetID:     asset.ID,
			ContentType: asset.DetectedMimeType,
			SizeBytes:   asset.OriginalSizeBytes,
			Width:       asset.Width,
			Height:      asset.Height,
		}, nil
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

	return createMedia, mediaSvc.ReleaseByID, signedMediaURL
}
