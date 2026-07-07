package middleware

import (
	"context"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/response"
)

const claimsKey = "claims"

// ContextClaims is what gets stored in the Gin context after auth.
type ContextClaims struct {
	UserID uuid.UUID
	Role   string
	TeamID *uuid.UUID
}

// TokenValidator is the function signature for JWT validation.
// Injected at startup to avoid circular imports.
type TokenValidator func(ctx context.Context, token string) (*ContextClaims, error)

var globalValidator TokenValidator

// SetTokenValidator injects the JWT validator at startup.
func SetTokenValidator(v TokenValidator) {
	globalValidator = v
}

// authenticateOnly validates the Bearer token and stores claims in the context.
// Returns (claims, true) on success.
// On failure it writes the error response, calls c.Abort(), and returns (nil, false).
//
// CRITICAL: this function deliberately does NOT call c.Next().
// Calling c.Next() here would advance Gin's handler index and execute the route
// handler before any role-check in RequireRoles has run, producing a 200 body
// followed by a 403 — the "headers already written" double-write bug.
func authenticateOnly(c *gin.Context) (*ContextClaims, bool) {
	token, err := extractBearer(c)
	if err != nil {
		response.Error(c, err)
		c.Abort()
		return nil, false
	}

	if globalValidator == nil {
		response.Error(c, apperrors.Internal(nil))
		c.Abort()
		return nil, false
	}

	claims, valErr := globalValidator(c.Request.Context(), token)
	if valErr != nil {
		response.HandleError(c, valErr)
		c.Abort()
		return nil, false
	}

	c.Set(claimsKey, claims)
	return claims, true
}

// RequireAuth is a Gin middleware that validates the JWT, injects claims,
// and then advances the chain with c.Next().
// Use this on routes that need authentication but no role restriction.
func RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := authenticateOnly(c); !ok {
			return
		}
		c.Next()
	}
}

// ClaimsFromContext retrieves the injected claims from the Gin context.
// Panics if called outside an authenticated route — this is intentional.
func ClaimsFromContext(c *gin.Context) *ContextClaims {
	v, exists := c.Get(claimsKey)
	if !exists {
		panic("ClaimsFromContext called on unauthenticated route")
	}
	claims, ok := v.(*ContextClaims)
	if !ok {
		panic("unexpected claims type in context")
	}
	return claims
}

func extractBearer(c *gin.Context) (string, *apperrors.AppError) {
	header := c.GetHeader("Authorization")
	if header == "" {
		return "", apperrors.Unauthorized("missing Authorization header")
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
		return "", apperrors.Unauthorized("Authorization header must be: Bearer <token>")
	}
	if parts[1] == "" {
		return "", apperrors.Unauthorized("empty bearer token")
	}
	return parts[1], nil
}
