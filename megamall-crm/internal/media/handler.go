package media

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/response"
)

// Handler wires HTTP routes to the media service. Two families of routes:
// authenticated management (upload/delete/mint-signed-url, mounted under
// /api/v1/media) and unauthenticated delivery (/media/public/*,
// /media/private/*, mounted at the router root like the legacy /uploads
// route) — delivery is unauthenticated by design for the public path, and
// authenticated-by-signature (not by session) for the private path, since
// it must also work for e.g. an <img> tag src with no custom headers.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// ─── Management endpoints (authenticated) ──────────────────────────────────

func (h *Handler) Upload(c *gin.Context) {
	claims := middleware.ClaimsFromContext(c)

	category := Category(c.PostForm("category"))
	if !category.Valid() {
		response.Error(c, apperrors.BadRequest("category is required and must be one of the recognized values"))
		return
	}

	var ownerID *uuid.UUID
	if v := c.PostForm("owner_entity_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			response.Error(c, apperrors.BadRequest("owner_entity_id must be a valid UUID"))
			return
		}
		ownerID = &id
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.svc.cfg.MaxUploadBytes+64<<10)
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Error(c, apperrors.BadRequest("file is required"))
		return
	}
	defer file.Close()

	asset, appErr := h.svc.Create(c.Request.Context(), CreateParams{
		Category:         category,
		OwnerEntityType:  c.PostForm("owner_entity_type"),
		OwnerEntityID:    ownerID,
		UploadedByUserID: claims.UserID,
		OriginalFilename: header.Filename,
		DeclaredSize:     header.Size,
	}, file)
	if appErr != nil {
		response.Error(c, appErr)
		return
	}

	response.Created(c, h.toAssetResponse(asset))
}

func (h *Handler) Get(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)

	asset, err := h.svc.GetByID(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	if asset == nil {
		response.Error(c, apperrors.NotFound("media asset"))
		return
	}
	if err := h.svc.AuthorizeView(claims.UserID, claims.Role, asset); err != nil {
		// A caller who is not authorized gets the same 404 as a truly
		// missing asset — never a distinguishing 403 — so probing IDs
		// can't be used to enumerate which ones exist. See signing.go's
		// VerifySignedURL doc comment for the same reasoning applied here.
		response.Error(c, apperrors.NotFound("media asset"))
		return
	}

	response.OK(c, h.toAssetResponse(asset))
}

func (h *Handler) Delete(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)

	asset, err := h.svc.GetByID(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	if asset == nil {
		response.Error(c, apperrors.NotFound("media asset"))
		return
	}
	if err := h.svc.Authorize(claims.UserID, claims.Role, asset); err != nil {
		response.Error(c, apperrors.NotFound("media asset"))
		return
	}

	if err := h.svc.Delete(c.Request.Context(), asset); err != nil {
		response.HandleError(c, err)
		return
	}
	response.NoContent(c)
}

func (h *Handler) MintSignedURL(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(c)

	asset, err := h.svc.GetByID(c.Request.Context(), id)
	if err != nil {
		response.HandleError(c, err)
		return
	}
	if asset == nil {
		response.Error(c, apperrors.NotFound("media asset"))
		return
	}
	if err := h.svc.AuthorizeView(claims.UserID, claims.Role, asset); err != nil {
		response.Error(c, apperrors.NotFound("media asset"))
		return
	}
	if asset.Visibility == VisibilityPublic {
		response.Error(c, apperrors.BadRequest("asset is public; use its stable URL directly"))
		return
	}

	variant := c.Query("variant")
	signed, serr := h.svc.SignedURL(asset, variant)
	if serr != nil {
		response.Error(c, apperrors.BadRequest(serr.Error()))
		return
	}
	response.OK(c, signed)
}

func (h *Handler) toAssetResponse(a *Asset) AssetResponse {
	out := AssetResponse{
		ID:                a.ID,
		Category:          a.Category,
		Visibility:        a.Visibility,
		ProcessingStatus:  a.ProcessingStatus,
		OriginalSizeBytes: a.OriginalSizeBytes,
		CreatedAt:         a.CreatedAt,
	}
	if a.Width != nil {
		out.Width = *a.Width
	}
	if a.Height != nil {
		out.Height = *a.Height
	}

	// The original itself is always included as a pseudo-variant named
	// "original" so the frontend has one uniform list to render from.
	out.Variants = append(out.Variants, h.variantResponse(a, "original", a.StorageKey, out.Width, out.Height, 0))

	if len(a.VariantMetadataJSON) > 0 {
		var variants map[string]Variant
		if err := json.Unmarshal(a.VariantMetadataJSON, &variants); err == nil {
			for name, v := range variants {
				out.Variants = append(out.Variants, h.variantResponse(a, name, v.StorageKey, v.Width, v.Height, v.Bytes))
			}
		}
	}
	return out
}

func (h *Handler) variantResponse(a *Asset, name, key string, w, ht, bytes int) VariantResponse {
	vr := VariantResponse{Variant: name, Width: w, Height: ht, Bytes: bytes}
	if a.Visibility == VisibilityPublic {
		vr.URL = h.svc.PublicURL(key)
	} else if signed, err := h.svc.SignedURL(a, name); err == nil {
		vr.URL = signed.URL
	}
	return vr
}

// ─── Delivery endpoints (unauthenticated at the HTTP layer) ───────────────

// PublicDelivery serves a file from the public namespace with no signature
// required and immutable caching — safe because dirPublic only ever holds
// assets whose visibility was fixed to public at Create time (see
// Service.visibilityDir), never toggled later.
func (h *Handler) PublicDelivery(c *gin.Context) {
	key := c.Param("key")
	if !SafeStorageKey(key) {
		c.Status(http.StatusNotFound)
		return
	}
	h.serveFile(c, h.svc.visibilityDir(VisibilityPublic), key, true)
}

// PrivateDelivery serves a file from the private namespace only if the
// request carries a valid, unexpired HMAC signature for that exact key —
// see signing.go. Any failure (bad signature, expired, malformed, missing
// file) returns the same generic 404, never a distinguishing error, so a
// prober can't use the response to confirm a key's existence.
func (h *Handler) PrivateDelivery(c *gin.Context) {
	key := c.Param("key")
	if !SafeStorageKey(key) {
		c.Status(http.StatusNotFound)
		return
	}

	sig := c.Query("sig")
	variant := c.Query("v")
	expiry, err := strconv.ParseInt(c.Query("exp"), 10, 64)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}

	ok := VerifySignedURL(h.svc.cfg.SigningSecret, SignedURLParams{Key: key, Variant: variant, Expiry: expiry, Sig: sig})
	if !ok {
		c.Status(http.StatusNotFound)
		return
	}

	h.serveFile(c, h.svc.visibilityDir(VisibilityPrivate), key, false)
}

func (h *Handler) serveFile(c *gin.Context, dir, key string, cacheable bool) {
	f, err := os.Open(filepath.Join(dir, key))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.Status(http.StatusNotFound)
			return
		}
		c.Status(http.StatusInternalServerError)
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil || info.IsDir() {
		c.Status(http.StatusNotFound)
		return
	}

	c.Header("X-Content-Type-Options", "nosniff")
	if cacheable {
		// Content/version-based filenames (VariantStorageKey) make this
		// safe: the same key never refers to different bytes over time.
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		// Never cache a private response — a shared/browser cache could
		// leak it to a later, unauthorized visitor of the same URL.
		c.Header("Cache-Control", "private, no-store")
	}
	http.ServeContent(c.Writer, c.Request, key, info.ModTime(), f)
}

func parseUUID(c *gin.Context, param string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(param))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid "+param))
		return uuid.UUID{}, false
	}
	return id, true
}
