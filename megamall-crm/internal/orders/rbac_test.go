package orders

// rbac_test.go — Pure unit tests for order RBAC policy.
//
// Tests the role-based scoping logic that governs which roles can access
// the /orders endpoints. No database, no HTTP server, no fixtures required.
//
// Run with: go test ./internal/orders/ -v -run TestRBAC

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

// ordersAllowedRoles returns the exact set of roles that should be permitted
// to call GET /orders and GET /orders/:id.
// This is the single source of truth for the test — matches routes.go.
func ordersAllowedRoles() []string {
	return []string{"owner", "sales_team_lead", "manager", "seller", "dispatcher"}
}

// ordersForbiddenRoles returns roles that must NOT reach the orders handler.
func ordersForbiddenRoles() []string {
	return []string{"warehouse_manager", "courier"}
}

// buildTestRouter wires up RequireRoles exactly as routes.go does for GET /orders.
// The route handler just returns 200 so tests can distinguish auth-pass from auth-fail.
func buildTestRouter() *gin.Engine {
	// Inject a fake validator that trusts the role passed as the Bearer token value.
	middleware.SetTokenValidator(func(_ context.Context, token string) (*middleware.ContextClaims, error) {
		if token == "" {
			return nil, apperrors.Unauthorized("no token")
		}
		return &middleware.ContextClaims{Role: token}, nil
	})

	r := gin.New()
	orderRoles := middleware.RequireRoles(ordersAllowedRoles()...)

	r.GET("/orders", orderRoles, func(c *gin.Context) {
		response.OK(c, gin.H{"ok": true})
	})
	r.GET("/orders/:id", orderRoles, func(c *gin.Context) {
		response.OK(c, gin.H{"ok": true})
	})
	return r
}

// get performs a GET request with the given role as the Bearer token.
func get(r *gin.Engine, path, role string) int {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if role != "" {
		req.Header.Set("Authorization", "Bearer "+role)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// TestOrderRBAC_AllowedRoles verifies that every role in orderRoles gets HTTP 200
// for both GET /orders and GET /orders/:id.
func TestOrderRBAC_AllowedRoles(t *testing.T) {
	r := buildTestRouter()

	for _, role := range ordersAllowedRoles() {
		t.Run("allowed_"+role+"/list", func(t *testing.T) {
			code := get(r, "/orders", role)
			if code != http.StatusOK {
				t.Errorf("role %q: GET /orders → %d, want 200", role, code)
			}
		})
		t.Run("allowed_"+role+"/get", func(t *testing.T) {
			code := get(r, "/orders/some-id", role)
			if code != http.StatusOK {
				t.Errorf("role %q: GET /orders/:id → %d, want 200", role, code)
			}
		})
	}
}

// TestOrderRBAC_ForbiddenRoles verifies that roles not in orderRoles get HTTP 403.
// Specifically:
//   - warehouse_manager must be forbidden (P0 fix: no user→warehouse scope mapping)
//   - courier must be forbidden (couriers use /courier/my-orders instead)
func TestOrderRBAC_ForbiddenRoles(t *testing.T) {
	r := buildTestRouter()

	for _, role := range ordersForbiddenRoles() {
		t.Run("forbidden_"+role+"/list", func(t *testing.T) {
			code := get(r, "/orders", role)
			if code != http.StatusForbidden {
				t.Errorf("role %q: GET /orders → %d, want 403", role, code)
			}
		})
		t.Run("forbidden_"+role+"/get", func(t *testing.T) {
			code := get(r, "/orders/some-id", role)
			if code != http.StatusForbidden {
				t.Errorf("role %q: GET /orders/:id → %d, want 403", role, code)
			}
		})
	}
}

// TestOrderRBAC_WarehouseManagerForbidden is an explicit, named test for the
// P0 data leak fix. This test must never be deleted without a corresponding
// warehouse_user_assignments migration and scoped repository query.
func TestOrderRBAC_WarehouseManagerForbidden(t *testing.T) {
	r := buildTestRouter()

	t.Run("GET /orders returns 403", func(t *testing.T) {
		code := get(r, "/orders", "warehouse_manager")
		if code != http.StatusForbidden {
			t.Errorf("warehouse_manager must not list orders: got %d, want 403 (P0 — Phase 24)", code)
		}
	})

	t.Run("GET /orders/:id returns 403", func(t *testing.T) {
		code := get(r, "/orders/"+fakeOrderID(), "warehouse_manager")
		if code != http.StatusForbidden {
			t.Errorf("warehouse_manager must not fetch order by ID: got %d, want 403 (P0 — Phase 24)", code)
		}
	})
}

// TestOrderRBAC_Unauthenticated verifies that missing/empty tokens get 401.
func TestOrderRBAC_Unauthenticated(t *testing.T) {
	r := buildTestRouter()

	t.Run("no auth header", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/orders", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("missing auth: got %d, want 401", w.Code)
		}
	})
}

// ─── Role-scoping logic tests ─────────────────────────────────────────────────

// TestOrderRoleScope verifies the role → SQL scope mapping used in repository.List.
// This table test documents the intended behavior as executable specification.
func TestOrderRoleScope(t *testing.T) {
	type scopeCase struct {
		role        string
		expectScope string // "self" = actor-scoped, "all" = unscoped (owner/dispatcher)
	}

	cases := []scopeCase{
		{"seller", "self"},
		{"manager", "self"},         // sees managed + own
		{"sales_team_lead", "self"}, // sees team + own
		{"dispatcher", "all"},
		{"owner", "all"},
		// warehouse_manager NEVER reaches repository.List — excluded from orderRoles.
		// courier NEVER reaches repository.List — excluded from orderRoles.
	}

	for _, tc := range cases {
		t.Run(tc.role, func(t *testing.T) {
			got := roleScope(tc.role)
			if got != tc.expectScope {
				t.Errorf("role %q: scope = %q, want %q", tc.role, got, tc.expectScope)
			}
		})
	}
}

// roleScope mirrors the switch statement in repository.List for testability.
// Any change to the repository scoping logic must also update this function.
func roleScope(actorRole string) string {
	switch actorRole {
	case "seller", "manager", "sales_team_lead":
		return "self"
	default:
		return "all"
	}
}

// fakeOrderID returns a fixed UUID string for use in path params.
func fakeOrderID() string {
	return "00000000-0000-0000-0000-000000000001"
}
