package products

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

// Handler wires HTTP routes to the products service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// ─── Suppliers ────────────────────────────────────────────────────────────────

func (h *Handler) ListSuppliers(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	sups, total, err := h.svc.ListSuppliers(c.Request.Context(), p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]SupplierResponse, 0, len(sups))
	for i := range sups {
		out = append(out, ToSupplierResponse(&sups[i]))
	}
	response.OKWithMeta(c, out, pagination.BuildMeta(p, total))
}

func (h *Handler) CreateSupplier(c *gin.Context) {
	var req CreateSupplierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	sup, err := h.svc.CreateSupplier(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToSupplierResponse(sup))
}

func (h *Handler) UpdateSupplier(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req UpdateSupplierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	sup, err := h.svc.UpdateSupplier(c.Request.Context(), claims.UserID, id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToSupplierResponse(sup))
}

func (h *Handler) DeleteSupplier(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if err := h.svc.DeleteSupplier(c.Request.Context(), claims.UserID, id); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

// ─── Products ─────────────────────────────────────────────────────────────────

func (h *Handler) ListProducts(c *gin.Context) {
	p := pagination.ParseFromQuery(c)
	var f ListProductsFilter
	if err := c.ShouldBindQuery(&f); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	prods, total, err := h.svc.ListProducts(c.Request.Context(), f, p)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	out := make([]ProductResponse, 0, len(prods))
	for i := range prods {
		out = append(out, ToProductResponse(&prods[i]))
	}
	response.OKWithMeta(c, out, pagination.BuildMeta(p, total))
}

func (h *Handler) GetProduct(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	p, err := h.svc.GetProductByID(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToProductResponse(p))
}

func (h *Handler) CreateProduct(c *gin.Context) {
	var req CreateProductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	p, err := h.svc.CreateProduct(c.Request.Context(), claims.UserID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToProductResponse(p))
}

func (h *Handler) UpdateProduct(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req UpdateProductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	p, err := h.svc.UpdateProduct(c.Request.Context(), claims.UserID, id, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToProductResponse(p))
}

func (h *Handler) DeleteProduct(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if err := h.svc.DeleteProduct(c.Request.Context(), claims.UserID, id); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

// ─── Product Images ───────────────────────────────────────────────────────────

func (h *Handler) AddProductImage(c *gin.Context) {
	productID, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req AddProductImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}
	claims := middleware.ClaimsFromContext(c)
	img, err := h.svc.AddProductImage(c.Request.Context(), claims.UserID, productID, req)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToProductImageResponse(img))
}

func (h *Handler) DeleteProductImage(c *gin.Context) {
	productID, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	imageID, ok := parseUUID(c, "image_id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if err := h.svc.DeleteProductImage(c.Request.Context(), claims.UserID, productID, imageID); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

// ─── Import ───────────────────────────────────────────────────────────────────

func (h *Handler) ImportProducts(c *gin.Context) {
	dryRun := c.Query("dry_run") == "true"

	file, _, err := c.Request.FormFile("file")
	if err != nil {
		response.Error(c, apperrors.BadRequest("multipart field 'file' is required"))
		return
	}
	defer file.Close()

	result, err := h.svc.ImportProducts(c.Request.Context(), file, dryRun)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, result)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func parseUUID(c *gin.Context, param string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(param))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid "+param+": must be a UUID"))
		c.Abort()
		return uuid.Nil, false
	}
	return id, true
}
