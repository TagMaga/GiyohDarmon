package dispatch

// tariff_test.go — Courier tariff audit-logging and validation tests (DB-backed).
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Runs
// inside a rolled-back transaction so no manual cleanup is needed.
// Constructs Service/Handler via struct literals (same package) rather than
// NewService/NewHandler, since the tariff endpoints only touch svc.db and
// svc.logger — building a full orders.Service dependency graph isn't needed.
// Run with: DB_DSN=... go test ./internal/dispatch/ -v -run TestCourierTariff

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
	courier_tariffs "github.com/megamall/crm/internal/courier_tariffs"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
)

func buildTariffAuditRouter(h *Handler, actorID uuid.UUID) *gin.Engine {
	middleware.SetTokenValidator(func(_ context.Context, token string) (*middleware.ContextClaims, error) {
		if token == "" {
			return nil, apperrors.Unauthorized("no token")
		}
		return &middleware.ContextClaims{Role: token, UserID: actorID}, nil
	})
	r := gin.New()
	r.POST("/dispatch/couriers/:id/tariffs", middleware.RequireAuth(), h.createCourierTariff)
	r.DELETE("/dispatch/couriers/:id/tariffs/:rule_id", middleware.RequireAuth(), h.deleteCourierTariff)
	return r
}

func TestCourierTariff_CreateAndDelete_LogActivity(t *testing.T) {
	db := testutil.NewTestDB(t)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courierUser := testutil.CreateUser(t, db, users.RoleCourier)
	logger := activity.NewLogger(activity.NewRepository(db))
	svc := &Service{db: db, logger: logger}
	h := &Handler{svc: svc}
	r := buildTariffAuditRouter(h, owner.ID)

	createBody, _ := json.Marshal(courier_tariffs.CreateTariffRuleRequest{
		DeliveryType: courier_tariffs.DeliveryNormal,
		AmountFrom:   0,
		TariffType:   courier_tariffs.TariffFixed,
		TariffValue:  25,
	})
	req := httptest.NewRequest(http.MethodPost, "/dispatch/couriers/"+courierUser.ID.String()+"/tariffs", bytes.NewReader(createBody))
	req.Header.Set("Authorization", "Bearer owner")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("POST tariffs: got %d, want 201, body=%s", w.Code, w.Body.String())
	}
	var createEnvelope struct {
		Data courier_tariffs.TariffRuleResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &createEnvelope); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}
	created := createEnvelope.Data
	if created.ID == uuid.Nil {
		t.Fatalf("created tariff rule has zero ID, body=%s", w.Body.String())
	}

	delReq := httptest.NewRequest(http.MethodDelete,
		"/dispatch/couriers/"+courierUser.ID.String()+"/tariffs/"+created.ID.String(), nil)
	delReq.Header.Set("Authorization", "Bearer owner")
	delW := httptest.NewRecorder()
	r.ServeHTTP(delW, delReq)
	if delW.Code != http.StatusNoContent {
		t.Fatalf("DELETE tariffs: got %d, want 204, body=%s", delW.Code, delW.Body.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	logger.Shutdown(ctx)

	var createLog activity.Log
	if err := db.Where("entity_type = ? AND action = ? AND entity_id = ?", "courier_tariff_rule", "create", created.ID).
		First(&createLog).Error; err != nil {
		t.Fatalf("expected an activity log row for tariff create: %v", err)
	}
	if createLog.AfterState == nil {
		t.Fatal("expected after_state on create log")
	}

	var deleteLog activity.Log
	if err := db.Where("entity_type = ? AND action = ? AND entity_id = ?", "courier_tariff_rule", "delete", created.ID).
		First(&deleteLog).Error; err != nil {
		t.Fatalf("expected an activity log row for tariff delete: %v", err)
	}
	if deleteLog.BeforeState == nil {
		t.Fatal("expected before_state (old value) on delete log")
	}
	// BeforeState was logged from the raw *CourierTariffRule model (only
	// gorm tags, no json tags), not the json-tagged response DTO — match
	// that shape here rather than TariffRuleResponse.
	var before courier_tariffs.CourierTariffRule
	if err := json.Unmarshal(*deleteLog.BeforeState, &before); err != nil {
		t.Fatalf("unmarshal before_state: %v", err)
	}
	if before.TariffValue != 25 {
		t.Fatalf("delete log before_state.tariff_value = %v, want 25", before.TariffValue)
	}
}

// TestCourierTariff_PercentOver100Rejected covers the "percent max <= 100"
// validation hardening requirement.
func TestCourierTariff_PercentOver100Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	courierUser := testutil.CreateUser(t, db, users.RoleCourier)
	repo := courier_tariffs.NewRepository(db)
	svc := courier_tariffs.NewService(repo)

	_, err := svc.Create(context.Background(), courierUser.ID, courier_tariffs.CreateTariffRuleRequest{
		DeliveryType: courier_tariffs.DeliveryNormal,
		AmountFrom:   0,
		TariffType:   courier_tariffs.TariffPercent,
		TariffValue:  150,
	})
	if err == nil {
		t.Fatal("expected a percent tariff over 100 to be rejected")
	}

	// A percent tariff at exactly 100 must be accepted.
	_, err = svc.Create(context.Background(), courierUser.ID, courier_tariffs.CreateTariffRuleRequest{
		DeliveryType: courier_tariffs.DeliveryNormal,
		AmountFrom:   0,
		TariffType:   courier_tariffs.TariffPercent,
		TariffValue:  100,
	})
	if err != nil {
		t.Fatalf("expected a percent tariff at exactly 100 to be accepted: %v", err)
	}

	// A fixed (non-percent) tariff over 100 must NOT be rejected by the
	// percent rule — it's a currency amount, not a percentage.
	_, err = svc.Create(context.Background(), courierUser.ID, courier_tariffs.CreateTariffRuleRequest{
		DeliveryType: courier_tariffs.DeliveryFast,
		AmountFrom:   0,
		TariffType:   courier_tariffs.TariffFixed,
		TariffValue:  500,
	})
	if err != nil {
		t.Fatalf("expected a fixed tariff over 100 to be accepted: %v", err)
	}
}
