package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORSConfig controls which origins are allowed.
// Use NewCORSConfig to construct with sensible defaults.
type CORSConfig struct {
	// AllowedOrigins is the explicit allowlist. An empty slice means
	// "allow all origins" — acceptable in development, NOT in production.
	AllowedOrigins []string
}

// NewCORSConfig builds a CORSConfig from a comma-separated origins string.
//
// Examples:
//
//	NewCORSConfig("")                             → allow all (dev default)
//	NewCORSConfig("https://app.example.com")      → single origin
//	NewCORSConfig("https://app.com,https://stg.com") → multiple origins
func NewCORSConfig(raw string) CORSConfig {
	if raw == "" {
		return CORSConfig{}
	}
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, p := range parts {
		if o := strings.TrimSpace(p); o != "" {
			origins = append(origins, o)
		}
	}
	return CORSConfig{AllowedOrigins: origins}
}

// CORS returns a middleware that handles Cross-Origin Resource Sharing headers.
//
// When cfg.AllowedOrigins is empty (development default), the request's own
// Origin is echoed back — equivalent to Access-Control-Allow-Origin: *.
//
// When cfg.AllowedOrigins is set, only origins in the list receive the CORS
// headers; requests from other origins are passed through without CORS headers
// (the browser will block them).
func CORS(cfg CORSConfig) gin.HandlerFunc {
	allowedSet := make(map[string]struct{}, len(cfg.AllowedOrigins))
	for _, o := range cfg.AllowedOrigins {
		allowedSet[o] = struct{}{}
	}
	devMode := len(cfg.AllowedOrigins) == 0

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin == "" {
			c.Next()
			return
		}

		// Determine whether this origin should receive CORS headers.
		allowed := devMode
		if !devMode {
			_, allowed = allowedSet[origin]
		}

		if allowed {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization, Accept")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Expose-Headers", "Content-Length")
			c.Header("Access-Control-Max-Age", "3600")
		}

		if c.Request.Method == http.MethodOptions {
			if allowed {
				c.AbortWithStatus(http.StatusNoContent)
			} else {
				c.AbortWithStatus(http.StatusForbidden)
			}
			return
		}

		c.Next()
	}
}
