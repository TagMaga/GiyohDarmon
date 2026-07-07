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
	SKU           string     `json:"sku"                  validate:"required,max=100"`
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
}

type AddProductImageRequest struct {
	ImageURL  string `json:"image_url"  validate:"required,url"`
	IsPrimary bool   `json:"is_primary"`
	SortOrder int    `json:"sort_order"`
}

type ProductImageResponse struct {
	ID        uuid.UUID `json:"id"`
	ImageURL  string    `json:"image_url"`
	IsPrimary bool      `json:"is_primary"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
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

func ToProductResponse(p *Product) ProductResponse {
	images := make([]ProductImageResponse, 0, len(p.Images))
	for _, img := range p.Images {
		images = append(images, ProductImageResponse{
			ID:        img.ID,
			ImageURL:  img.ImageURL,
			IsPrimary: img.IsPrimary,
			SortOrder: img.SortOrder,
			CreatedAt: img.CreatedAt,
		})
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
