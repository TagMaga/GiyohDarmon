package middleware

// rate_limit_test.go — Tests for Phase 29 in-memory rate limiting.
//
// Covers:
//   1. First N requests within limit are allowed
//   2. (N+1)th request is rejected with 429
//   3. Different IPs have independent buckets
//   4. Different paths (endpoints) have independent buckets
//   5. Bucket resets after window expires
//   6. Retry-After header is present and positive
//   7. Concurrent safety (no race, no panic under parallel load)
//
// No database, no network required.
// Run with: go test ./pkg/middleware/ -v -run TestRateLimit -race

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/response"
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

func init() {
	gin.SetMode(gin.TestMode)
}

// testRouter builds a gin engine with RateLimit applied and a trivial 200 handler.
func testRouter(store RateLimitStore, limit int, window time.Duration) *gin.Engine {
	r := gin.New()
	r.POST("/login", RateLimit(store, limit, window, IPPathKey), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	r.POST("/refresh", RateLimit(store, limit, window, IPPathKey), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return r
}

func doPost(r *gin.Engine, path, ip string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, nil)
	req.Header.Set("X-Forwarded-For", ip)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ─── Test cases ───────────────────────────────────────────────────────────────

// TestRateLimit_FirstFiveAllowed verifies that the first 5 requests within the
// window are all allowed (status 200).
func TestRateLimit_FirstFiveAllowed(t *testing.T) {
	store := NewMemoryStore()
	r := testRouter(store, 5, 60*time.Second)

	for i := 1; i <= 5; i++ {
		w := doPost(r, "/login", "10.0.0.1")
		if w.Code != http.StatusOK {
			t.Errorf("request %d: got %d, want 200", i, w.Code)
		}
	}
}

// TestRateLimit_SixthRequestRejected verifies that the 6th request gets 429.
func TestRateLimit_SixthRequestRejected(t *testing.T) {
	store := NewMemoryStore()
	r := testRouter(store, 5, 60*time.Second)

	for i := 0; i < 5; i++ {
		doPost(r, "/login", "10.0.0.2")
	}

	w := doPost(r, "/login", "10.0.0.2")
	if w.Code != http.StatusTooManyRequests {
		t.Errorf("6th request: got %d, want 429", w.Code)
	}
}

// TestRateLimit_ResponseBody verifies the 429 body matches the required shape.
func TestRateLimit_ResponseBody(t *testing.T) {
	store := NewMemoryStore()
	r := testRouter(store, 1, 60*time.Second)

	doPost(r, "/login", "10.0.0.3") // exhaust

	w := doPost(r, "/login", "10.0.0.3")
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", w.Code)
	}

	var env response.Envelope
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if env.Success {
		t.Error("success must be false on 429")
	}
	if env.Error == nil {
		t.Fatal("error field must be set on 429")
	}
	if env.Error.Code != "RATE_LIMITED" {
		t.Errorf("error.code = %q, want RATE_LIMITED", env.Error.Code)
	}
	if env.Error.Message == "" {
		t.Error("error.message must not be empty")
	}
}

// TestRateLimit_RetryAfterHeader verifies that Retry-After is present and > 0.
func TestRateLimit_RetryAfterHeader(t *testing.T) {
	store := NewMemoryStore()
	r := testRouter(store, 1, 60*time.Second)

	doPost(r, "/login", "10.0.0.4") // exhaust

	w := doPost(r, "/login", "10.0.0.4")
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", w.Code)
	}

	header := w.Header().Get("Retry-After")
	if header == "" {
		t.Fatal("Retry-After header must be present on 429")
	}

	// Must be a positive integer (seconds).
	// strconv.Atoi confirms the header is a valid integer.
	secs, err := strconv.Atoi(header)
	if err != nil {
		t.Errorf("Retry-After %q is not a valid integer: %v", header, err)
	} else if secs <= 0 {
		t.Errorf("Retry-After = %d, want > 0", secs)
	}
}

// TestRateLimit_DifferentIPsAreIndependent verifies that two IPs have separate
// buckets and do not share limits.
func TestRateLimit_DifferentIPsAreIndependent(t *testing.T) {
	store := NewMemoryStore()
	r := testRouter(store, 2, 60*time.Second)

	// Exhaust IP A.
	doPost(r, "/login", "10.0.1.1")
	doPost(r, "/login", "10.0.1.1")
	w := doPost(r, "/login", "10.0.1.1") // 3rd for A — should be 429
	if w.Code != http.StatusTooManyRequests {
		t.Errorf("IP A 3rd request: got %d, want 429", w.Code)
	}

	// IP B should still be fresh.
	w2 := doPost(r, "/login", "10.0.1.2")
	if w2.Code != http.StatusOK {
		t.Errorf("IP B first request: got %d, want 200", w2.Code)
	}
}

// TestRateLimit_DifferentPathsAreIndependent verifies that /login and /refresh
// each have their own bucket for the same IP.
func TestRateLimit_DifferentPathsAreIndependent(t *testing.T) {
	store := NewMemoryStore()
	r := testRouter(store, 2, 60*time.Second)

	// Exhaust /login for this IP.
	doPost(r, "/login", "10.0.2.1")
	doPost(r, "/login", "10.0.2.1")
	w := doPost(r, "/login", "10.0.2.1")
	if w.Code != http.StatusTooManyRequests {
		t.Errorf("/login 3rd: got %d, want 429", w.Code)
	}

	// /refresh for the same IP should be unaffected.
	w2 := doPost(r, "/refresh", "10.0.2.1")
	if w2.Code != http.StatusOK {
		t.Errorf("/refresh 1st (same IP as exhausted /login): got %d, want 200", w2.Code)
	}
}

// TestRateLimit_BucketResetsAfterWindow verifies that a previously exhausted
// bucket allows requests again once the window has elapsed.
func TestRateLimit_BucketResetsAfterWindow(t *testing.T) {
	store := NewMemoryStore()
	// Use a very short window so the test doesn't sleep long.
	window := 100 * time.Millisecond
	r := testRouter(store, 1, window)

	doPost(r, "/login", "10.0.3.1") // exhaust

	w := doPost(r, "/login", "10.0.3.1") // should be 429
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("pre-reset: got %d, want 429", w.Code)
	}

	time.Sleep(window + 20*time.Millisecond) // wait for window to expire

	w2 := doPost(r, "/login", "10.0.3.1") // should be allowed again
	if w2.Code != http.StatusOK {
		t.Errorf("post-reset: got %d, want 200", w2.Code)
	}
}

// TestRateLimit_ConcurrencySafety fires many concurrent requests from the same
// IP and verifies: no panic, no data race (run with -race), and exactly `limit`
// requests succeed with the rest getting 429.
func TestRateLimit_ConcurrencySafety(t *testing.T) {
	const limit = 5
	const total = 50

	store := NewMemoryStore()
	r := testRouter(store, limit, 60*time.Second)

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		allowed int
		limited int
	)

	for i := 0; i < total; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := doPost(r, "/login", "10.0.4.1")
			mu.Lock()
			switch w.Code {
			case http.StatusOK:
				allowed++
			case http.StatusTooManyRequests:
				limited++
			default:
				t.Errorf("unexpected status %d", w.Code)
			}
			mu.Unlock()
		}()
	}

	wg.Wait()

	if allowed != limit {
		t.Errorf("allowed = %d, want exactly %d", allowed, limit)
	}
	if limited != total-limit {
		t.Errorf("limited = %d, want %d", limited, total-limit)
	}
}

// ─── MemoryStore unit tests ───────────────────────────────────────────────────

// TestMemoryStore_AllowAndDeny tests the store's Allow method directly.
func TestMemoryStore_AllowAndDeny(t *testing.T) {
	store := NewMemoryStore()
	const key = "test-key"

	for i := 1; i <= 3; i++ {
		allowed, _ := store.Allow(key, 3, time.Minute)
		if !allowed {
			t.Errorf("request %d: expected allowed=true", i)
		}
	}

	allowed, retryAfter := store.Allow(key, 3, time.Minute)
	if allowed {
		t.Error("4th request: expected allowed=false (over limit)")
	}
	if retryAfter <= 0 {
		t.Errorf("retryAfter = %d, want > 0", retryAfter)
	}
}

// TestMemoryStore_Reset verifies Reset clears a key's bucket.
func TestMemoryStore_Reset(t *testing.T) {
	store := NewMemoryStore()
	const key = "reset-key"

	store.Allow(key, 1, time.Minute) // exhaust
	allowed, _ := store.Allow(key, 1, time.Minute)
	if allowed {
		t.Fatal("should be denied before reset")
	}

	store.Reset(key)

	allowed, _ = store.Allow(key, 1, time.Minute)
	if !allowed {
		t.Error("should be allowed after Reset")
	}
}

// TestMemoryStore_IndependentKeys verifies two different keys are fully independent.
func TestMemoryStore_IndependentKeys(t *testing.T) {
	store := NewMemoryStore()

	store.Allow("key-a", 1, time.Minute) // exhaust A
	allowed, _ := store.Allow("key-b", 1, time.Minute)
	if !allowed {
		t.Error("key-b should be unaffected by key-a exhaustion")
	}
}
