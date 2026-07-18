package logistics_settings

// resolve_test.go — ResolveAssignmentPayout guard tests (DB-backed).
//
// Covers the "не настроен тариф выплат" gate: a courier must be assignable
// once EITHER a flat courier_profiles row OR at least one courier_tariff_rules
// row exists, matching what ResolveCourierPayout actually uses to compute pay.

import (
	"testing"

	courier_tariffs "github.com/megamall/crm/internal/courier_tariffs"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
)

func TestResolveAssignmentPayout_NoProfileNoRules_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	courier := testutil.CreateUser(t, db, users.RoleCourier)

	_, err := ResolveAssignmentPayout(db, courier.ID, nil, "normal")
	if err == nil {
		t.Fatal("expected an error when courier has neither a payout profile nor tariff rules")
	}
	appErr, ok := err.(*apperrors.AppError)
	if !ok {
		t.Fatalf("expected *apperrors.AppError, got %T: %v", err, err)
	}
	if appErr.Message != "у курьера не настроен тариф выплат — настройте его в разделе HR" {
		t.Fatalf("unexpected error message: %q", appErr.Message)
	}
}

func TestResolveAssignmentPayout_TariffRulesOnly_Accepted(t *testing.T) {
	db := testutil.NewTestDB(t)
	courier := testutil.CreateUser(t, db, users.RoleCourier)

	rule := courier_tariffs.CourierTariffRule{
		CourierID:    courier.ID,
		DeliveryType: courier_tariffs.DeliveryNormal,
		AmountFrom:   0,
		TariffType:   courier_tariffs.TariffFixed,
		TariffValue:  15,
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create tariff rule fixture: %v", err)
	}

	if _, err := ResolveAssignmentPayout(db, courier.ID, nil, "normal"); err != nil {
		t.Fatalf("expected success for a courier with only tariff rules configured, got: %v", err)
	}
}

func TestResolveAssignmentPayout_InactiveProfile_Rejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	courier := testutil.CreateUser(t, db, users.RoleCourier)

	profile := CourierProfile{UserID: courier.ID, PayoutNormal: 10, PayoutFast: 15, IsActive: true}
	if err := db.Create(&profile).Error; err != nil {
		t.Fatalf("create courier profile fixture: %v", err)
	}
	// IsActive:false can't ride the initial Create — it has a `default:true`
	// gorm tag, so Create omits the zero-value column and lets the DB default
	// win. Flip it with an explicit UPDATE instead, matching how a real
	// deactivation (a second write) would behave.
	if err := db.Model(&CourierProfile{}).Where("user_id = ?", courier.ID).
		Update("is_active", false).Error; err != nil {
		t.Fatalf("deactivate courier profile fixture: %v", err)
	}

	_, err := ResolveAssignmentPayout(db, courier.ID, nil, "normal")
	if err == nil {
		t.Fatal("expected an error for a courier with an inactive payout profile")
	}
	appErr, ok := err.(*apperrors.AppError)
	if !ok {
		t.Fatalf("expected *apperrors.AppError, got %T: %v", err, err)
	}
	if appErr.Message != "курьер неактивен" {
		t.Fatalf("unexpected error message: %q", appErr.Message)
	}
}

func TestResolveAssignmentPayout_ActiveProfile_Accepted(t *testing.T) {
	db := testutil.NewTestDB(t)
	courier := testutil.CreateUser(t, db, users.RoleCourier)

	profile := CourierProfile{UserID: courier.ID, PayoutNormal: 10, PayoutFast: 15, IsActive: true}
	if err := db.Create(&profile).Error; err != nil {
		t.Fatalf("create courier profile fixture: %v", err)
	}

	if _, err := ResolveAssignmentPayout(db, courier.ID, nil, "normal"); err != nil {
		t.Fatalf("expected success for a courier with an active payout profile, got: %v", err)
	}
}
