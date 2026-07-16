package products

import (
	"time"

	"github.com/google/uuid"
)

// ─── Supplier ─────────────────────────────────────────────────────────────────

type CreateSupplierRequest struct {
	Name    string  `json:"name"  validate:"required,max=255"`
	Phone   *string `json:"phone"`
	Email   *string `json:"email"  validate:"omitempty,email"`
	Address *string `json:"address"`
	Notes   *string `json:"notes"`
}

type UpdateSupplierRequest struct {
	Name     *string `json:"name"     validate:"omitempty,max=255"`
	Phone    *string `json:"phone"`
	Email    *string `json:"email"    validate:"omitempty,email"`
	Address  *string `json:"address"`
	Notes    *string `json:"notes"`
	IsActive *bool   `json:"is_active"`
}

type SupplierResponse struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Phone     *string   `json:"phone"`
	Email     *string   `json:"email"`
	Address   *string   `json:"address"`
	Notes     *string   `json:"notes"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func ToSupplierResponse(s *Supplier) SupplierResponse {
	return SupplierResponse{
		ID:        s.ID,
		Name:      s.Name,
		Phone:     s.Phone,
		Email:     s.Email,
		Address:   s.Address,
		Notes:     s.Notes,
		IsActive:  s.IsActive,
		CreatedAt: s.CreatedAt,
		UpdatedAt: s.UpdatedAt,
	}
}

// ─── Product ──────────────────────────────────────────────────────────────────

type CreateProductRequest struct {
	SKU           string     `json:"sku"                  validate:"omitempty,max=100"`
	ArticleNumber *string    `json:"article_number"`
	Barcode       *string    `json:"barcode"`
	Name          string     `json:"name"                 validate:"required,max=500"`
	Description   *string    `json:"description"`
	SupplierID    *uuid.UUID `json:"supplier_id"`
	// The 10,000,000 ceiling is a fat-finger/overflow guard, not a real
	// business limit.
	PurchasePrice      *float64 `json:"purchase_price"       validate:"omitempty,min=0,max=10000000"`
	SalePrice          *float64 `json:"sale_price"           validate:"omitempty,min=0,max=10000000"`
	Weight             *float64 `json:"weight"               validate:"omitempty,min=0,max=1000000"`
	NormalDeliveryFee  *float64 `json:"normal_delivery_fee"  validate:"omitempty,min=0,max=10000000"`
	ExpressDeliveryFee *float64 `json:"express_delivery_fee" validate:"omitempty,min=0,max=10000000"`
	// PrimaryImageMediaAssetID, if set, must reference a media_assets row
	// (category=product_image) already uploaded via POST /api/v1/media —
	// the typical flow is: upload the image first (getting an ID back),
	// then create the product referencing it. Optional — omit entirely for
	// the legacy no-image or POST-images-separately flows. Only usable when
	// the media pipeline is enabled; see service.go's CreateProduct.
	PrimaryImageMediaAssetID *uuid.UUID `json:"primary_image_media_asset_id"`
}

type UpdateProductRequest struct {
	SKU                *string    `json:"sku"                  validate:"omitempty,max=100"`
	ArticleNumber      *string    `json:"article_number"`
	Barcode            *string    `json:"barcode"`
	Name               *string    `json:"name"                 validate:"omitempty,max=500"`
	Description        *string    `json:"description"`
	SupplierID         *uuid.UUID `json:"supplier_id"`
	PurchasePrice      *float64   `json:"purchase_price"       validate:"omitempty,min=0,max=10000000"`
	SalePrice          *float64   `json:"sale_price"           validate:"omitempty,min=0,max=10000000"`
	Weight             *float64   `json:"weight"               validate:"omitempty,min=0,max=1000000"`
	NormalDeliveryFee  *float64   `json:"normal_delivery_fee"  validate:"omitempty,min=0,max=10000000"`
	ExpressDeliveryFee *float64   `json:"express_delivery_fee" validate:"omitempty,min=0,max=10000000"`
	IsActive           *bool      `json:"is_active"`
	// PrimaryImageMediaAssetID, if set, replaces the product's current
	// primary image: the new asset is attached, the old one (if it was
	// media-pipeline-backed) is quarantined — see service.go's
	// UpdateProduct and the "quarantine workflow" requirement. Omit to
	// leave images unchanged; use POST/DELETE .../images to manage
	// non-primary images individually.
	PrimaryImageMediaAssetID *uuid.UUID `json:"primary_image_media_asset_id"`
}

// AddProductImageRequest accepts exactly one of ImageURL (legacy — a
// directly-provided URL, e.g. from CSV import) or MediaAssetID (Phase 2 —
// a previously-uploaded media_assets row). Service.AddProductImage
// validates that exactly one is set.
type AddProductImageRequest struct {
	ImageURL     string     `json:"image_url"`
	MediaAssetID *uuid.UUID `json:"media_asset_id"`
	IsPrimary    bool       `json:"is_primary"`
	SortOrder    int        `json:"sort_order"`
}

type ProductImageResponse struct {
	ID           uuid.UUID  `json:"id"`
	ImageURL     string     `json:"image_url"`
	MediaAssetID *uuid.UUID `json:"media_asset_id,omitempty"`
	// ThumbnailURL/CardURL/DetailURL are populated only for media-pipeline-
	// backed images (nil for legacy image_url-only rows) — the three fixed
	// variants internal/media generates for every product image.
	ThumbnailURL *string   `json:"thumbnail_url,omitempty"`
	CardURL      *string   `json:"card_url,omitempty"`
	DetailURL    *string   `json:"detail_url,omitempty"`
	Width        *int      `json:"width,omitempty"`
	Height       *int      `json:"height,omitempty"`
	IsPrimary    bool      `json:"is_primary"`
	SortOrder    int       `json:"sort_order"`
	CreatedAt    time.Time `json:"created_at"`
}

type ProductResponse struct {
	ID                 uuid.UUID              `json:"id"`
	SKU                string                 `json:"sku"`
	ArticleNumber      *string                `json:"article_number"`
	Barcode            *string                `json:"barcode"`
	Name               string                 `json:"name"`
	Description        *string                `json:"description"`
	SupplierID         *uuid.UUID             `json:"supplier_id"`
	PurchasePrice      *float64               `json:"purchase_price"`
	SalePrice          *float64               `json:"sale_price"`
	Weight             *float64               `json:"weight"`
	NormalDeliveryFee  *float64               `json:"normal_delivery_fee"`
	ExpressDeliveryFee *float64               `json:"express_delivery_fee"`
	IsActive           bool                   `json:"is_active"`
	Images             []ProductImageResponse `json:"images"`
	CreatedAt          time.Time              `json:"created_at"`
	UpdatedAt          time.Time              `json:"updated_at"`
}

// ToProductImageResponse maps a single ProductImage row — used both by
// ToProductResponse's loop below and directly by handler.go's
// AddProductImage, so the field list only lives in one place.
func ToProductImageResponse(img *ProductImage) ProductImageResponse {
	return ProductImageResponse{
		ID:           img.ID,
		ImageURL:     img.ImageURL,
		MediaAssetID: img.MediaAssetID,
		ThumbnailURL: img.ThumbnailURL,
		CardURL:      img.CardURL,
		DetailURL:    img.DetailURL,
		Width:        img.Width,
		Height:       img.Height,
		IsPrimary:    img.IsPrimary,
		SortOrder:    img.SortOrder,
		CreatedAt:    img.CreatedAt,
	}
}

func ToProductResponse(p *Product) ProductResponse {
	images := make([]ProductImageResponse, 0, len(p.Images))
	for i := range p.Images {
		images = append(images, ToProductImageResponse(&p.Images[i]))
	}
	return ProductResponse{
		ID:                 p.ID,
		SKU:                p.SKU,
		ArticleNumber:      p.ArticleNumber,
		Barcode:            p.Barcode,
		Name:               p.Name,
		Description:        p.Description,
		SupplierID:         p.SupplierID,
		PurchasePrice:      p.PurchasePrice,
		SalePrice:          p.SalePrice,
		Weight:             p.Weight,
		NormalDeliveryFee:  p.NormalDeliveryFee,
		ExpressDeliveryFee: p.ExpressDeliveryFee,
		IsActive:           p.IsActive,
		Images:             images,
		CreatedAt:          p.CreatedAt,
		UpdatedAt:          p.UpdatedAt,
	}
}

// ─── Import ───────────────────────────────────────────────────────────────────

type ImportRowError struct {
	Row   int    `json:"row"`
	Field string `json:"field"`
	Error string `json:"error"`
}

type ImportResult struct {
	Total    int              `json:"total"`
	Imported int              `json:"imported"`
	Skipped  int              `json:"skipped"`
	Errors   []ImportRowError `json:"errors"`
	DryRun   bool             `json:"dry_run"`
}

// ─── Filters ──────────────────────────────────────────────────────────────────

type ListProductsFilter struct {
	Search     string `form:"search"`
	SupplierID string `form:"supplier_id"`
	IsActive   *bool  `form:"is_active"`
}
