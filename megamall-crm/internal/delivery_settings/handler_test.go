package delivery_settings

// handler_test.go — Audit logging test (DB-backed).
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Runs
// inside a rolled-back transaction so no manual cleanup is needed.
// Run with: DB_DSN=... go test ./internal/delivery_settings/ -v

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// buildTestRouter wires delivery-settings routes with a fake validator that
// trusts the role passed as the Bearer token value, resolved to a real
// user's ID so foreign-key columns (e.g. delivery_settings.updated_by) hold.
func buildTestRouter(h *Handler, actorID uuid.UUID) *gin.Engine {
	middleware.SetTokenValidator(func(_ context.Context, token string) (*middleware.ContextClaims, error) {
		if token == "" {
			return nil, apperrors.Unauthorized("no token")
		}
		return &middleware.ContextClaims{Role: token, UserID: actorID}, nil
	})
	r := gin.New()
	grp := r.Group("/settings/delivery", middleware.RequireAuth())
	h.RegisterRoutes(grp)
	return r
}

func TestUpdate_LogsActivity(t *testing.T) {
	db := testutil.NewTestDB(t)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	logger := activity.NewLogger(activity.NewRepository(db))
	h := NewHandler(db, logger)
	r := buildTestRouter(h, owner.ID)

	body, _ := json.Marshal(UpdateRequest{NormalFee: 15, FastFee: 30})
	req := httptest.NewRequest(http.MethodPut, "/settings/delivery", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer owner")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("PUT /settings/delivery: got %d, want 200, body=%s", w.Code, w.Body.String())
	}

	// Shutdown drains the async buffer and blocks until the final flush
	// completes, so the log row is guaranteed visible immediately after.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	logger.Shutdown(ctx)

	var log activity.Log
	err := db.Where("entity_type = ? AND action = ?", "delivery_settings", "update").
		Order("created_at DESC").First(&log).Error
	if err != nil {
		t.Fatalf("expected an activity log row for delivery_settings update: %v", err)
	}
	if log.ActorID == nil {
		t.Fatal("expected actor_id to be set")
	}
	if log.AfterState == nil {
		t.Fatal("expected after_state (new value) to be set")
	}
	if log.BeforeState == nil {
		t.Fatal("expected before_state (old value) to be set")
	}

	var after Response
	if err := json.Unmarshal(*log.AfterState, &after); err != nil {
		t.Fatalf("unmarshal after_state: %v", err)
	}
	if after.NormalFee != 15 || after.FastFee != 30 {
		t.Fatalf("after_state = %+v, want {15 30}", after)
	}
}
