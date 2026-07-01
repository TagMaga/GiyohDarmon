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
	ID            uuid.UUID  `gorm:"type:uuid;primaryKey"`
	SKU           string     `gorm:"column:sku;not null"`
	ArticleNumber *string    `gorm:"column:article_number"`
	Barcode       *string    `gorm:"column:barcode"`
	Name          string     `gorm:"not null"`
	Description   *string
	SupplierID    *uuid.UUID `gorm:"type:uuid;column:supplier_id"`
	PurchasePrice      *float64 `gorm:"type:numeric(12,2);column:purchase_price"`
	SalePrice          *float64 `gorm:"type:numeric(12,2);column:sale_price"`
	Weight             *float64 `gorm:"type:numeric(10,3)"`
	NormalDeliveryFee  *float64 `gorm:"type:numeric(12,2);column:normal_delivery_fee"`
	ExpressDeliveryFee *float64 `gorm:"type:numeric(12,2);column:express_delivery_fee"`
	IsActive           bool     `gorm:"column:is_active;default:true;not null"`
	CreatedAt     time.Time  `gorm:"autoCreateTime"`
	UpdatedAt     time.Time  `gorm:"autoUpdateTime"`
	DeletedAt     *time.Time `gorm:"index"`

	Supplier *Supplier      `gorm:"foreignKey:SupplierID"`
	Images   []ProductImage `gorm:"foreignKey:ProductID;references:ID"`
}

func (Product) TableName() string { return "products" }

// ProductImage holds one image URL for a product.
type ProductImage struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	ProductID uuid.UUID `gorm:"type:uuid;not null;column:product_id"`
	ImageURL  string    `gorm:"column:image_url;not null"`
	IsPrimary bool      `gorm:"column:is_primary;default:false;not null"`
	SortOrder int       `gorm:"column:sort_order;default:0;not null"`
	CreatedAt time.Time `gorm:"autoCreateTime"`
}

func (ProductImage) TableName() string { return "product_images" }
