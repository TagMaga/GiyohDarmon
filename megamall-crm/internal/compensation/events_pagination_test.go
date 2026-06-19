package compensation

// events_pagination_test.go — Unit tests for Phase 27 GET /hr/events pagination.
//
// Covers:
//   1. pagination.ParseFromQueryWithDefaults — default limit=100, cap at MaxLimit
//   2. pagination.BuildMeta — shape and total_pages calculation
//   3. pagination.Params.Offset — SQL offset arithmetic
//   4. ListEvents role routing — forbidden roles, owner flags, self-forcing
//
// No database, no network required.
// Run with: go test ./internal/compensation/ -v -run TestEventsPagination

import (
	"context"
	"math"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
)

// ─── pagination.ParseFromQueryWithDefaults ────────────────────────────────────

// ginContextWithQuery builds a gin.Context carrying the given query string.
func ginContextWithQuery(query string) *gin.Context {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest("GET", "/?"+query, nil)
	c.Request = req
	return c
}

func TestEventsPagination_DefaultLimitIs100(t *testing.T) {
	c := ginContextWithQuery("") // no page, no limit
	p := pagination.ParseFromQueryWithDefaults(c, 1, pagination.MaxLimit)
	if p.Page != 1 {
		t.Errorf("page = %d, want 1", p.Page)
	}
	if p.Limit != pagination.MaxLimit {
		t.Errorf("default limit = %d, want %d (MaxLimit)", p.Limit, pagination.MaxLimit)
	}
}

func TestEventsPagination_ExplicitLimitRespected(t *testing.T) {
	c := ginContextWithQuery("page=3&limit=25")
	p := pagination.ParseFromQueryWithDefaults(c, 1, pagination.MaxLimit)
	if p.Page != 3 {
		t.Errorf("page = %d, want 3", p.Page)
	}
	if p.Limit != 25 {
		t.Errorf("limit = %d, want 25", p.Limit)
	}
}

func TestEventsPagination_LimitCappedAtMaxLimit(t *testing.T) {
	c := ginContextWithQuery("limit=999")
	p := pagination.ParseFromQueryWithDefaults(c, 1, pagination.MaxLimit)
	if p.Limit != pagination.MaxLimit {
		t.Errorf("oversized limit = %d, want capped at %d", p.Limit, pagination.MaxLimit)
	}
}

func TestEventsPagination_NegativeLimitFallsToDefault(t *testing.T) {
	c := ginContextWithQuery("limit=-5")
	p := pagination.ParseFromQueryWithDefaults(c, 1, pagination.MaxLimit)
	if p.Limit != pagination.MaxLimit {
		t.Errorf("negative limit = %d, want default %d", p.Limit, pagination.MaxLimit)
	}
}

func TestEventsPagination_NegativePageFallsToOne(t *testing.T) {
	c := ginContextWithQuery("page=-3&limit=20")
	p := pagination.ParseFromQueryWithDefaults(c, 1, pagination.MaxLimit)
	if p.Page != 1 {
		t.Errorf("negative page = %d, want 1", p.Page)
	}
}

// Existing ParseFromQuery (used by other endpoints) must still default to 20.
func TestEventsPagination_DefaultParseFromQueryUnchanged(t *testing.T) {
	c := ginContextWithQuery("")
	p := pagination.ParseFromQuery(c)
	if p.Limit != pagination.DefaultLimit {
		t.Errorf("ParseFromQuery default limit = %d, want %d", p.Limit, pagination.DefaultLimit)
	}
}

// ─── pagination.BuildMeta ─────────────────────────────────────────────────────

func TestEventsPagination_BuildMetaShape(t *testing.T) {
	cases := []struct {
		name      string
		page      int
		limit     int
		total     int
		wantPages int
	}{
		{"zero results", 1, 100, 0, 1},
		{"exact fit", 1, 20, 20, 1},
		{"one over", 1, 20, 21, 2},
		{"multi-page", 3, 10, 123, 13},
		{"single result", 1, 100, 1, 1},
		{"default page max limit", 1, 100, 100, 1},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := pagination.Params{Page: tc.page, Limit: tc.limit}
			meta := pagination.BuildMeta(p, tc.total)

			if meta.Page != tc.page {
				t.Errorf("meta.Page = %d, want %d", meta.Page, tc.page)
			}
			if meta.Limit != tc.limit {
				t.Errorf("meta.Limit = %d, want %d", meta.Limit, tc.limit)
			}
			if meta.Total != tc.total {
				t.Errorf("meta.Total = %d, want %d", meta.Total, tc.total)
			}
			wantPages := int(math.Ceil(float64(tc.total) / float64(tc.limit)))
			if wantPages < 1 {
				wantPages = 1
			}
			if meta.TotalPages != wantPages {
				t.Errorf("meta.TotalPages = %d, want %d", meta.TotalPages, wantPages)
			}
		})
	}
}

// ─── pagination.Params.Offset ─────────────────────────────────────────────────

func TestEventsPagination_OffsetCalculation(t *testing.T) {
	cases := []struct{ page, limit, offset int }{
		{1, 100, 0},
		{2, 100, 100},
		{3, 20, 40},
		{1, 20, 0},
	}
	for _, tc := range cases {
		p := pagination.Params{Page: tc.page, Limit: tc.limit}
		if got := p.Offset(); got != tc.offset {
			t.Errorf("page=%d limit=%d → Offset()=%d, want %d", tc.page, tc.limit, got, tc.offset)
		}
	}
}

// ─── ListEvents role-visibility tests ────────────────────────────────────────
// The forbidden-role check fires BEFORE any repo call, so a nil-repo Service
// is safe for those tests.
// For owner/seller filter-modification tests we use the filterCapture helper.

// nilRepoService returns a *Service with a nil repo — safe only for tests that
// hit the role guard (which returns before calling the repo).
func nilRepoService() *Service {
	return &Service{repo: nil}
}

func TestEventsPagination_ForbiddenRolesReturnError(t *testing.T) {
	svc := nilRepoService()
	p := pagination.Params{Page: 1, Limit: 100}

	for _, role := range []string{"courier", "warehouse_manager", "dispatcher"} {
		_, _, err := svc.ListEvents(context.Background(), uuid.New(), role, FinancialEventFilter{}, p)
		if err == nil {
			t.Errorf("role %q: expected forbidden error, got nil", role)
		}
	}
}

// TestEventsPagination_FilterAppliedCorrectly tests the filter-mutation logic
// by calling applyEventRoleFilter — the pure helper extracted from ListEvents.
func TestEventsPagination_FilterAppliedCorrectly(t *testing.T) {
	ownerID := uuid.New()
	sellerID := uuid.New()

	cases := []struct {
		name             string
		role             string
		actorID          uuid.UUID
		wantIncludeComp  bool
		wantForcedUserID *uuid.UUID // nil means not forced
		wantErr          bool
	}{
		{
			name:            "owner sees all, no forced user_id",
			role:            "owner",
			actorID:         ownerID,
			wantIncludeComp: true,
			wantForcedUserID: nil,
		},
		{
			name:            "seller forced to self",
			role:            "seller",
			actorID:         sellerID,
			wantIncludeComp: false,
			wantForcedUserID: &sellerID,
		},
		{
			name:            "manager forced to self",
			role:            "manager",
			actorID:         sellerID,
			wantIncludeComp: false,
			wantForcedUserID: &sellerID,
		},
		{
			name:            "sales_team_lead forced to self",
			role:            "sales_team_lead",
			actorID:         sellerID,
			wantIncludeComp: false,
			wantForcedUserID: &sellerID,
		},
		{
			name:    "courier is forbidden",
			role:    "courier",
			actorID: uuid.New(),
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			filter := FinancialEventFilter{}
			err := applyEventRoleFilter(tc.actorID, tc.role, &filter)

			if tc.wantErr {
				if err == nil {
					t.Errorf("expected error for role %q, got nil", tc.role)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if filter.IncludeCompany != tc.wantIncludeComp {
				t.Errorf("IncludeCompany = %v, want %v", filter.IncludeCompany, tc.wantIncludeComp)
			}
			if tc.wantForcedUserID == nil {
				if filter.UserID != nil {
					t.Errorf("UserID should not be forced for owner, got %v", filter.UserID)
				}
			} else {
				if filter.UserID == nil || *filter.UserID != *tc.wantForcedUserID {
					t.Errorf("UserID = %v, want %v", filter.UserID, tc.wantForcedUserID)
				}
			}
		})
	}
}
