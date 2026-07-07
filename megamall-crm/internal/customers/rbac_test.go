package customers

// rbac_test.go — Route-level RBAC tests for customer routes.
//
// Mirrors internal/orders/rbac_test.go's pattern: wires RegisterRoutes with
// a fake validator that trusts the role passed as the Bearer token value, so
// role-gating can be exercised without a real JWT or claims lookup.

import (
	"context"
	"net/http"
	"net/http/httptest"

	"github.com/gin-gonic/gin"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// buildTestRouter wires customer routes with a fake validator that trusts
// the role passed as the Bearer token value.
func buildTestRouter(h *Handler) *gin.Engine {
	middleware.SetTokenValidator(func(_ context.Context, token string) (*middleware.ContextClaims, error) {
		if token == "" {
			return nil, apperrors.Unauthorized("no token")
		}
		return &middleware.ContextClaims{Role: token}, nil
	})

	r := gin.New()
	h.RegisterRoutes(r.Group(""))
	return r
}

// getAsRole performs a GET request with the given role as the Bearer token.
func getAsRole(r *gin.Engine, path, role string) int {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if role != "" {
		req.Header.Set("Authorization", "Bearer "+role)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}
