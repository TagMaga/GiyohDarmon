package media

// routes_test.go — Proves the MEDIA_PIPELINE_ENABLED gate: when disabled,
// RegisterRoutes must register nothing at all (every media path 404s via
// gin's default NoRoute, not via an explicit handler rejection), and must
// never dereference the (possibly nil) *Handler it's given. When enabled,
// the same routes must actually exist and be reachable.
//
// Run with: go test ./internal/media/ -v -run TestRegisterRoutes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/middleware"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// buildGatedRouter wires RegisterRoutes exactly as cmd/server/main.go does,
// with h possibly nil (main.go never constructs a Handler when disabled —
// see its "Gated behind MEDIA_PIPELINE_ENABLED" comment).
func buildGatedRouter(h *Handler, enabled bool) *gin.Engine {
	r := gin.New()
	v1 := r.Group("/api/v1")
	RegisterRoutes(r, v1, h, middleware.NewMemoryStore(), enabled)
	return r
}

// allMediaPaths is every HTTP path the media pipeline can register,
// covering both the authenticated management group and the unauthenticated
// delivery group.
var allMediaPaths = []struct {
	method string
	path   string
}{
	{http.MethodPost, "/api/v1/media"},
	{http.MethodGet, "/api/v1/media/00000000-0000-0000-0000-000000000000"},
	{http.MethodDelete, "/api/v1/media/00000000-0000-0000-0000-000000000000"},
	{http.MethodGet, "/api/v1/media/00000000-0000-0000-0000-000000000000/signed-url"},
	{http.MethodGet, "/media/public/somekey.jpg"},
	{http.MethodGet, "/media/private/somekey.jpg"},
}

// TestRegisterRoutes_Disabled_AllMediaPathsReturn404 is the test requested
// for production-safety: with the flag off, every media path must be
// completely unregistered — a bare gin 404, indistinguishable from any
// other path that was never wired up (e.g. "/api/v1/nonexistent").
func TestRegisterRoutes_Disabled_AllMediaPathsReturn404(t *testing.T) {
	r := buildGatedRouter(nil, false) // nil handler: must never be touched

	for _, p := range allMediaPaths {
		req := httptest.NewRequest(p.method, p.path, nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s: status = %d, want 404 (route must not exist when disabled)", p.method, p.path, rec.Code)
		}
	}
}

// TestRegisterRoutes_Disabled_MatchesUnregisteredPath404Body proves the
// disabled-media 404 is byte-identical to gin's default 404 for a path that
// was never anything to do with media — i.e. it's a generic "no such
// route" response, not a media-specific rejection that happens to also be
// a 404 (which could still leak information about the feature's existence).
func TestRegisterRoutes_Disabled_MatchesUnregisteredPath404Body(t *testing.T) {
	r := buildGatedRouter(nil, false)

	mediaReq := httptest.NewRequest(http.MethodGet, "/media/public/somekey.jpg", nil)
	mediaRec := httptest.NewRecorder()
	r.ServeHTTP(mediaRec, mediaReq)

	unrelatedReq := httptest.NewRequest(http.MethodGet, "/this/path/was/never/registered/by/anything", nil)
	unrelatedRec := httptest.NewRecorder()
	r.ServeHTTP(unrelatedRec, unrelatedReq)

	if mediaRec.Code != unrelatedRec.Code || mediaRec.Body.String() != unrelatedRec.Body.String() {
		t.Errorf("disabled media 404 (status=%d body=%q) differs from a genuinely unregistered path's 404 (status=%d body=%q) — should be indistinguishable",
			mediaRec.Code, mediaRec.Body.String(), unrelatedRec.Code, unrelatedRec.Body.String())
	}
}

// TestRegisterRoutes_Enabled_RoutesExist is the inverse proof: flipping the
// flag on actually wires the routes (a nil-check regression here would
// silently defeat the whole feature). Uses a minimal in-memory-DB-free
// Service so this stays a pure routing test — full behavioral coverage of
// each route lives in handler_test.go.
func TestRegisterRoutes_Enabled_RoutesExist(t *testing.T) {
	// A Handler needs a *Service, which needs a *Repository (needs a real
	// *gorm.DB for actual queries) — but route *existence* doesn't require
	// any query to run, only that gin's tree has the path. A nil-repository
	// Service is fine here since these requests either 401 (no auth header)
	// or reach the delivery handler's fast-fail path (missing signature),
	// neither of which touches the repository.
	svc := NewService(nil, testServiceCfg(t))
	h := NewHandler(svc)
	r := buildGatedRouter(h, true)

	// POST /api/v1/media — no Authorization header — must be 401 (route
	// exists, auth middleware rejects), never a routing 404.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/media", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code == http.StatusNotFound {
		t.Errorf("POST /api/v1/media: got 404, want the route to exist (401 expected without auth)")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("POST /api/v1/media: status = %d, want 401", rec.Code)
	}

	// GET /media/public/:key — route exists and is unauthenticated; a
	// missing file is a legitimate handler-level 404, but we can still
	// distinguish "route exists" by checking it wasn't gin's blanket
	// NoRoute — same body-comparison technique as the disabled test.
	unrelatedReq := httptest.NewRequest(http.MethodGet, "/this/path/was/never/registered/by/anything", nil)
	unrelatedRec := httptest.NewRecorder()
	r.ServeHTTP(unrelatedRec, unrelatedReq)

	publicReq := httptest.NewRequest(http.MethodGet, "/media/public/somekey.jpg", nil)
	publicRec := httptest.NewRecorder()
	r.ServeHTTP(publicRec, publicReq)
	if publicRec.Code == unrelatedRec.Code && publicRec.Body.String() == unrelatedRec.Body.String() {
		t.Error("GET /media/public/:key: response indistinguishable from an unregistered path — route does not appear to exist")
	}
}
