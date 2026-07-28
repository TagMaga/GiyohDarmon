package inventory

// rbac_test.go — Route-level RBAC test for the expiry-alerts endpoint.
//
// Mirrors internal/dispatch/rbac_test.go's pattern: wires the same role gate
// routes.go uses today, with a stub handler, so role-gating can be verified
// without touching the real handler's DB access.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/response"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func buildExpiryAlertsRBACRouter() *gin.Engine {
	middleware.SetTokenValidator(func(_ context.Context, token string) (*middleware.ContextClaims, error) {
		if token == "" {
			return nil, apperrors.Unauthorized("no token")
		}
		return &middleware.ContextClaims{Role: token}, nil
	})

	r := gin.New()
	auth := middleware.RequireAuth()
	expiryRoles := middleware.RequireRoles("owner", "warehouse_manager")
	stub := func(c *gin.Context) { response.OK(c, gin.H{"ok": true}) }

	r.GET("/inventory/expiry-alerts", auth, expiryRoles, stub)
	return r
}

func requestExpiryAlertsAsRole(r *gin.Engine, role string) int {
	req := httptest.NewRequest(http.MethodGet, "/inventory/expiry-alerts", nil)
	if role != "" {
		req.Header.Set("Authorization", "Bearer "+role)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

// TestExpiryAlertsRBAC_OwnerAndWarehouseManagerAllowed covers scenario 13:
// the endpoint must be reachable by owner and warehouse_manager.
func TestExpiryAlertsRBAC_OwnerAndWarehouseManagerAllowed(t *testing.T) {
	r := buildExpiryAlertsRBACRouter()

	if code := requestExpiryAlertsAsRole(r, "owner"); code != http.StatusOK {
		t.Errorf("owner GET expiry-alerts: got %d, want 200", code)
	}
	if code := requestExpiryAlertsAsRole(r, "warehouse_manager"); code != http.StatusOK {
		t.Errorf("warehouse_manager GET expiry-alerts: got %d, want 200", code)
	}
}

// TestExpiryAlertsRBAC_OtherRolesForbidden covers scenario 13: every other
// role — including dispatcher, who can read the rest of /inventory — must
// be forbidden from this specific endpoint.
func TestExpiryAlertsRBAC_OtherRolesForbidden(t *testing.T) {
	r := buildExpiryAlertsRBACRouter()

	for _, role := range []string{"seller", "manager", "sales_team_lead", "dispatcher", "courier"} {
		if code := requestExpiryAlertsAsRole(r, role); code != http.StatusForbidden {
			t.Errorf("role %q GET expiry-alerts: got %d, want 403", role, code)
		}
	}
}
