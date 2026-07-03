package seed

import (
	"testing"

	"github.com/megamall/crm/internal/compensation"
)

func TestDefaultCommissionRatesMatchBusinessModel(t *testing.T) {
	want := map[compensation.CommissionType]float64{
		compensation.CommissionTypeSellerRate:          0.10,
		compensation.CommissionTypeManagerTeamRate:     0.03,
		compensation.CommissionTypeManagerPersonalRate: 0.20,
		compensation.CommissionTypeTeamLeadPoolRate:    0.40,
		compensation.CommissionTypeCompanyRate:         0.60,
	}

	got := make(map[compensation.CommissionType]float64, len(defaultCommissionRates))
	for _, rate := range defaultCommissionRates {
		got[rate.commType] = rate.rate
	}

	for commType, expected := range want {
		if got[commType] != expected {
			t.Errorf("%s default rate: got %.5f, want %.5f", commType, got[commType], expected)
		}
	}
}
