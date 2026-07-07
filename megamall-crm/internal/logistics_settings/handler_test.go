package logistics_settings

// handler_test.go — Audit logging tests (DB-backed).
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Runs
// inside a rolled-back transaction so no manual cleanup is needed.
// Run with: DB_DSN=... go test ./internal/logistics_settings/ -v

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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

func buildTestRouter(h *Handler, actorID uuid.UUID) *gin.Engine {
	middleware.SetTokenValidator(func(_ context.Context, token string) (*middleware.ContextClaims, error) {
		if token == "" {
			return nil, apperrors.Unauthorized("no token")
		}
		return &middleware.ContextClaims{Role: token, UserID: actorID}, nil
	})
	r := gin.New()
	auth := middleware.RequireAuth()
	grp := r.Group("", auth)
	h.RegisterRoutes(grp)
	return r
}

func doRequest(r *gin.Engine, method, path, role string, body interface{}) *httptest.ResponseRecorder {
	var reader *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Authorization", "Bearer "+role)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestCreateCity_LogsActivity(t *testing.T) {
	db := testutil.NewTestDB(t)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	logger := activity.NewLogger(activity.NewRepository(db))
	h := NewHandler(db, logger)
	r := buildTestRouter(h, owner.ID)

	cityName := fmt.Sprintf("Test City %s", uuid.New().String()[:8])
	w := doRequest(r, http.MethodPost, "/cities", "owner", CreateCityRequest{Name: cityName})
	if w.Code != http.StatusCreated {
		t.Fatalf("POST /cities: got %d, want 201, body=%s", w.Code, w.Body.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	logger.Shutdown(ctx)

	var log activity.Log
	if err := db.Where("entity_type = ? AND action = ?", "city", "create").
		Order("created_at DESC").First(&log).Error; err != nil {
		t.Fatalf("expected an activity log row for city create: %v", err)
	}
	if log.ActorID == nil || *log.ActorID != owner.ID {
		t.Fatal("expected actor_id to be the creating owner")
	}
	if log.AfterState == nil {
		t.Fatal("expected after_state to be set")
	}
}

func TestToggleCity_LogsActivity(t *testing.T) {
	db := testutil.NewTestDB(t)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	logger := activity.NewLogger(activity.NewRepository(db))
	h := NewHandler(db, logger)
	r := buildTestRouter(h, owner.ID)

	city := City{ID: uuid.New(), Name: "Toggle City " + uuid.New().String()[:8], IsActive: true}
	if err := db.Create(&city).Error; err != nil {
		t.Fatalf("create city fixture: %v", err)
	}

	w := doRequest(r, http.MethodPatch, "/cities/"+city.ID.String(), "owner", ToggleCityRequest{IsActive: false})
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH /cities/:id: got %d, want 200, body=%s", w.Code, w.Body.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	logger.Shutdown(ctx)

	var log activity.Log
	if err := db.Where("entity_type = ? AND action = ? AND entity_id = ?", "city", "update", city.ID).
		Order("created_at DESC").First(&log).Error; err != nil {
		t.Fatalf("expected an activity log row for city toggle: %v", err)
	}

	var before, after CityResponse
	_ = json.Unmarshal(*log.BeforeState, &before)
	_ = json.Unmarshal(*log.AfterState, &after)
	if !before.IsActive {
		t.Fatalf("before_state.is_active = %v, want true", before.IsActive)
	}
	if after.IsActive {
		t.Fatalf("after_state.is_active = %v, want false", after.IsActive)
	}
}

func TestUpdateCourierPayout_LogsActivity(t *testing.T) {
	db := testutil.NewTestDB(t)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courierUser := testutil.CreateUser(t, db, users.RoleCourier)
	logger := activity.NewLogger(activity.NewRepository(db))
	h := NewHandler(db, logger)
	r := buildTestRouter(h, owner.ID)

	path := "/couriers/" + courierUser.ID.String() + "/payout"
	w := doRequest(r, http.MethodPut, path, "owner", UpdateCourierPayoutRequest{
		PayoutNormal: 12.5,
		PayoutFast:   20,
		IsActive:     true,
		CityIDs:      nil,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("PUT /couriers/:id/payout: got %d, want 200, body=%s", w.Code, w.Body.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	logger.Shutdown(ctx)

	var log activity.Log
	if err := db.Where("entity_type = ? AND action = ? AND entity_id = ?", "courier_payout_profile", "update", courierUser.ID).
		Order("created_at DESC").First(&log).Error; err != nil {
		t.Fatalf("expected an activity log row for courier payout update: %v", err)
	}
	if log.AfterState == nil || log.BeforeState == nil {
		t.Fatal("expected both before_state and after_state to be set")
	}
}
