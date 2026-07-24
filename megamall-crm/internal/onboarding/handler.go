package onboarding

import (
	"fmt"
	"mime/multipart"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/response"
	"github.com/megamall/crm/pkg/validator"
)

// Handler wires HTTP routes to the onboarding service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// maxDocuments caps how many files one submission may attach; each file is
// separately capped by internal/media's own configured per-category limit
// (MaxDocumentBytes, 20 MiB by default) — maxRequestBytes below is just an
// outer backstop against an oversized request body before any of that runs,
// generous enough for maxDocuments legitimate near-limit files.
const maxDocuments = 5
const maxRequestBytes = int64(maxDocuments)*21<<20 + 1<<20

// Create handles POST /public/worker-applications — public, unauthenticated.
// multipart/form-data, not JSON, since applicants may attach documents.
func (h *Handler) Create(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxRequestBytes)

	if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
		response.Error(c, apperrors.BadRequest("invalid form submission"))
		return
	}

	req := CreateApplicationRequest{
		Phone:    c.PostForm("phone"),
		Password: c.PostForm("password"),
		FullName: c.PostForm("full_name"),
	}
	if v := c.PostForm("email"); v != "" {
		req.Email = &v
	}
	if v := c.PostForm("surname"); v != "" {
		req.Surname = &v
	}
	if v := c.PostForm("desired_position"); v != "" {
		req.DesiredPosition = &v
	}
	if v := c.PostForm("address"); v != "" {
		req.Address = &v
	}
	if v := c.PostForm("date_of_birth"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			response.Error(c, apperrors.BadRequest("date_of_birth must be a valid date"))
			return
		}
		req.DateOfBirth = &t
	}

	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	var files []*multipart.FileHeader
	var docTypes []string
	if c.Request.MultipartForm != nil {
		files = c.Request.MultipartForm.File["documents"]
		docTypes = c.Request.MultipartForm.Value["document_types"]
	}
	if len(files) > maxDocuments {
		response.Error(c, apperrors.BadRequest(fmt.Sprintf("at most %d documents may be attached", maxDocuments)))
		return
	}

	docs := make([]PendingDocument, 0, len(files))
	for i, fh := range files {
		f, err := fh.Open()
		if err != nil {
			response.Error(c, apperrors.BadRequest("failed to read an uploaded file"))
			return
		}
		defer f.Close()

		docType := "other"
		if i < len(docTypes) {
			docType = docTypes[i]
		}
		docs = append(docs, PendingDocument{
			DocumentType:     docType,
			OriginalFilename: fh.Filename,
			DeclaredSize:     fh.Size,
			Reader:           f,
		})
	}

	a, err := h.svc.Create(c.Request.Context(), req, docs)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.Created(c, ToSubmitResponse(a))
}

// List handles GET /worker-applications — owner-only.
func (h *Handler) List(c *gin.Context) {
	status := Status(c.Query("status"))
	list, err := h.svc.List(c.Request.Context(), status)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, ToApplicationResponseList(list))
}

// GetByID handles GET /worker-applications/:id — owner-only. Includes
// attached documents with freshly-minted signed URLs (see Service.GetDetail).
func (h *Handler) GetByID(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	a, docs, err := h.svc.GetDetail(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	resp := ToApplicationResponse(a)
	resp.Documents = docs
	response.OK(c, resp)
}

// Approve handles POST /worker-applications/:id/approve — owner-only.
func (h *Handler) Approve(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	var req ApproveApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	if appErr := validator.Validate(req); appErr != nil {
		response.Error(c, appErr)
		return
	}

	claims := middleware.ClaimsFromContext(c)
	u, err := h.svc.Approve(c.Request.Context(), id, claims.UserID, req.Role)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	response.OK(c, gin.H{"user_id": u.ID})
}

// Reject handles POST /worker-applications/:id/reject — owner-only. Deletes
// the application outright (see Service.Reject).
func (h *Handler) Reject(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.Reject(c.Request.Context(), id); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

// parseUUID parses a UUID path param and writes a 400 if invalid.
func parseUUID(c *gin.Context, param string) (uuid.UUID, bool) {
	raw := c.Param(param)
	id, err := uuid.Parse(raw)
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid UUID: "+param))
		return uuid.Nil, false
	}
	return id, true
}
