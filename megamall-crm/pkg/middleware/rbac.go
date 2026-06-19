package middleware

import (
	"github.com/gin-gonic/gin"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/response"
)

// RequireRoles returns a Gin middleware that:
//  1. Validates the JWT via authenticateOnly (which does NOT call c.Next())
//  2. Checks that the caller's role is in the allowed list
//  3. Only then calls c.Next() to pass control to the route handler
//
// NEVER call RequireAuth() inside here — RequireAuth calls c.Next() which
// would run the route handler before the role check, causing a double-write
// (200 body + 403 header = concatenated JSON / "headers already written").
//
// Usage: router.GET("/route", middleware.RequireRoles("owner", "seller"), handler)
func RequireRoles(roles ...string) gin.HandlerFunc {
	// Pre-build an O(1) lookup set.
	allowed := make(map[string]struct{}, len(roles))
	for _, r := range roles {
		allowed[r] = struct{}{}
	}

	return func(c *gin.Context) {
		// Step 1 — authenticate (sets claims in context, no c.Next()).
		claims, ok := authenticateOnly(c)
		if !ok {
			return // authenticateOnly already wrote the error + called c.Abort()
		}

		// Step 2 — role check.
		if _, ok := allowed[claims.Role]; !ok {
			response.Error(c, apperrors.Forbidden("you do not have permission to access this resource"))
			c.Abort()
			return
		}

		// Both checks passed — advance to the route handler exactly once.
		c.Next()
	}
}
