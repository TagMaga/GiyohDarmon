package middleware

// logger_test.go — Proves RequestLogger never writes a private media
// signed-URL's sig/exp/v query values to the application log, while every
// other route's query string continues to be logged exactly as before.
//
// Run with: go test ./pkg/middleware/ -v -run 'TestRedactSensitiveQuery|TestRequestLogger'

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// ─── Unit tests on the redaction helper itself ─────────────────────────────

func TestRedactSensitiveQuery_MediaPrivateRedactsSigExpV(t *testing.T) {
	in := "exp=1234567890&sig=deadbeefcafefeed&v=thumbnail"
	got := redactSensitiveQuery("/media/private/abc123.jpg", in)
	want := "exp=REDACTED&sig=REDACTED&v=REDACTED"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestRedactSensitiveQuery_PreservesNonSensitiveParamsAndOrder(t *testing.T) {
	in := "foo=bar&sig=deadbeef&baz=qux"
	got := redactSensitiveQuery("/media/private/abc123.jpg", in)
	want := "foo=bar&sig=REDACTED&baz=qux"
	if got != want {
		t.Errorf("got %q, want %q — non-sensitive params and their order must survive untouched", got, want)
	}
}

func TestRedactSensitiveQuery_EmptyQueryUnchanged(t *testing.T) {
	if got := redactSensitiveQuery("/media/private/abc123.jpg", ""); got != "" {
		t.Errorf("got %q, want empty string unchanged", got)
	}
}

// TestRedactSensitiveQuery_OtherPathsUnaffected proves this change doesn't
// silently alter logging for any route that doesn't carry a credential in
// its query string — the "keep normal ... logging" requirement for
// everything else.
func TestRedactSensitiveQuery_OtherPathsUnaffected(t *testing.T) {
	cases := []struct{ path, query string }{
		{"/api/v1/orders", "page=2&limit=20"},
		{"/media/public/abc123.jpg", "v=thumbnail"}, // public route: no credential, no redaction
		{"/api/v1/media/some-id/signed-url", "variant=card"},
		{"/uploads/somefile.jpg", ""},
	}
	for _, c := range cases {
		got := redactSensitiveQuery(c.path, c.query)
		if got != c.query {
			t.Errorf("path %q: query changed from %q to %q, want unchanged", c.path, c.query, got)
		}
	}
}

func TestRedactSensitiveQuery_PrefixMatchRequiresLeadingSegment(t *testing.T) {
	// A path that merely contains "/media/private/" as a substring deeper
	// in its URL, rather than as a genuine prefix, must not trigger
	// redaction — this guards against a future route accidentally matching.
	got := redactSensitiveQuery("/api/v1/something/media/private/abc", "sig=deadbeef")
	if got != "sig=deadbeef" {
		t.Errorf("got %q, want unchanged (prefix match, not substring match)", got)
	}
}

// ─── End-to-end: capture real `log` package output through RequestLogger ──

// captureLog redirects the standard log package's output for the duration
// of fn and returns everything written to it.
func captureLog(t *testing.T, fn func()) string {
	t.Helper()
	var buf bytes.Buffer
	orig := log.Writer()
	origFlags := log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0) // no timestamp prefix, keeps assertions simple
	defer func() {
		log.SetOutput(orig)
		log.SetFlags(origFlags)
	}()
	fn()
	return buf.String()
}

// TestRequestLogger_PrivateMediaRoute_DoesNotLogSignature is the actual
// proof requested: mint a recognizable, canary-like fake signature/expiry,
// drive a real request through RequestLogger + a stand-in private-media
// route, and assert the captured log line contains the normal fields
// (method, path without query, status) but never the sensitive values.
func TestRequestLogger_PrivateMediaRoute_DoesNotLogSignature(t *testing.T) {
	const canarySig = "CANARY-SIGNATURE-MUST-NOT-APPEAR-IN-LOGS-1234567890abcdef"
	const canaryExp = "9999999999"
	const canaryVariant = "thumbnail-canary"

	r := gin.New()
	r.Use(RequestLogger())
	r.GET("/media/private/:key", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet,
		"/media/private/somekey.jpg?exp="+canaryExp+"&sig="+canarySig+"&v="+canaryVariant, nil)
	rec := httptest.NewRecorder()

	logged := captureLog(t, func() {
		r.ServeHTTP(rec, req)
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("request status = %d, want 200", rec.Code)
	}
	if logged == "" {
		t.Fatal("expected RequestLogger to write a log line")
	}

	if strings.Contains(logged, canarySig) {
		t.Errorf("log line contains the real signature value — leak! log: %q", logged)
	}
	if strings.Contains(logged, "exp="+canaryExp) {
		t.Errorf("log line contains the real expiry value — leak! log: %q", logged)
	}
	if strings.Contains(logged, "v="+canaryVariant) {
		t.Errorf("log line contains the real variant value — leak! log: %q", logged)
	}

	// Normal fields must still be present: method, status, the path
	// (without the sensitive query values), IP marker, and the redaction
	// markers proving the params were seen and handled, not silently
	// dropped.
	for _, want := range []string{"GET", "200", "/media/private/somekey.jpg", "sig=REDACTED", "exp=REDACTED", "v=REDACTED"} {
		if !strings.Contains(logged, want) {
			t.Errorf("log line missing expected field %q — log: %q", want, logged)
		}
	}
}

// TestRequestLogger_NonMediaRoute_StillLogsQueryString proves ordinary
// routes keep exactly their prior logging behavior — no regression from
// this change for every endpoint that isn't the private media route.
func TestRequestLogger_NonMediaRoute_StillLogsQueryString(t *testing.T) {
	r := gin.New()
	r.Use(RequestLogger())
	r.GET("/api/v1/orders", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/orders?page=2&limit=20", nil)
	rec := httptest.NewRecorder()

	logged := captureLog(t, func() {
		r.ServeHTTP(rec, req)
	})

	if !strings.Contains(logged, "/api/v1/orders?page=2&limit=20") {
		t.Errorf("expected the full, unredacted query string for a non-media route, got: %q", logged)
	}
}

// TestRequestLogger_PublicMediaRoute_NoCredentialToRedact confirms the
// public delivery route (which never carries a signature) is unaffected —
// redaction is scoped to /media/private/ only, per sensitiveQueryParamsByPrefix.
func TestRequestLogger_PublicMediaRoute_NoCredentialToRedact(t *testing.T) {
	r := gin.New()
	r.Use(RequestLogger())
	r.GET("/media/public/:key", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/media/public/somekey.jpg?v=thumbnail", nil)
	rec := httptest.NewRecorder()

	logged := captureLog(t, func() {
		r.ServeHTTP(rec, req)
	})

	if !strings.Contains(logged, "/media/public/somekey.jpg?v=thumbnail") {
		t.Errorf("expected the public route's query string logged unredacted, got: %q", logged)
	}
}
