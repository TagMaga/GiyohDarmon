package products

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// Repository handles all product-catalog persistence.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// ─── Supplier ─────────────────────────────────────────────────────────────────

func (r *Repository) ListSuppliers(ctx context.Context, p pagination.Params) ([]Supplier, int, error) {
	var rows []Supplier
	var total int64

	q := r.db.WithContext(ctx).Model(&Supplier{})
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count suppliers: %w", err)
	}
	if err := q.Order("name ASC").Limit(p.Limit).Offset(p.Offset()).Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list suppliers: %w", err)
	}
	return rows, int(total), nil
}

func (r *Repository) GetSupplierByID(ctx context.Context, id uuid.UUID) (*Supplier, error) {
	var s Supplier
	err := r.db.WithContext(ctx).First(&s, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get supplier: %w", err)
	}
	return &s, nil
}

func (r *Repository) CreateSupplier(ctx context.Context, s *Supplier) error {
	if err := r.db.WithContext(ctx).Create(s).Error; err != nil {
		return fmt.Errorf("create supplier: %w", err)
	}
	return nil
}

func (r *Repository) UpdateSupplier(ctx context.Context, s *Supplier) error {
	if err := r.db.WithContext(ctx).Save(s).Error; err != nil {
		return fmt.Errorf("update supplier: %w", err)
	}
	return nil
}

func (r *Repository) DeleteSupplier(ctx context.Context, id uuid.UUID) error {
	if err := r.db.WithContext(ctx).Delete(&Supplier{}, "id = ?", id).Error; err != nil {
		return fmt.Errorf("delete supplier: %w", err)
	}
	return nil
}

// ─── Product ──────────────────────────────────────────────────────────────────

func (r *Repository) ListProducts(ctx context.Context, f ListProductsFilter, p pagination.Params) ([]Product, int, error) {
	var rows []Product
	var total int64

	q := r.db.WithContext(ctx).Model(&Product{}).Where("deleted_at IS NULL")

	if f.Search != "" {
		like := "%" + f.Search + "%"
		q = q.Where("name ILIKE ? OR sku ILIKE ?", like, like)
	}
	if f.SupplierID != "" {
		q = q.Where("supplier_id = ?", f.SupplierID)
	}
	if f.IsActive != nil {
		q = q.Where("is_active = ?", *f.IsActive)
	}

	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count products: %w", err)
	}
	if err := q.Preload("Images").Order("created_at DESC").Limit(p.Limit).Offset(p.Offset()).Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list products: %w", err)
	}
	return rows, int(total), nil
}

func (r *Repository) GetProductByID(ctx context.Context, id uuid.UUID) (*Product, error) {
	var p Product
	err := r.db.WithContext(ctx).
		Preload("Images").
		First(&p, "id = ? AND deleted_at IS NULL", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get product: %w", err)
	}
	return &p, nil
}

// CountAllProducts returns the total number of products ever created,
// including soft-deleted ones, so generated SKU numbers never get reused.
func (r *Repository) CountAllProducts(ctx context.Context) (int64, error) {
	var total int64
	if err := r.db.WithContext(ctx).Model(&Product{}).Count(&total).Error; err != nil {
		return 0, fmt.Errorf("count all products: %w", err)
	}
	return total, nil
}

func (r *Repository) GetProductBySKU(ctx context.Context, sku string) (*Product, error) {
	var p Product
	err := r.db.WithContext(ctx).
		First(&p, "sku = ? AND deleted_at IS NULL", sku).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get product by sku: %w", err)
	}
	return &p, nil
}

func (r *Repository) GetProductByBarcode(ctx context.Context, barcode string) (*Product, error) {
	var p Product
	err := r.db.WithContext(ctx).
		First(&p, "barcode = ? AND deleted_at IS NULL", barcode).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get product by barcode: %w", err)
	}
	return &p, nil
}

func (r *Repository) CreateProduct(ctx context.Context, p *Product) error {
	if err := r.db.WithContext(ctx).Create(p).Error; err != nil {
		return fmt.Errorf("create product: %w", err)
	}
	return nil
}

func (r *Repository) UpdateProduct(ctx context.Context, p *Product) error {
	if err := r.db.WithContext(ctx).Save(p).Error; err != nil {
		return fmt.Errorf("update product: %w", err)
	}
	return nil
}

// SoftDelete sets deleted_at to now.
func (r *Repository) SoftDeleteProduct(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Model(&Product{}).
		Where("id = ? AND deleted_at IS NULL", id).
		UpdateColumn("deleted_at", gorm.Expr("NOW()"))
	if result.Error != nil {
		return fmt.Errorf("soft delete product: %w", result.Error)
	}
	return nil
}

// ─── Product Images ───────────────────────────────────────────────────────────

func (r *Repository) AddProductImage(ctx context.Context, img *ProductImage) error {
	if err := r.db.WithContext(ctx).Create(img).Error; err != nil {
		return fmt.Errorf("add product image: %w", err)
	}
	return nil
}

func (r *Repository) DeleteProductImage(ctx context.Context, imageID, productID uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Delete(&ProductImage{}, "id = ? AND product_id = ?", imageID, productID)
	if result.Error != nil {
		return fmt.Errorf("delete product image: %w", result.Error)
	}
	return nil
}

// ─── Import ───────────────────────────────────────────────────────────────────

// ImportRow is a parsed CSV row used internally during import.
type csvRow struct {
	lineNum       int
	sku           string
	articleNumber string
	barcode       string
	name          string
	description   string
	purchasePrice string
	salePrice     string
	weight        string
}

// ImportProducts parses a CSV reader and bulk-upserts products.
// Returns an ImportResult summarising success and row-level errors.
// If dryRun is true, nothing is written to the database.
func (r *Repository) ImportProducts(ctx context.Context, lines [][]string, dryRun bool) ImportResult {
	result := ImportResult{
		DryRun: dryRun,
		Errors: []ImportRowError{},
	}

	// Skip header row if present.
	start := 0
	if len(lines) > 0 && strings.EqualFold(strings.TrimSpace(lines[0][0]), "sku") {
		start = 1
	}

	for i := start; i < len(lines); i++ {
		rowNum := i + 1
		cols := lines[i]
		result.Total++

		// Pad to at least 9 columns.
		for len(cols) < 9 {
			cols = append(cols, "")
		}

		row := csvRow{
			lineNum:       rowNum,
			sku:           strings.TrimSpace(cols[0]),
			articleNumber: strings.TrimSpace(cols[1]),
			barcode:       strings.TrimSpace(cols[2]),
			name:          strings.TrimSpace(cols[3]),
			description:   strings.TrimSpace(cols[4]),
			purchasePrice: strings.TrimSpace(cols[5]),
			salePrice:     strings.TrimSpace(cols[6]),
			weight:        strings.TrimSpace(cols[7]),
		}

		rowErrors := validateImportRow(row)
		if len(rowErrors) > 0 {
			result.Errors = append(result.Errors, rowErrors...)
			result.Skipped++
			continue
		}

		if dryRun {
			result.Imported++
			continue
		}

		// Build product model.
		p := &Product{
			ID:       uuid.New(),
			SKU:      row.sku,
			Name:     row.name,
			IsActive: true,
		}
		if row.articleNumber != "" {
			p.ArticleNumber = &row.articleNumber
		}
		if row.barcode != "" {
			p.Barcode = &row.barcode
		}
		if row.description != "" {
			p.Description = &row.description
		}
		if v, err := strconv.ParseFloat(row.purchasePrice, 64); err == nil && row.purchasePrice != "" {
			p.PurchasePrice = &v
		}
		if v, err := strconv.ParseFloat(row.salePrice, 64); err == nil && row.salePrice != "" {
			p.SalePrice = &v
		}
		if v, err := strconv.ParseFloat(row.weight, 64); err == nil && row.weight != "" {
			p.Weight = &v
		}

		// Upsert by SKU: update if exists, insert if new.
		existing, err := r.GetProductBySKU(ctx, row.sku)
		if err != nil {
			result.Errors = append(result.Errors, ImportRowError{Row: rowNum, Field: "sku", Error: "database error"})
			result.Skipped++
			continue
		}

		if existing != nil {
			p.ID = existing.ID
			p.CreatedAt = existing.CreatedAt
			if err := r.UpdateProduct(ctx, p); err != nil {
				result.Errors = append(result.Errors, ImportRowError{Row: rowNum, Field: "sku", Error: "update failed"})
				result.Skipped++
				continue
			}
		} else {
			if err := r.CreateProduct(ctx, p); err != nil {
				result.Errors = append(result.Errors, ImportRowError{Row: rowNum, Field: "sku", Error: "insert failed"})
				result.Skipped++
				continue
			}
		}
		result.Imported++
	}

	return result
}

func validateImportRow(row csvRow) []ImportRowError {
	var errs []ImportRowError
	if row.sku == "" {
		errs = append(errs, ImportRowError{Row: row.lineNum, Field: "sku", Error: "sku is required"})
	}
	if row.name == "" {
		errs = append(errs, ImportRowError{Row: row.lineNum, Field: "name", Error: "name is required"})
	}
	if row.purchasePrice != "" {
		if v, err := strconv.ParseFloat(row.purchasePrice, 64); err != nil || v < 0 {
			errs = append(errs, ImportRowError{Row: row.lineNum, Field: "purchase_price", Error: "must be a non-negative number"})
		}
	}
	if row.salePrice != "" {
		if v, err := strconv.ParseFloat(row.salePrice, 64); err != nil || v < 0 {
			errs = append(errs, ImportRowError{Row: row.lineNum, Field: "sale_price", Error: "must be a non-negative number"})
		}
	}
	if row.weight != "" {
		if v, err := strconv.ParseFloat(row.weight, 64); err != nil || v < 0 {
			errs = append(errs, ImportRowError{Row: row.lineNum, Field: "weight", Error: "must be a non-negative number"})
		}
	}
	return errs
}
