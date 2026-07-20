package teams

// service_test.go — IDOR scoping tests (DB-backed).
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Each test
// runs inside a rolled-back transaction so no manual cleanup is needed.
// Run with: DB_DSN=... go test ./internal/teams/ -v -run TestTeams

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/hierarchy"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

func alwaysExists(ctx context.Context, id uuid.UUID) (bool, error) { return true, nil }

func newTestService(db *gorm.DB) *Service {
	return NewService(NewRepository(db), alwaysExists)
}

// newTestServiceWithHierarchy wires a real hierarchy.Service against db and
// injects it into the teams.Service, exactly like main.go's
// teamSvc.SetHierarchyAssigner(hierarchySvc.AssignTeamID) — for tests that
// need to observe Create/Update's user_hierarchy sync side effect.
func newTestServiceWithHierarchy(db *gorm.DB) (*Service, *hierarchy.Service) {
	noBriefs := func(ctx context.Context, ids []uuid.UUID) ([]hierarchy.UserBrief, error) { return nil, nil }
	teamBrief := func(ctx context.Context, id uuid.UUID) (*hierarchy.TeamBrief, error) {
		var tm Team
		err := db.WithContext(ctx).Where("id = ? AND deleted_at IS NULL", id).First(&tm).Error
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil, nil
			}
			return nil, err
		}
		return &hierarchy.TeamBrief{ID: tm.ID, Name: tm.Name, TeamLeadID: tm.TeamLeadID, ManagerID: tm.ManagerID}, nil
	}
	hierarchySvc := hierarchy.NewService(hierarchy.NewRepository(db), alwaysExists, alwaysExists, noBriefs, teamBrief)

	teamSvc := newTestService(db)
	teamSvc.SetHierarchyAssigner(hierarchySvc.AssignTeamID)
	return teamSvc, hierarchySvc
}

func hierarchyTeamID(t *testing.T, db *gorm.DB, userID uuid.UUID) *uuid.UUID {
	t.Helper()
	var row struct{ TeamID *uuid.UUID }
	if err := db.Table("user_hierarchy").Select("team_id").Where("user_id = ?", userID).Take(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		t.Fatalf("read user_hierarchy for %s: %v", userID, err)
	}
	return row.TeamID
}

func createTeam(t *testing.T, db *gorm.DB, name string, teamLeadID, managerID *uuid.UUID) *Team {
	t.Helper()
	team := &Team{ID: uuid.New(), Name: name, TeamLeadID: teamLeadID, ManagerID: managerID, IsActive: true}
	if err := db.Create(team).Error; err != nil {
		t.Fatalf("testutil: create team: %v", err)
	}
	return team
}

func notFoundCode(t *testing.T, err error) apperrors.Code {
	t.Helper()
	ae, ok := err.(*apperrors.AppError)
	if !ok {
		t.Fatalf("expected *apperrors.AppError, got %T: %v", err, err)
	}
	return ae.Code
}

func TestTeams_Owner_CanAccessAnyTeam(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	owner := testutil.CreateUser(t, db, users.RoleOwner)
	lead := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	team := createTeam(t, db, "Team A", &lead.ID, nil)

	got, err := svc.GetByID(ctx, owner.ID, "owner", team.ID)
	if err != nil {
		t.Fatalf("owner GetByID: %v", err)
	}
	if got.ID != team.ID {
		t.Fatalf("got team %s, want %s", got.ID, team.ID)
	}

	list, _, err := svc.List(ctx, owner.ID, "owner", ListTeamsFilter{}, pagination.Params{Limit: 50})
	if err != nil {
		t.Fatalf("owner List: %v", err)
	}
	found := false
	for _, tm := range list {
		if tm.ID == team.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("owner's team list did not include the team")
	}
}

func TestTeams_TeamLead_CrossTeamAccessDenied(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	leadA := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	leadB := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	teamA := createTeam(t, db, "Team Lead A's Team", &leadA.ID, nil)
	teamB := createTeam(t, db, "Team Lead B's Team", &leadB.ID, nil)

	// Own team: allowed.
	got, err := svc.GetByID(ctx, leadA.ID, "sales_team_lead", teamA.ID)
	if err != nil {
		t.Fatalf("own team GetByID: %v", err)
	}
	if got.ID != teamA.ID {
		t.Fatalf("got team %s, want own team %s", got.ID, teamA.ID)
	}

	// Another lead's team: denied, as NotFound (not Forbidden) to avoid
	// confirming the team's existence to a caller outside its scope.
	_, err = svc.GetByID(ctx, leadA.ID, "sales_team_lead", teamB.ID)
	if err == nil {
		t.Fatal("expected cross-team GetByID to be denied")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}

	// List must not leak the other lead's team either.
	list, _, err := svc.List(ctx, leadA.ID, "sales_team_lead", ListTeamsFilter{}, pagination.Params{Limit: 50})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, tm := range list {
		if tm.ID == teamB.ID {
			t.Fatal("team lead's list leaked another team lead's team")
		}
	}
}

func TestTeams_Manager_CrossTeamAccessDenied(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	managerA := testutil.CreateUser(t, db, users.RoleManager)
	managerB := testutil.CreateUser(t, db, users.RoleManager)
	teamA := createTeam(t, db, "Manager A's Team", nil, &managerA.ID)
	teamB := createTeam(t, db, "Manager B's Team", nil, &managerB.ID)

	got, err := svc.GetByID(ctx, managerA.ID, "manager", teamA.ID)
	if err != nil {
		t.Fatalf("own team GetByID: %v", err)
	}
	if got.ID != teamA.ID {
		t.Fatalf("got team %s, want own team %s", got.ID, teamA.ID)
	}

	_, err = svc.GetByID(ctx, managerA.ID, "manager", teamB.ID)
	if err == nil {
		t.Fatal("expected cross-team GetByID to be denied")
	}
	if code := notFoundCode(t, err); code != apperrors.CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", code)
	}

	list, _, err := svc.List(ctx, managerA.ID, "manager", ListTeamsFilter{}, pagination.Params{Limit: 50})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, tm := range list {
		if tm.ID == teamB.ID {
			t.Fatal("manager's list leaked another manager's team")
		}
	}
}

// TestTeams_Create_SyncsManagerAndLeadHierarchy pins the fix for the bug
// where assigning a manager/lead through CreateTeamModal (POST /teams) left
// teams.manager_id/team_lead_id set but no corresponding user_hierarchy row
// — which made the manager show a correctly-resolved team with an
// eternally-empty roster (TeamProfilePage's counts, and every RBAC check
// gated on the caller's own hierarchy entry, read user_hierarchy only).
func TestTeams_Create_SyncsManagerAndLeadHierarchy(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := newTestServiceWithHierarchy(db)
	ctx := context.Background()

	lead := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	manager := testutil.CreateUser(t, db, users.RoleManager)

	team, err := svc.Create(ctx, CreateTeamRequest{Name: "Synced Team", TeamLeadID: &lead.ID, ManagerID: &manager.ID})
	if err != nil {
		t.Fatalf("create team: %v", err)
	}

	if got := hierarchyTeamID(t, db, lead.ID); got == nil || *got != team.ID {
		t.Fatalf("team lead hierarchy team_id = %v, want %s", got, team.ID)
	}
	if got := hierarchyTeamID(t, db, manager.ID); got == nil || *got != team.ID {
		t.Fatalf("manager hierarchy team_id = %v, want %s", got, team.ID)
	}
}

// TestTeams_Update_SyncsManagerHierarchy is the same fix, exercised via
// EditTeamModal's path (PATCH /teams/:id) — the exact flow from the bug
// report: a team created without a manager, then a manager assigned later
// through the team's own edit dialog.
func TestTeams_Update_SyncsManagerHierarchy(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := newTestServiceWithHierarchy(db)
	ctx := context.Background()

	manager := testutil.CreateUser(t, db, users.RoleManager)
	team := createTeam(t, db, "MegaMall", nil, nil)

	if got := hierarchyTeamID(t, db, manager.ID); got != nil {
		t.Fatalf("manager should start with no hierarchy team_id, got %v", got)
	}

	if _, err := svc.Update(ctx, team.ID, UpdateTeamRequest{ManagerID: &manager.ID}); err != nil {
		t.Fatalf("update team: %v", err)
	}

	if got := hierarchyTeamID(t, db, manager.ID); got == nil || *got != team.ID {
		t.Fatalf("manager hierarchy team_id after update = %v, want %s", got, team.ID)
	}
}

// TestTeams_Update_HierarchySyncPreservesExistingParent guards
// syncHierarchy's use of hierarchy.Service.AssignTeamID (not the more
// general Assign) — a manager who already has a parent_id (e.g. reports to
// a sales_team_lead elsewhere in the org chart) must not have that
// relationship silently cleared just because their own team assigned them
// as its manager.
func TestTeams_Update_HierarchySyncPreservesExistingParent(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, hierarchySvc := newTestServiceWithHierarchy(db)
	ctx := context.Background()

	parent := testutil.CreateUser(t, db, users.RoleSalesTeamLead)
	manager := testutil.CreateUser(t, db, users.RoleManager)
	team := createTeam(t, db, "MegaMall", nil, nil)

	if _, err := hierarchySvc.Assign(ctx, hierarchy.AssignRequest{UserID: manager.ID, ParentID: &parent.ID}); err != nil {
		t.Fatalf("seed parent assignment: %v", err)
	}

	if _, err := svc.Update(ctx, team.ID, UpdateTeamRequest{ManagerID: &manager.ID}); err != nil {
		t.Fatalf("update team: %v", err)
	}

	var row struct {
		TeamID   *uuid.UUID
		ParentID *uuid.UUID
	}
	if err := db.Table("user_hierarchy").Select("team_id, parent_id").Where("user_id = ?", manager.ID).Take(&row).Error; err != nil {
		t.Fatalf("read user_hierarchy: %v", err)
	}
	if row.TeamID == nil || *row.TeamID != team.ID {
		t.Fatalf("team_id = %v, want %s", row.TeamID, team.ID)
	}
	if row.ParentID == nil || *row.ParentID != parent.ID {
		t.Fatalf("parent_id = %v, want preserved %s", row.ParentID, parent.ID)
	}
}

// TestTeams_Update_DeactivatePersists pins the fix for Repository.Update's
// zero-value bug: GORM's struct-based Updates silently skipped
// IsActive=false (the zero value for a bare bool), so unchecking "Активна"
// in EditTeamModal looked successful in the UI (toast + 200 response) but
// never reached the database.
func TestTeams_Update_DeactivatePersists(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := newTestService(db)
	ctx := context.Background()

	team := createTeam(t, db, "MegaMall", nil, nil)

	inactive := false
	updated, err := svc.Update(ctx, team.ID, UpdateTeamRequest{IsActive: &inactive})
	if err != nil {
		t.Fatalf("update team: %v", err)
	}
	if updated.IsActive {
		t.Fatal("in-memory result: expected IsActive=false")
	}

	reloaded, err := svc.repo.GetByID(ctx, team.ID)
	if err != nil {
		t.Fatalf("reload team: %v", err)
	}
	if reloaded.IsActive {
		t.Fatal("is_active=false did not persist to the database (GORM zero-value skip)")
	}
}
