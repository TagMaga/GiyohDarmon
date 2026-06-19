package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/pkg/response"
)

// RateLimitStore is the interface the RateLimit middleware depends on.
// The in-memory implementation below satisfies it; a Redis implementation
// can be dropped in without changing the middleware or tests.
type RateLimitStore interface {
	// Allow reports whether the request is allowed and returns the seconds
	// remaining until the window resets (used for Retry-After).
	Allow(key string, limit int, window time.Duration) (allowed bool, retryAfter int)
}

// RateLimit returns a gin middleware that enforces a per-key counter limit.
//
//   store  — backing store (NewMemoryStore() for in-process; swap for Redis later)
//   limit  — max allowed requests within window
//   window — rolling window duration (e.g. 60 * time.Second)
//   keyFn  — derives the bucket key from the request (e.g. IP + path)
//
// On limit exceeded: 429 + Retry-After header + standard error envelope.
// On allowed: c.Next() and no interference.
func RateLimit(store RateLimitStore, limit int, window time.Duration, keyFn func(*gin.Context) string) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := keyFn(c)
		allowed, retryAfter := store.Allow(key, limit, window)
		if !allowed {
			c.Header("Retry-After", strconv.Itoa(retryAfter))
			c.JSON(http.StatusTooManyRequests, response.Envelope{
				Success: false,
				Error: &response.ErrorBody{
					Code:    "RATE_LIMITED",
					Message: "Too many attempts. Please try again later.",
				},
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// IPPathKey is the standard key function: client IP + ":" + URL path.
// Example: "127.0.0.1:/api/v1/auth/login"
func IPPathKey(c *gin.Context) string {
	return c.ClientIP() + ":" + c.Request.URL.Path
}

// AuthRateLimit is a pre-configured RateLimit for auth endpoints:
// 5 requests per 60 seconds per IP per path, backed by the given store.
func AuthRateLimit(store RateLimitStore) gin.HandlerFunc {
	return RateLimit(store, 5, 60*time.Second, IPPathKey)
}

// ─── In-memory store ──────────────────────────────────────────────────────────

// MemoryStore is a thread-safe in-memory rate limit store.
// Uses a fixed sliding window: the counter resets once the window expires
// from the first request in the current window.
//
// Production note: replace with a Redis-backed store for multi-instance deploys.
// The RateLimitStore interface is the only change point.
type MemoryStore struct {
	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	count     int
	windowEnd time.Time
}

// NewMemoryStore creates a MemoryStore ready for use.
// A background goroutine is not needed — stale buckets are evicted lazily on
// the next Allow() call for the same key, keeping memory bounded in practice.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		buckets: make(map[string]*bucket),
	}
}

// Allow increments the counter for key and reports whether the request is within
// the limit. Returns retryAfter = seconds until the window resets (0 if allowed).
func (s *MemoryStore) Allow(key string, limit int, window time.Duration) (bool, int) {
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	b, ok := s.buckets[key]
	if !ok || now.After(b.windowEnd) {
		// New window or expired — reset.
		s.buckets[key] = &bucket{count: 1, windowEnd: now.Add(window)}
		return true, 0
	}

	if b.count >= limit {
		retryAfter := int(b.windowEnd.Sub(now).Seconds()) + 1
		return false, retryAfter
	}

	b.count++
	return true, 0
}

// Reset clears the bucket for a key. Used in tests to reset state between cases.
func (s *MemoryStore) Reset(key string) {
	s.mu.Lock()
	delete(s.buckets, key)
	s.mu.Unlock()
}
