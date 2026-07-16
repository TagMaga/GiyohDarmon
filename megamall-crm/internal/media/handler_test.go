package media

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"gorm.io/gorm"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// buildMediaTestRouter wires the media handler's routes with a fake
// validator: the Bearer token is "<userID>|<role>", so tests can control
// both identity and role independently — needed for cross-user IDOR tests,
// which plain role-only fakes (used elsewhere in this codebase) can't
// express. The returned *gorm.DB is the exact transaction the service was
// built on — tests MUST create fixtures (testutil.CreateUser) on this same
// handle, never a second testutil.NewTestDB(t) call, since a second call
// opens an independent, mutually-invisible Postgres transaction (uncommitted
// rows in one tx are not visible to another) and would cause FK violations.
func buildMediaTestRouter(t *testing.T) (*gin.Engine, *Handler, *gorm.DB) {
	t.Helper()
	db := testutil.NewTestDB(t)
	svc := NewService(NewRepository(db), testServiceCfg(t))
	h := NewHandler(svc)

	middleware.SetTokenValidator(func(_ context.Context, token string) (*middleware.ContextClaims, error) {
		parts := strings.SplitN(token, "|", 2)
		if token == "" || len(parts) != 2 {
			return nil, apperrors.Unauthorized("bad test token")
		}
		id, err := uuid.Parse(parts[0])
		if err != nil {
			return nil, apperrors.Unauthorized("bad test token id")
		}
		return &middleware.ContextClaims{UserID: id, Role: parts[1]}, nil
	})

	r := gin.New()
	h.RegisterManagementRoutes(r.Group("/api/v1/media"), middleware.NewMemoryStore())
	RegisterDeliveryRoutes(r, h)
	return r, h, db
}

func tokenFor(id uuid.UUID, role string) string {
	return id.String() + "|" + role
}

func uploadAs(t *testing.T, r *gin.Engine, token string, category Category, filename string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if category != "" {
		_ = w.WriteField("category", string(category))
	}
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	_ = w.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/media", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func decodeAsset(t *testing.T, rec *httptest.ResponseRecorder) AssetResponse {
	t.Helper()
	var out struct {
		Data AssetResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode asset: %v (body: %s)", err, rec.Body.String())
	}
	return out.Data
}

func TestHandler_Upload_RequiresAuth(t *testing.T) {
	r, _, _ := buildMediaTestRouter(t)
	rec := uploadAs(t, r, "", CategoryProductImage, "x.png", fixture(t, "transparent.png"))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestHandler_Upload_RequiresCategory(t *testing.T) {
	r, _, db := buildMediaTestRouter(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)
	rec := uploadAs(t, r, tokenFor(u.ID, "seller"), "", "x.png", fixture(t, "transparent.png"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for missing category", rec.Code)
	}
}

func TestHandler_UploadThenGet_Success(t *testing.T) {
	r, _, db := buildMediaTestRouter(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)

	rec := uploadAs(t, r, tokenFor(u.ID, "seller"), CategoryProductImage, "x.png", fixture(t, "transparent.png"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, body=%s", rec.Code, rec.Body.String())
	}
	asset := decodeAsset(t, rec)
	if asset.Visibility != VisibilityPublic {
		t.Errorf("visibility = %v, want public", asset.Visibility)
	}
	if len(asset.Variants) == 0 {
		t.Fatal("expected variants in the upload response")
	}
	for _, v := range asset.Variants {
		if v.URL == "" {
			t.Errorf("variant %q missing URL", v.Variant)
		}
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/media/"+asset.ID.String(), nil)
	getReq.Header.Set("Authorization", "Bearer "+tokenFor(u.ID, "seller"))
	getRec := httptest.NewRecorder()
	r.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("get status = %d, body=%s", getRec.Code, getRec.Body.String())
	}
}

func TestHandler_CrossUserIDOR_GetReturns404NotForbidden(t *testing.T) {
	r, _, db := buildMediaTestRouter(t)
	owner := testutil.CreateUser(t, db, users.RoleSeller)
	attacker := testutil.CreateUser(t, db, users.RoleSeller)

	rec := uploadAs(t, r, tokenFor(owner.ID, "seller"), CategoryPrepaymentProof, "p.png", fixture(t, "transparent.png"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, body=%s", rec.Code, rec.Body.String())
	}
	asset := decodeAsset(t, rec)

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/media/"+asset.ID.String(), nil)
	getReq.Header.Set("Authorization", "Bearer "+tokenFor(attacker.ID, "seller"))
	getRec := httptest.NewRecorder()
	r.ServeHTTP(getRec, getReq)

	// Must be 404, never a distinguishing 403 — see handler.go's doc
	// comment on Get/Delete/MintSignedURL: a differentiating status code
	// would let an attacker enumerate which asset IDs exist.
	if getRec.Code != http.StatusNotFound {
		t.Fatalf("cross-user GET status = %d, want 404 (generic, non-distinguishing)", getRec.Code)
	}
}

func TestHandler_CrossUserIDOR_DeleteReturns404(t *testing.T) {
	r, _, db := buildMediaTestRouter(t)
	owner := testutil.CreateUser(t, db, users.RoleSeller)
	attacker := testutil.CreateUser(t, db, users.RoleSeller)

	rec := uploadAs(t, r, tokenFor(owner.ID, "seller"), CategoryPrepaymentProof, "p.png", fixture(t, "transparent.png"))
	asset := decodeAsset(t, rec)

	delReq := httptest.NewRequest(http.MethodDelete, "/api/v1/media/"+asset.ID.String(), nil)
	delReq.Header.Set("Authorization", "Bearer "+tokenFor(attacker.ID, "seller"))
	delRec := httptest.NewRecorder()
	r.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusNotFound {
		t.Fatalf("cross-user DELETE status = %d, want 404", delRec.Code)
	}
}

func TestHandler_OwnerRoleCanAccessAnyAsset(t *testing.T) {
	r, _, db := buildMediaTestRouter(t)
	uploader := testutil.CreateUser(t, db, users.RoleSeller)
	owner := testutil.CreateUser(t, db, users.RoleOwner)

	rec := uploadAs(t, r, tokenFor(uploader.ID, "seller"), CategoryPrepaymentProof, "p.png", fixture(t, "transparent.png"))
	asset := decodeAsset(t, rec)

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/media/"+asset.ID.String(), nil)
	getReq.Header.Set("Authorization", "Bearer "+tokenFor(owner.ID, "owner"))
	getRec := httptest.NewRecorder()
	r.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("owner-role GET status = %d, want 200", getRec.Code)
	}
}

func TestHandler_PublicDelivery_ImmutableCacheHeader(t *testing.T) {
	r, _, db := buildMediaTestRouter(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)

	rec := uploadAs(t, r, tokenFor(u.ID, "seller"), CategoryProductImage, "x.png", fixture(t, "transparent.png"))
	asset := decodeAsset(t, rec)
	var originalURL string
	for _, v := range asset.Variants {
		if v.Variant == "original" {
			originalURL = v.URL
		}
	}
	if originalURL == "" {
		t.Fatal("no original variant URL in response")
	}

	getReq := httptest.NewRequest(http.MethodGet, originalURL, nil)
	getRec := httptest.NewRecorder()
	r.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("public delivery status = %d, body=%s", getRec.Code, getRec.Body.String())
	}
	cc := getRec.Header().Get("Cache-Control")
	if !strings.Contains(cc, "immutable") {
		t.Errorf("Cache-Control = %q, want immutable", cc)
	}
}

func TestHandler_PublicDelivery_PathTraversalRejected(t *testing.T) {
	r, _, _ := buildMediaTestRouter(t)
	paths := []string{
		"/media/public/..%2f..%2f..%2fetc%2fpasswd",
		"/media/public/....//....//etc/passwd",
	}
	for _, p := range paths {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("path %q status = %d, want 404", p, rec.Code)
		}
	}
}

func TestHandler_PrivateDelivery_RequiresValidSignature(t *testing.T) {
	r, _, db := buildMediaTestRouter(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)

	rec := uploadAs(t, r, tokenFor(u.ID, "seller"), CategoryPrepaymentProof, "p.png", fixture(t, "transparent.png"))
	asset := decodeAsset(t, rec)
	var privateURL string
	for _, v := range asset.Variants {
		if v.Variant == "original" {
			privateURL = v.URL
		}
	}
	if privateURL == "" || !strings.HasPrefix(privateURL, "/media/private/") {
		t.Fatalf("expected a /media/private/ URL, got %q", privateURL)
	}

	// 1. Valid signature (as minted) → 200, no-store.
	okReq := httptest.NewRequest(http.MethodGet, privateURL, nil)
	okRec := httptest.NewRecorder()
	r.ServeHTTP(okRec, okReq)
	if okRec.Code != http.StatusOK {
		t.Fatalf("valid signature status = %d, body=%s", okRec.Code, okRec.Body.String())
	}
	if cc := okRec.Header().Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("private Cache-Control = %q, want no-store", cc)
	}

	// 2. Missing signature entirely → 404.
	key := privateURL[strings.LastIndex(privateURL, "/")+1:]
	if i := strings.Index(key, "?"); i >= 0 {
		key = key[:i]
	}
	noSigReq := httptest.NewRequest(http.MethodGet, "/media/private/"+key, nil)
	noSigRec := httptest.NewRecorder()
	r.ServeHTTP(noSigRec, noSigReq)
	if noSigRec.Code != http.StatusNotFound {
		t.Errorf("no-signature status = %d, want 404", noSigRec.Code)
	}

	// 3. Tampered signature → 404.
	tampered := strings.Replace(privateURL, "sig=", "sig=deadbeef", 1)
	badReq := httptest.NewRequest(http.MethodGet, tampered, nil)
	badRec := httptest.NewRecorder()
	r.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusNotFound {
		t.Errorf("tampered-signature status = %d, want 404", badRec.Code)
	}

	// 4. Expired signature → 404.
	expiredQuery := NewSignedURLQuery(testSecret, key, "original", -time.Minute)
	expiredReq := httptest.NewRequest(http.MethodGet, "/media/private/"+key+"?"+expiredQuery, nil)
	expiredRec := httptest.NewRecorder()
	r.ServeHTTP(expiredRec, expiredReq)
	if expiredRec.Code != http.StatusNotFound {
		t.Errorf("expired-signature status = %d, want 404", expiredRec.Code)
	}
}

func TestHandler_PrivateDelivery_PathTraversalRejected(t *testing.T) {
	r, _, _ := buildMediaTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/media/private/..%2f..%2fetc%2fpasswd?exp=9999999999&sig=x", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestHandler_MintSignedURL_PublicAssetRejected(t *testing.T) {
	r, _, db := buildMediaTestRouter(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)

	rec := uploadAs(t, r, tokenFor(u.ID, "seller"), CategoryProductImage, "x.png", fixture(t, "transparent.png"))
	asset := decodeAsset(t, rec)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/media/"+asset.ID.String()+"/signed-url", nil)
	req.Header.Set("Authorization", "Bearer "+tokenFor(u.ID, "seller"))
	mintRec := httptest.NewRecorder()
	r.ServeHTTP(mintRec, req)
	if mintRec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (public assets don't need signed URLs)", mintRec.Code)
	}
}

func TestHandler_UploadRateLimited(t *testing.T) {
	r, _, db := buildMediaTestRouter(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)
	token := tokenFor(u.ID, "seller")

	// Requests with no file attached fail validation fast (400) but still
	// pass through the rate limiter first (it's mounted before the
	// handler in routes.go), so this exercises the limiter without paying
	// for 31 real image-processing calls.
	var last *httptest.ResponseRecorder
	for i := 0; i < 31; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/media", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
		last = httptest.NewRecorder()
		r.ServeHTTP(last, req)
	}
	if last.Code != http.StatusTooManyRequests {
		t.Fatalf("31st request status = %d, want 429", last.Code)
	}
}
