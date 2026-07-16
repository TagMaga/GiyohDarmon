package products

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"log"
	"net/url"
	"strings"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// allowedImageURLSchemes is a strict allowlist for product image_url values.
// "" means a scheme-less relative path (e.g. "/uploads/xyz.jpg" — what
// POST /uploads returns). Anything not in this set is rejected, which is what
// keeps out data:, javascript:, vbscript:, file:, blob:, and any other scheme
// without having to enumerate each dangerous one individually.
var allowedImageURLSchemes = map[string]bool{"": true, "http": true, "https": true}

// validateImageURL enforces the allowlist above. Case-insensitive on the
// scheme and tolerant of leading/trailing whitespace, since both are trivial
// ways to smuggle a "data:" / "javascript:" payload past a naive prefix check.
func validateImageURL(raw string) error {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return apperrors.BadRequest("image_url is required")
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return apperrors.BadRequest("image_url is not a valid URL")
	}
	scheme := strings.ToLower(u.Scheme)
	if !allowedImageURLSchemes[scheme] {
		return apperrors.BadRequest("image_url must be a relative path, or an http(s) URL — scheme not allowed")
	}
	// Reject protocol-relative URLs ("//evil.com/x") — these parse with an
	// empty scheme but a real host, and browsers resolve them against
	// whatever scheme the current page is using.
	if scheme == "" && u.Host != "" {
		return apperrors.BadRequest("image_url must be a relative path, not a protocol-relative URL")
	}
	return nil
}

// MediaAssetInfo is what an external media-pipeline integration (see
// AttachProductImageFn) reports about a freshly-attached product image.
// Deliberately a plain, local struct rather than importing internal/media's
// own Asset/Variant types directly: internal/testutil (which internal/
// media's own test files depend on for DB/user fixtures) already imports
// internal/products for its product/inventory fixture helpers, so products
// importing media back would create a real import cycle
// (media[tests]→testutil→products→media). main.go — never imported by
// anything, so cycle-immune — is where the real *media.Service gets
// adapted into these primitive-typed function signatures; see its
// "Phase 2: product image media integration" section.
type MediaAssetInfo struct {
	ID uuid.UUID
	// OriginalURL is always set (falls back to the asset's original file
	// if no variants exist yet) so ImageURL is never left empty.
	OriginalURL  string
	ThumbnailURL *string
	CardURL      *string
	DetailURL    *string
	Width        *int
	Height       *int
}

// AttachProductImageFn claims a previously-uploaded, unattached media
// asset (the adapter is responsible for checking it's category=
// product_image) as productID's image, returning its resolved public
// variant URLs. Returns (wrapped, check with errors.Is)
// ErrMediaAssetNotFound / ErrMediaCategoryMismatch / ErrMediaAlreadyAttached
// for the caller to map to the right HTTP response — see mediaAttachError.
type AttachProductImageFn func(ctx context.Context, assetID, productID uuid.UUID) (*MediaAssetInfo, error)

// ReleaseMediaFn quarantines a previously-attached (or attach-then-
// abandoned) media asset — the compensating action for a failed create, a
// replaced image, or a deleted image. Wired to internal/media.Service.
// ReleaseByID in main.go.
type ReleaseMediaFn func(ctx context.Context, assetID uuid.UUID) error

// Sentinel errors an AttachProductImageFn implementation should wrap (via
// fmt.Errorf("...: %w", ErrMediaAssetNotFound) or errors.Join) so
// mediaAttachError can map them to the right client-facing response.
var (
	ErrMediaAssetNotFound    = errors.New("media asset not found")
	ErrMediaCategoryMismatch = errors.New("media asset is not a product image")
	ErrMediaAlreadyAttached  = errors.New("media asset is already attached to a product")
)

// Service encapsulates product catalog business logic.
type Service struct {
	repo   *Repository
	logger *activity.Logger
	db     *gorm.DB
	// attachProductImage/releaseMedia are nil when MEDIA_PIPELINE_ENABLED=
	// false — see requireMedia. Every method that would use them checks
	// requireMedia first, so a disabled deploy behaves identically to a
	// build that never had media integration wired in at all for every
	// request that doesn't reference primary_image_media_asset_id /
	// media_asset_id — see service_test.go's TestCreateProduct_MediaDisabled*.
	attachProductImage AttachProductImageFn
	releaseMedia       ReleaseMediaFn
}

func NewService(repo *Repository, logger *activity.Logger, db *gorm.DB, attachProductImage AttachProductImageFn, releaseMedia ReleaseMediaFn) *Service {
	return &Service{repo: repo, logger: logger, db: db, attachProductImage: attachProductImage, releaseMedia: releaseMedia}
}

// requireMedia returns a clear, user-facing error when the caller supplied
// a media-pipeline-backed field (primary_image_media_asset_id, or
// media_asset_id on an image) but the pipeline is disabled.
func (s *Service) requireMedia() error {
	if s.attachProductImage == nil {
		return apperrors.BadRequest("the media pipeline is not enabled")
	}
	return nil
}

// mediaAttachError maps AttachProductImageFn's sentinel errors to the
// appropriate client-facing AppError.
func mediaAttachError(err error) error {
	switch {
	case errors.Is(err, ErrMediaAssetNotFound):
		return apperrors.BadRequest("referenced image was not found or has already been used")
	case errors.Is(err, ErrMediaCategoryMismatch):
		return apperrors.BadRequest("referenced upload is not a product image")
	case errors.Is(err, ErrMediaAlreadyAttached):
		return apperrors.Conflict("referenced image is already attached to a product")
	default:
		return err
	}
}

// buildImageFromAsset constructs a (not-yet-persisted) ProductImage from a
// just-attached media asset's resolved info, denormalizing the thumbnail/
// card/detail variant URLs and dimensions onto the row — see model.go's
// ProductImage doc comment for why. ImageURL is set to the card variant
// (falling back to thumbnail, then detail, then the original) so legacy
// consumers reading only image_url always get something sensible.
func buildImageFromAsset(info *MediaAssetInfo, productID uuid.UUID, isPrimary bool, sortOrder int) *ProductImage {
	imageURL := info.OriginalURL
	switch {
	case info.CardURL != nil:
		imageURL = *info.CardURL
	case info.ThumbnailURL != nil:
		imageURL = *info.ThumbnailURL
	case info.DetailURL != nil:
		imageURL = *info.DetailURL
	}

	return &ProductImage{
		ID:           uuid.New(),
		ProductID:    productID,
		ImageURL:     imageURL,
		MediaAssetID: &info.ID,
		ThumbnailURL: info.ThumbnailURL,
		CardURL:      info.CardURL,
		DetailURL:    info.DetailURL,
		Width:        info.Width,
		Height:       info.Height,
		IsPrimary:    isPrimary,
		SortOrder:    sortOrder,
	}
}

// ─── Suppliers ────────────────────────────────────────────────────────────────

func (s *Service) ListSuppliers(ctx context.Context, p pagination.Params) ([]Supplier, int, error) {
	return s.repo.ListSuppliers(ctx, p)
}

func (s *Service) CreateSupplier(ctx context.Context, actorID uuid.UUID, req CreateSupplierRequest) (*Supplier, error) {
	sup := &Supplier{
		ID:       uuid.New(),
		Name:     req.Name,
		Phone:    req.Phone,
		Email:    req.Email,
		Address:  req.Address,
		Notes:    req.Notes,
		IsActive: true,
	}
	if err := s.repo.CreateSupplier(ctx, sup); err != nil {
		return nil, err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:    &actorID,
		Action:     "create",
		EntityType: "supplier",
		EntityID:   &sup.ID,
		AfterState: sup,
	})
	return sup, nil
}

func (s *Service) UpdateSupplier(ctx context.Context, actorID, id uuid.UUID, req UpdateSupplierRequest) (*Supplier, error) {
	sup, err := s.repo.GetSupplierByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if sup == nil {
		return nil, apperrors.NotFound("supplier")
	}
	before := *sup

	if req.Name != nil {
		sup.Name = *req.Name
	}
	if req.Phone != nil {
		sup.Phone = req.Phone
	}
	if req.Email != nil {
		sup.Email = req.Email
	}
	if req.Address != nil {
		sup.Address = req.Address
	}
	if req.Notes != nil {
		sup.Notes = req.Notes
	}
	if req.IsActive != nil {
		sup.IsActive = *req.IsActive
	}

	if err := s.repo.UpdateSupplier(ctx, sup); err != nil {
		return nil, err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:     &actorID,
		Action:      "update",
		EntityType:  "supplier",
		EntityID:    &sup.ID,
		BeforeState: before,
		AfterState:  sup,
	})
	return sup, nil
}

func (s *Service) DeleteSupplier(ctx context.Context, actorID, id uuid.UUID) error {
	sup, err := s.repo.GetSupplierByID(ctx, id)
	if err != nil {
		return err
	}
	if sup == nil {
		return apperrors.NotFound("supplier")
	}
	if err := s.repo.DeleteSupplier(ctx, id); err != nil {
		return err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:     &actorID,
		Action:      "delete",
		EntityType:  "supplier",
		EntityID:    &id,
		BeforeState: sup,
	})
	return nil
}

// ─── Products ─────────────────────────────────────────────────────────────────

func (s *Service) ListProducts(ctx context.Context, f ListProductsFilter, p pagination.Params) ([]Product, int, error) {
	return s.repo.ListProducts(ctx, f, p)
}

func (s *Service) GetProductByID(ctx context.Context, id uuid.UUID) (*Product, error) {
	p, err := s.repo.GetProductByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, apperrors.NotFound("product")
	}
	return p, nil
}

func (s *Service) CreateProduct(ctx context.Context, actorID uuid.UUID, req CreateProductRequest) (*Product, error) {
	if req.PrimaryImageMediaAssetID != nil {
		// Fail fast, before any product row is created, if the caller
		// asked for a media-pipeline image but the feature is disabled —
		// see requireMedia's doc comment.
		if err := s.requireMedia(); err != nil {
			return nil, err
		}
	}

	sku := strings.TrimSpace(req.SKU)
	if sku == "" {
		generated, err := s.generateSKU(ctx)
		if err != nil {
			return nil, err
		}
		sku = generated
	} else {
		// SKU uniqueness check for explicitly provided SKUs.
		existing, err := s.repo.GetProductBySKU(ctx, sku)
		if err != nil {
			return nil, err
		}
		if existing != nil {
			return nil, apperrors.Conflict(fmt.Sprintf("product with SKU '%s' already exists", sku))
		}
	}

	// Barcode uniqueness check.
	if req.Barcode != nil && *req.Barcode != "" {
		dup, err := s.repo.GetProductByBarcode(ctx, *req.Barcode)
		if err != nil {
			return nil, err
		}
		if dup != nil {
			return nil, apperrors.Conflict(fmt.Sprintf("product with barcode '%s' already exists", *req.Barcode))
		}
	}

	p := &Product{
		ID:                 uuid.New(),
		SKU:                sku,
		ArticleNumber:      req.ArticleNumber,
		Barcode:            req.Barcode,
		Name:               req.Name,
		Description:        req.Description,
		SupplierID:         req.SupplierID,
		PurchasePrice:      req.PurchasePrice,
		SalePrice:          req.SalePrice,
		Weight:             req.Weight,
		NormalDeliveryFee:  req.NormalDeliveryFee,
		ExpressDeliveryFee: req.ExpressDeliveryFee,
		IsActive:           true,
	}
	if err := s.repo.CreateProduct(ctx, p); err != nil {
		return nil, err
	}

	if req.PrimaryImageMediaAssetID != nil {
		if err := s.attachPrimaryImageOrRollback(ctx, p, *req.PrimaryImageMediaAssetID); err != nil {
			return nil, err
		}
	}

	s.logger.LogAsync(activity.Entry{
		ActorID:    &actorID,
		Action:     "create",
		EntityType: "product",
		EntityID:   &p.ID,
		AfterState: p,
	})
	return p, nil
}

// attachPrimaryImageOrRollback attaches assetID as productID's primary
// image. If the attach itself fails, or the product_images row insert that
// follows it fails, the just-created product row (see CreateProduct,
// immediately above the only call site) is hard-deleted before returning —
// this is the "prevent orphan files when product creation fails"
// requirement's mirror image: it prevents an orphan *product* (one whose
// caller explicitly asked for an image that never actually got attached)
// rather than leaving a half-created row for the client to discover only
// on next read. The media asset itself, if the second step (row insert)
// fails after a successful attach, is released (quarantined) too — so
// neither side of the operation survives a partial failure.
func (s *Service) attachPrimaryImageOrRollback(ctx context.Context, p *Product, assetID uuid.UUID) error {
	info, err := s.attachProductImage(ctx, assetID, p.ID)
	if err != nil {
		if rbErr := s.repo.HardDeleteProduct(ctx, p.ID); rbErr != nil {
			log.Printf("[products] rollback failed for product %s after image attach failure: %v", p.ID, rbErr)
		}
		return mediaAttachError(err)
	}

	img := buildImageFromAsset(info, p.ID, true, 0)
	if err := s.repo.AddProductImage(ctx, img); err != nil {
		s.releaseAndLog(ctx, assetID)
		if rbErr := s.repo.HardDeleteProduct(ctx, p.ID); rbErr != nil {
			log.Printf("[products] rollback failed for product %s after image row insert failure: %v", p.ID, rbErr)
		}
		return err
	}

	p.Images = append(p.Images, *img)
	return nil
}

// releaseAndLog quarantines a media asset as a compensating action,
// logging (never failing the caller's own operation on) an error — by the
// time this is called, the caller has already decided its own operation
// failed and is unwinding; a release failure here just means the asset
// waits for the orphan-reconciliation path instead of being cleaned up
// immediately, not a reason to mask the original error.
func (s *Service) releaseAndLog(ctx context.Context, assetID uuid.UUID) {
	if err := s.releaseMedia(ctx, assetID); err != nil {
		log.Printf("[products] failed to release media asset %s during rollback: %v", assetID, err)
	}
}

// generateSKU produces a "P-000001"-style SKU seeded from the total number of
// products ever created, then bumps past any collision (e.g. a manually
// created SKU that already used that number).
func (s *Service) generateSKU(ctx context.Context) (string, error) {
	total, err := s.repo.CountAllProducts(ctx)
	if err != nil {
		return "", err
	}
	for n := total + 1; ; n++ {
		candidate := fmt.Sprintf("P-%06d", n)
		existing, err := s.repo.GetProductBySKU(ctx, candidate)
		if err != nil {
			return "", err
		}
		if existing == nil {
			return candidate, nil
		}
	}
}

func (s *Service) UpdateProduct(ctx context.Context, actorID, id uuid.UUID, req UpdateProductRequest) (*Product, error) {
	if req.PrimaryImageMediaAssetID != nil {
		if err := s.requireMedia(); err != nil {
			return nil, err
		}
	}

	p, err := s.repo.GetProductByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, apperrors.NotFound("product")
	}
	before := *p

	if req.SKU != nil && *req.SKU != p.SKU {
		dup, err := s.repo.GetProductBySKU(ctx, *req.SKU)
		if err != nil {
			return nil, err
		}
		if dup != nil {
			return nil, apperrors.Conflict(fmt.Sprintf("product with SKU '%s' already exists", *req.SKU))
		}
		p.SKU = *req.SKU
	}
	if req.ArticleNumber != nil {
		p.ArticleNumber = req.ArticleNumber
	}
	if req.Barcode != nil {
		if *req.Barcode != "" {
			dup, err := s.repo.GetProductByBarcode(ctx, *req.Barcode)
			if err != nil {
				return nil, err
			}
			if dup != nil && dup.ID != id {
				return nil, apperrors.Conflict(fmt.Sprintf("product with barcode '%s' already exists", *req.Barcode))
			}
		}
		p.Barcode = req.Barcode
	}
	if req.Name != nil {
		p.Name = *req.Name
	}
	if req.Description != nil {
		p.Description = req.Description
	}
	if req.SupplierID != nil {
		p.SupplierID = req.SupplierID
	}
	if req.PurchasePrice != nil {
		p.PurchasePrice = req.PurchasePrice
	}
	if req.SalePrice != nil {
		p.SalePrice = req.SalePrice
	}
	if req.Weight != nil {
		p.Weight = req.Weight
	}
	if req.NormalDeliveryFee != nil {
		p.NormalDeliveryFee = req.NormalDeliveryFee
	}
	if req.ExpressDeliveryFee != nil {
		p.ExpressDeliveryFee = req.ExpressDeliveryFee
	}
	if req.IsActive != nil {
		p.IsActive = *req.IsActive
	}

	if err := s.repo.UpdateProduct(ctx, p); err != nil {
		return nil, err
	}

	if req.PrimaryImageMediaAssetID != nil {
		if err := s.replacePrimaryImage(ctx, p, *req.PrimaryImageMediaAssetID); err != nil {
			// Every other field on the product was already saved
			// successfully above — an image-replace failure is reported
			// but doesn't roll back those unrelated field changes; the
			// caller can retry the image replace alone.
			return nil, err
		}
	}

	s.logger.LogAsync(activity.Entry{
		ActorID:     &actorID,
		Action:      "update",
		EntityType:  "product",
		EntityID:    &p.ID,
		BeforeState: before,
		AfterState:  p,
	})
	return p, nil
}

// replacePrimaryImage attaches newAssetID as p's primary image, then
// quarantines whichever image(s) were previously marked primary — the
// "deleting/replacing an image must use quarantine workflow" requirement.
// Attach happens first and must succeed before anything about the old
// image is touched, so a failed replace never leaves the product without
// any primary image.
func (s *Service) replacePrimaryImage(ctx context.Context, p *Product, newAssetID uuid.UUID) error {
	info, err := s.attachProductImage(ctx, newAssetID, p.ID)
	if err != nil {
		return mediaAttachError(err)
	}

	img := buildImageFromAsset(info, p.ID, true, 0)

	var oldPrimary []ProductImage
	for _, existing := range p.Images {
		if existing.IsPrimary {
			oldPrimary = append(oldPrimary, existing)
		}
	}

	if err := s.repo.AddProductImage(ctx, img); err != nil {
		s.releaseAndLog(ctx, newAssetID)
		return err
	}

	remaining := make([]ProductImage, 0, len(p.Images)+1)
	for _, existing := range p.Images {
		if !existing.IsPrimary {
			remaining = append(remaining, existing)
		}
	}
	p.Images = append(remaining, *img)

	for _, old := range oldPrimary {
		if err := s.repo.DeleteProductImage(ctx, old.ID, p.ID); err != nil {
			log.Printf("[products] failed to remove old primary image row %s for product %s: %v", old.ID, p.ID, err)
			continue
		}
		if old.MediaAssetID != nil {
			s.releaseAndLog(ctx, *old.MediaAssetID)
		}
	}
	return nil
}

// DeleteProduct soft-deletes the product, then best-effort quarantines any
// media-pipeline-backed images it had. This is deliberately best-effort
// (logged, not returned as an error) rather than all-or-nothing like
// attachPrimaryImageOrRollback/replacePrimaryImage: the product is already
// gone from the app's perspective by the time we get here (the delete the
// caller asked for already succeeded), so a media-service hiccup shouldn't
// turn a successful product delete into a 500 — it just means those files
// wait for the orphan-reconciliation path instead of being quarantined
// immediately.
func (s *Service) DeleteProduct(ctx context.Context, actorID, id uuid.UUID) error {
	p, err := s.repo.GetProductByID(ctx, id)
	if err != nil {
		return err
	}
	if p == nil {
		return apperrors.NotFound("product")
	}
	if err := s.repo.SoftDeleteProduct(ctx, id); err != nil {
		return err
	}

	if s.releaseMedia != nil {
		for _, img := range p.Images {
			if img.MediaAssetID != nil {
				s.releaseAndLog(ctx, *img.MediaAssetID)
			}
		}
	}

	s.logger.LogAsync(activity.Entry{
		ActorID:     &actorID,
		Action:      "delete",
		EntityType:  "product",
		EntityID:    &id,
		BeforeState: p,
	})
	return nil
}

// ─── Product Images ───────────────────────────────────────────────────────────

// AddProductImage accepts either a legacy ImageURL or a media-pipeline
// MediaAssetID (exactly one — see AddProductImageRequest's doc comment).
func (s *Service) AddProductImage(ctx context.Context, actorID, productID uuid.UUID, req AddProductImageRequest) (*ProductImage, error) {
	hasURL := strings.TrimSpace(req.ImageURL) != ""
	hasAsset := req.MediaAssetID != nil
	if hasURL == hasAsset {
		return nil, apperrors.BadRequest("exactly one of image_url or media_asset_id is required")
	}

	p, err := s.repo.GetProductByID(ctx, productID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, apperrors.NotFound("product")
	}

	var img *ProductImage
	if hasURL {
		if err := validateImageURL(req.ImageURL); err != nil {
			return nil, err
		}
		img = &ProductImage{
			ID:        uuid.New(),
			ProductID: productID,
			ImageURL:  req.ImageURL,
			IsPrimary: req.IsPrimary,
			SortOrder: req.SortOrder,
		}
	} else {
		if err := s.requireMedia(); err != nil {
			return nil, err
		}
		info, err := s.attachProductImage(ctx, *req.MediaAssetID, productID)
		if err != nil {
			return nil, mediaAttachError(err)
		}
		img = buildImageFromAsset(info, productID, req.IsPrimary, req.SortOrder)
	}

	if err := s.repo.AddProductImage(ctx, img); err != nil {
		if hasAsset {
			s.releaseAndLog(ctx, *req.MediaAssetID)
		}
		return nil, err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:    &actorID,
		Action:     "add_image",
		EntityType: "product",
		EntityID:   &productID,
		AfterState: img,
	})
	return img, nil
}

// DeleteProductImage removes an image from a product. If the image was
// media-pipeline-backed, the underlying asset is quarantined *before* the
// row is deleted — if quarantine fails, nothing is changed (the caller can
// retry), rather than deleting the row and losing the only reference to
// which asset needed cleanup — the "deleting an image must use quarantine
// workflow" requirement.
func (s *Service) DeleteProductImage(ctx context.Context, actorID, productID, imageID uuid.UUID) error {
	img, err := s.repo.GetProductImageByID(ctx, imageID, productID)
	if err != nil {
		return err
	}
	if img == nil {
		return apperrors.NotFound("product image")
	}

	if img.MediaAssetID != nil {
		if err := s.requireMedia(); err != nil {
			return err
		}
		if err := s.releaseMedia(ctx, *img.MediaAssetID); err != nil {
			return apperrors.Internal(fmt.Errorf("quarantine image: %w", err))
		}
	}

	if err := s.repo.DeleteProductImage(ctx, imageID, productID); err != nil {
		return err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID:    &actorID,
		Action:     "delete_image",
		EntityType: "product",
		EntityID:   &productID,
	})
	return nil
}

// ─── Import ───────────────────────────────────────────────────────────────────

func (s *Service) ImportProducts(ctx context.Context, r io.Reader, dryRun bool) (ImportResult, error) {
	reader := csv.NewReader(r)
	reader.TrimLeadingSpace = true
	lines, err := reader.ReadAll()
	if err != nil {
		return ImportResult{}, apperrors.BadRequest(fmt.Sprintf("invalid CSV: %v", err))
	}
	if len(lines) == 0 {
		return ImportResult{}, apperrors.BadRequest("CSV file is empty")
	}
	result := s.repo.ImportProducts(ctx, lines, dryRun)
	return result, nil
}
