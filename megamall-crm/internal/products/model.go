package products

import (
	"time"

	"github.com/google/uuid"
)

// Supplier represents a product vendor.
type Supplier struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	Name      string    `gorm:"not null"`
	Phone     *string
	Email     *string
	Address   *string
	Notes     *string
	IsActive  bool      `gorm:"column:is_active;default:true;not null"`
	CreatedAt time.Time `gorm:"autoCreateTime"`
	UpdatedAt time.Time `gorm:"autoUpdateTime"`
}

func (Supplier) TableName() string { return "suppliers" }

// Product is the core catalog entity. Soft-deleted via DeletedAt.
type Product struct {
	ID                 uuid.UUID `gorm:"type:uuid;primaryKey"`
	SKU                string    `gorm:"column:sku;not null"`
	ArticleNumber      *string   `gorm:"column:article_number"`
	Barcode            *string   `gorm:"column:barcode"`
	Name               string    `gorm:"not null"`
	Description        *string
	SupplierID         *uuid.UUID `gorm:"type:uuid;column:supplier_id"`
	PurchasePrice      *float64   `gorm:"type:numeric(12,2);column:purchase_price"`
	SalePrice          *float64   `gorm:"type:numeric(12,2);column:sale_price"`
	Weight             *float64   `gorm:"type:numeric(10,3)"`
	NormalDeliveryFee  *float64   `gorm:"type:numeric(12,2);column:normal_delivery_fee"`
	ExpressDeliveryFee *float64   `gorm:"type:numeric(12,2);column:express_delivery_fee"`
	IsActive           bool       `gorm:"column:is_active;default:true;not null"`
	CreatedAt          time.Time  `gorm:"autoCreateTime"`
	UpdatedAt          time.Time  `gorm:"autoUpdateTime"`
	DeletedAt          *time.Time `gorm:"index"`

	Supplier *Supplier      `gorm:"foreignKey:SupplierID"`
	Images   []ProductImage `gorm:"foreignKey:ProductID;references:ID"`
}

func (Product) TableName() string { return "products" }

// ProductImage holds one image for a product. Two ways a row gets here:
//   - legacy: only ImageURL set (a directly-provided URL — e.g. CSV
//     import), MediaAssetID nil, variant fields nil.
//   - via the centralized media pipeline (Phase 2): MediaAssetID set to a
//     media_assets row (see internal/media), ImageURL populated with that
//     asset's "card" variant public URL (so any existing API consumer
//     reading only ImageURL keeps working unmodified), and
//     Thumbnail/Card/Detail URL + Width/Height denormalized from the
//     asset's variant metadata at attach time — see service.go's
//     buildImageFromAsset. Public variant URLs are stable and content/
//     version-based, so caching them here is safe (never goes stale) and
//     avoids an internal/media lookup on every product read.
type ProductImage struct {
	ID           uuid.UUID  `gorm:"type:uuid;primaryKey"`
	ProductID    uuid.UUID  `gorm:"type:uuid;not null;column:product_id"`
	ImageURL     string     `gorm:"column:image_url;not null"`
	MediaAssetID *uuid.UUID `gorm:"type:uuid;column:media_asset_id"`
	ThumbnailURL *string    `gorm:"column:thumbnail_url"`
	CardURL      *string    `gorm:"column:card_url"`
	DetailURL    *string    `gorm:"column:detail_url"`
	Width        *int       `gorm:"column:width"`
	Height       *int       `gorm:"column:height"`
	IsPrimary    bool       `gorm:"column:is_primary;default:false;not null"`
	SortOrder    int        `gorm:"column:sort_order;default:0;not null"`
	CreatedAt    time.Time  `gorm:"autoCreateTime"`
}

func (ProductImage) TableName() string { return "product_images" }
