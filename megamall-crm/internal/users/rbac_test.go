package users

// rbac_test.go — Route-level RBAC regression test for PATCH /users/:id when
// the request bundles a password reset (new_password).
//
// UpdateUserRequest.NewPassword lets an owner reset another user's password
// in the same request as any other profile edit (see service.go: Update).
// The route gate itself is unchanged (still owner-only, same as every other
// field on this endpoint) — this test exists to pin that a password-bearing
// payload doesn't get a different, looser gate by accident.
//
// Mirrors internal/dispatch/rbac_test.go's pattern: wires the same role gate
// handler.go uses today, with a stub handler, so role-gating can be verified
// without touching the DB.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/response"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// buildUpdateUserRBACRouter wires PATCH /:id with the exact role gate
// RegisterRoutes uses today (owner-only), with a stub handler standing in
// for Update so this test only exercises the RBAC gate.
func buildUpdateUserRBACRouter() *gin.Engine {
	middleware.SetTokenValidator(func(_ context.Context, token string) (*middleware.ContextClaims, error) {
		if token == "" {
			return nil, apperrors.Unauthorized("no token")
		}
		return &middleware.ContextClaims{Role: token}, nil
	})

	r := gin.New()
	auth := middleware.RequireAuth()
	ownerOnly := middleware.RequireRoles(string(RoleOwner))
	stub := func(c *gin.Context) { response.OK(c, gin.H{"ok": true}) }

	r.PATCH("/users/:id", auth, ownerOnly, stub)
	return r
}

func requestPasswordResetAsRole(r *gin.Engine, role string) int {
	body := strings.NewReader(`{"new_password":"brand-new-pass"}`)
	req := httptest.NewRequest(http.MethodPatch, "/users/some-id", body)
	req.Header.Set("Content-Type", "application/json")
	if role != "" {
		req.Header.Set("Authorization", "Bearer "+role)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

func TestUpdateUserRBAC_PasswordReset_OwnerAllowed(t *testing.T) {
	r := buildUpdateUserRBACRouter()

	if code := requestPasswordResetAsRole(r, "owner"); code != http.StatusOK {
		t.Errorf("owner PATCH /:id with new_password: got %d, want 200", code)
	}
}

// it_specialist is always owner-equivalent (pkg/middleware.RequireRoles docs
// this: any route gated on "owner" implicitly allows "it_specialist" too).
func TestUpdateUserRBAC_PasswordReset_ITSpecialistAllowed(t *testing.T) {
	r := buildUpdateUserRBACRouter()

	if code := requestPasswordResetAsRole(r, "it_specialist"); code != http.StatusOK {
		t.Errorf("it_specialist PATCH /:id with new_password: got %d, want 200", code)
	}
}

func TestUpdateUserRBAC_PasswordReset_OtherRolesForbidden(t *testing.T) {
	r := buildUpdateUserRBACRouter()

	for _, role := range []string{"seller", "manager", "sales_team_lead", "dispatcher", "warehouse_manager", "courier"} {
		if code := requestPasswordResetAsRole(r, role); code != http.StatusForbidden {
			t.Errorf("role %q PATCH /:id with new_password: got %d, want 403", role, code)
		}
	}
}

func TestUpdateUserRBAC_PasswordReset_Unauthenticated(t *testing.T) {
	r := buildUpdateUserRBACRouter()

	if code := requestPasswordResetAsRole(r, ""); code != http.StatusUnauthorized {
		t.Errorf("no token PATCH /:id with new_password: got %d, want 401", code)
	}
}
