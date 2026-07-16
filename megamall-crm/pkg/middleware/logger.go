package middleware

import (
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// sensitiveQueryParamsByPrefix maps a path prefix to the query parameter
// names that must never appear in their real form in application logs for
// requests under that prefix. Currently only the private media delivery
// route carries a credential in its query string — an HMAC signature plus
// expiry (see internal/media/signing.go) — since it must work as a plain
// unauthenticated URL (e.g. an <img> tag src, which can't carry a custom
// Authorization header). Every other endpoint in this codebase authenticates
// via that header, which this logger never records at all, so no other
// prefix needs an entry here.
var sensitiveQueryParamsByPrefix = map[string][]string{
	"/media/private/": {"sig", "exp", "v"},
}

// RequestLogger logs each request with method, path, status, latency, IP.
// Query parameters named in sensitiveQueryParamsByPrefix, for a path
// matching that entry's prefix, are replaced with a fixed redaction marker
// before logging — see redactSensitiveQuery. Every other path's query
// string is logged exactly as before (unchanged behavior).
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := redactSensitiveQuery(path, c.Request.URL.RawQuery)

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()
		method := c.Request.Method
		ip := c.ClientIP()

		if raw != "" {
			path = path + "?" + raw
		}

		log.Printf("[HTTP] %d | %s | %s | %s | %v",
			status, method, path, ip, latency)
	}
}

// redactSensitiveQuery returns rawQuery with the value of any parameter
// named in sensitiveQueryParamsByPrefix's list — for whichever prefix
// matches path — replaced by "REDACTED", preserving every other parameter,
// their values, and the original ordering. A path matching no configured
// prefix returns rawQuery completely unchanged; this function must never
// alter logging for a route that carries no credential in its query string.
//
// Operates on the raw (still percent-encoded) query string via simple
// "&"/"=" splitting rather than full net/url parsing — sufficient here
// because every parameter name this function ever redacts is a fixed plain
// ASCII literal ("sig", "exp", "v") that internal/media's signer emits
// unencoded, and the same signer never emits a raw "&" inside a value.
func redactSensitiveQuery(path, rawQuery string) string {
	if rawQuery == "" {
		return rawQuery
	}
	var keys []string
	for prefix, sensitive := range sensitiveQueryParamsByPrefix {
		if strings.HasPrefix(path, prefix) {
			keys = sensitive
			break
		}
	}
	if keys == nil {
		return rawQuery
	}

	redact := make(map[string]struct{}, len(keys))
	for _, k := range keys {
		redact[k] = struct{}{}
	}

	pairs := strings.Split(rawQuery, "&")
	for i, pair := range pairs {
		name := pair
		if idx := strings.IndexByte(pair, '='); idx >= 0 {
			name = pair[:idx]
		}
		if _, ok := redact[name]; ok {
			pairs[i] = name + "=REDACTED"
		}
	}
	return strings.Join(pairs, "&")
}
