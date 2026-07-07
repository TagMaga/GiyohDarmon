package products

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
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

// Service encapsulates product catalog business logic.
type Service struct {
	repo   *Repository
	logger *activity.Logger
}

func NewService(repo *Repository, logger *activity.Logger) *Service {
	return &Service{repo: repo, logger: logger}
}

// ─── Suppliers ────────────────────────────────────────────────────────────────

func (s *Service) ListSuppliers(ctx context.Context, p pagination.Params) ([]Supplier, int, error) {
	return s.repo.ListSuppliers(ctx, p)
}

func (s *Service) GetSupplierByID(ctx context.Context, id uuid.UUID) (*Supplier, error) {
	sup, err := s.repo.GetSupplierByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if sup == nil {
		return nil, apperrors.NotFound("supplier")
	}
	return sup, nil
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
	s.logger.LogAsync(activity.Entry{
		ActorID:    &actorID,
		Action:     "create",
		EntityType: "product",
		EntityID:   &p.ID,
		AfterState: p,
	})
	return p, nil
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

func (s *Service) AddProductImage(ctx context.Context, actorID, productID uuid.UUID, req AddProductImageRequest) (*ProductImage, error) {
	if err := validateImageURL(req.ImageURL); err != nil {
		return nil, err
	}

	p, err := s.repo.GetProductByID(ctx, productID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, apperrors.NotFound("product")
	}

	img := &ProductImage{
		ID:        uuid.New(),
		ProductID: productID,
		ImageURL:  req.ImageURL,
		IsPrimary: req.IsPrimary,
		SortOrder: req.SortOrder,
	}
	if err := s.repo.AddProductImage(ctx, img); err != nil {
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

func (s *Service) DeleteProductImage(ctx context.Context, actorID, productID, imageID uuid.UUID) error {
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
