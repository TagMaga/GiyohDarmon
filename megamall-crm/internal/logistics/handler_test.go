package logistics

// handler_test.go — Validation hardening test for cash-handover DTOs
// (DB-backed, since createHandover writes through the repository).
//
// Before this fix, createHandover/updateHandover bound the request body but
// never called validator.Validate — CreateHandoverReq/UpdateHandoverReq had
// no bounds at all, so any amount (including negative or absurdly large)
// was accepted. This test is the regression check for that gap.
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Runs
// inside a rolled-back transaction so no manual cleanup is needed.
// Run with: DB_DSN=... go test ./internal/logistics/ -v -run TestCreateHandover

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func buildHandoverRouter(h *Handler, actorID string) *gin.Engine {
	middleware.SetTokenValidator(func(_ context.Context, token string) (*middleware.ContextClaims, error) {
		if token == "" {
			return nil, apperrors.Unauthorized("no token")
		}
		return &middleware.ContextClaims{Role: token}, nil
	})
	r := gin.New()
	grp := r.Group("/owner/logistics", middleware.RequireAuth())
	h.RegisterRoutes(grp)
	return r
}

func postHandover(r *gin.Engine, body interface{}) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/owner/logistics/cash-handovers", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer owner")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestCreateHandover_OverMaxAmountRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	courierUser := testutil.CreateUser(t, db, users.RoleCourier)
	repo := NewRepository(db, time.UTC)
	h := NewHandler(repo, time.UTC)
	r := buildHandoverRouter(h, "owner")

	w := postHandover(r, CreateHandoverReq{
		CourierID:      courierUser.ID,
		TotalCollected: 5_000_000, // over the 1,000,000 max
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected an over-max total_collected to be rejected with 400, got %d, body=%s", w.Code, w.Body.String())
	}
}

func TestCreateHandover_NegativeAmountRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	courierUser := testutil.CreateUser(t, db, users.RoleCourier)
	repo := NewRepository(db, time.UTC)
	h := NewHandler(repo, time.UTC)
	r := buildHandoverRouter(h, "owner")

	w := postHandover(r, CreateHandoverReq{
		CourierID:      courierUser.ID,
		TotalCollected: -100,
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected a negative total_collected to be rejected with 400, got %d, body=%s", w.Code, w.Body.String())
	}
}

func TestCreateHandover_ValidAmountAccepted(t *testing.T) {
	db := testutil.NewTestDB(t)
	courierUser := testutil.CreateUser(t, db, users.RoleCourier)
	repo := NewRepository(db, time.UTC)
	h := NewHandler(repo, time.UTC)
	r := buildHandoverRouter(h, "owner")

	w := postHandover(r, CreateHandoverReq{
		CourierID:         courierUser.ID,
		TotalCollected:    500,
		TotalDeliveryFees: 50,
		TotalToReturn:     450,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("expected a valid handover to be accepted, got %d, body=%s", w.Code, w.Body.String())
	}
}
