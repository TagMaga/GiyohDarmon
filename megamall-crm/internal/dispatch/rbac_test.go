package dispatch

// rbac_test.go — Route-level RBAC test for courier tariff mutation routes.
//
// Mirrors internal/orders/rbac_test.go's pattern: wires the same role gate
// as routes.go, but with stub handlers, so role-gating can be verified
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

// buildTariffRBACRouter wires POST/DELETE .../tariffs with the exact role
// gate routes.go uses today (owner-only), with stub handlers standing in
// for the real ones so this test only exercises the RBAC gate.
func buildTariffRBACRouter() *gin.Engine {
	middleware.SetTokenValidator(func(_ context.Context, token string) (*middleware.ContextClaims, error) {
		if token == "" {
			return nil, apperrors.Unauthorized("no token")
		}
		return &middleware.ContextClaims{Role: token}, nil
	})

	r := gin.New()
	auth := middleware.RequireAuth()
	ownerOnly := middleware.RequireRoles("owner")
	stub := func(c *gin.Context) { response.OK(c, gin.H{"ok": true}) }

	r.POST("/dispatch/couriers/:id/tariffs", auth, ownerOnly, stub)
	r.DELETE("/dispatch/couriers/:id/tariffs/:rule_id", auth, ownerOnly, stub)
	return r
}

func requestAsRole(r *gin.Engine, method, path, role string) int {
	req := httptest.NewRequest(method, path, nil)
	if role != "" {
		req.Header.Set("Authorization", "Bearer "+role)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

func TestCourierTariffRBAC_OwnerAllowed(t *testing.T) {
	r := buildTariffRBACRouter()

	if code := requestAsRole(r, http.MethodPost, "/dispatch/couriers/some-id/tariffs", "owner"); code != http.StatusOK {
		t.Errorf("owner POST tariffs: got %d, want 200", code)
	}
	if code := requestAsRole(r, http.MethodDelete, "/dispatch/couriers/some-id/tariffs/rule-id", "owner"); code != http.StatusOK {
		t.Errorf("owner DELETE tariffs: got %d, want 200", code)
	}
}

// TestCourierTariffRBAC_DispatcherForbidden is the regression test for the
// fix: dispatcher could previously create/delete courier payout tariffs
// (routes.go used to gate these with dispatcherRoles = "dispatcher","owner").
// Tariffs set payout economics, so writing them is now owner-only; dispatcher
// keeps read access (GET) to explain payouts to couriers.
func TestCourierTariffRBAC_DispatcherForbidden(t *testing.T) {
	r := buildTariffRBACRouter()

	if code := requestAsRole(r, http.MethodPost, "/dispatch/couriers/some-id/tariffs", "dispatcher"); code != http.StatusForbidden {
		t.Errorf("dispatcher POST tariffs: got %d, want 403", code)
	}
	if code := requestAsRole(r, http.MethodDelete, "/dispatch/couriers/some-id/tariffs/rule-id", "dispatcher"); code != http.StatusForbidden {
		t.Errorf("dispatcher DELETE tariffs: got %d, want 403", code)
	}
}

func TestCourierTariffRBAC_OtherRolesForbidden(t *testing.T) {
	r := buildTariffRBACRouter()

	for _, role := range []string{"seller", "manager", "sales_team_lead", "warehouse_manager", "courier"} {
		if code := requestAsRole(r, http.MethodPost, "/dispatch/couriers/some-id/tariffs", role); code != http.StatusForbidden {
			t.Errorf("role %q POST tariffs: got %d, want 403", role, code)
		}
	}
}
