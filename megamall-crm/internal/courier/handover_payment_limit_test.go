package courier

import (
	"context"
	"strings"
	"testing"

	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
)

func TestSubmitHandover_PendingAmountReducesNewPaymentLimit(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupCourierServiceWithMedia(t, db)
	c := testutil.CreateUser(t, db, users.RoleCourier)

	// Each fixture produces 105 c of debt. The first courier request reserves
	// 100 c; after another delivery the current debt is 210 c, so only 110 c
	// remains available for a new request.
	createDeliveredOrderForCourier(t, db, c.ID)
	firstAmount := 100.0
	if _, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{
		ActualAmount: &firstAmount,
	}); err != nil {
		t.Fatalf("first SubmitHandover: %v", err)
	}

	createDeliveredOrderForCourier(t, db, c.ID)
	tooMuch := 111.0
	_, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{
		ActualAmount: &tooMuch,
	})
	if err == nil {
		t.Fatal("expected amount above current debt minus pending requests to be rejected")
	}
	if !strings.Contains(err.Error(), "Доступно к оплате: 110.00 с.") {
		t.Fatalf("unexpected limit error: %v", err)
	}

	var count int64
	if db.Model(&CashHandover{}).Where("courier_id = ?", c.ID).Count(&count).Error != nil {
		t.Fatal("count handovers")
	}
	if count != 1 {
		t.Fatalf("rejected submission created a handover: count = %d, want 1", count)
	}
}

func TestSubmitHandover_AmountAtRemainingLimitAccepted(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := setupCourierServiceWithMedia(t, db)
	c := testutil.CreateUser(t, db, users.RoleCourier)

	createDeliveredOrderForCourier(t, db, c.ID)
	firstAmount := 100.0
	if _, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{
		ActualAmount: &firstAmount,
	}); err != nil {
		t.Fatalf("first SubmitHandover: %v", err)
	}

	createDeliveredOrderForCourier(t, db, c.ID)
	remaining := 110.0
	if _, err := svc.SubmitHandover(context.Background(), c.ID, SubmitHandoverRequest{
		ActualAmount: &remaining,
	}); err != nil {
		t.Fatalf("amount at remaining limit should be accepted: %v", err)
	}
}
