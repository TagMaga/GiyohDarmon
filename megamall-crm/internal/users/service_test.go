package users

// service_test.go — Hierarchy cleanup on deactivate/delete tests (DB-backed).
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Runs
// inside a rolled-back transaction so no manual cleanup is needed.
// Run with: DB_DSN=... go test ./internal/users/ -v -run TestUsers

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// internal/testutil can't be used here: it imports internal/users (to build
// users.User fixtures), so a test in package users importing testutil would
// create an import cycle. Mirror the bits needed (a rolled-back tx + a user
// fixture) locally instead.

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		t.Skip("DB_DSN not set — skipping DB-backed test")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("connect to DB: %v", err)
	}
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatalf("begin transaction: %v", tx.Error)
	}
	t.Cleanup(func() { tx.Rollback() })
	return tx
}

var testPhoneCounter atomic.Uint64

func createTestUser(t *testing.T, db *gorm.DB, role Role) *User {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("testpass"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	seq := testPhoneCounter.Add(1)
	u := &User{
		ID:           uuid.New(),
		Phone:        fmt.Sprintf("+4%09d", seq%1_000_000_000),
		PasswordHash: string(hash),
		FullName:     "Test " + string(role),
		Role:         role,
		IsActive:     true,
	}
	if err := db.Create(u).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u
}

// assignHierarchy inserts a raw user_hierarchy row (userID -> parentID/teamID)
// without going through the hierarchy module, to keep this test independent
// of internal/hierarchy (which internal/orders imports internal/teams and
// this package, so importing hierarchy here risks a cycle down the line).
func assignHierarchy(t *testing.T, repo *Repository, userID uuid.UUID, parentID *uuid.UUID) {
	t.Helper()
	db := repo.db
	err := db.Exec(
		`INSERT INTO user_hierarchy (id, user_id, parent_id) VALUES (?, ?, ?)`,
		uuid.New(), userID, parentID,
	).Error
	if err != nil {
		t.Fatalf("assign hierarchy: %v", err)
	}
}

func parentIDFor(t *testing.T, repo *Repository, userID uuid.UUID) *uuid.UUID {
	t.Helper()
	var row struct{ ParentID *uuid.UUID }
	if err := repo.db.Table("user_hierarchy").Select("parent_id").
		Where("user_id = ?", userID).Take(&row).Error; err != nil {
		t.Fatalf("read hierarchy row: %v", err)
	}
	return row.ParentID
}

func TestUsers_Deactivate_ClearsHierarchyParentReferences(t *testing.T) {
	db := newTestDB(t)
	repo := NewRepository(db)
	svc := NewService(repo)
	ctx := context.Background()

	manager := createTestUser(t, db, RoleManager)
	seller := createTestUser(t, db, RoleSeller)
	assignHierarchy(t, repo, seller.ID, &manager.ID)

	if got := parentIDFor(t, repo, seller.ID); got == nil || *got != manager.ID {
		t.Fatalf("fixture setup: seller's parent_id = %v, want %s", got, manager.ID)
	}

	inactive := false
	if _, err := svc.Update(ctx, manager.ID, UpdateUserRequest{IsActive: &inactive}); err != nil {
		t.Fatalf("deactivate manager: %v", err)
	}

	if got := parentIDFor(t, repo, seller.ID); got != nil {
		t.Fatalf("seller's parent_id after manager deactivation = %v, want nil (cleared)", *got)
	}
}

func TestUsers_Delete_ClearsHierarchyParentReferences(t *testing.T) {
	db := newTestDB(t)
	repo := NewRepository(db)
	svc := NewService(repo)
	ctx := context.Background()

	lead := createTestUser(t, db, RoleSalesTeamLead)
	seller := createTestUser(t, db, RoleSeller)
	assignHierarchy(t, repo, seller.ID, &lead.ID)

	if err := svc.Delete(ctx, lead.ID); err != nil {
		t.Fatalf("delete team lead: %v", err)
	}

	if got := parentIDFor(t, repo, seller.ID); got != nil {
		t.Fatalf("seller's parent_id after team lead delete = %v, want nil (cleared)", *got)
	}
}

func TestUsers_GetByIDs_ExcludesDeactivatedAndDeleted(t *testing.T) {
	db := newTestDB(t)
	repo := NewRepository(db)
	svc := NewService(repo)
	ctx := context.Background()

	active := createTestUser(t, db, RoleSeller)
	deactivated := createTestUser(t, db, RoleSeller)
	deleted := createTestUser(t, db, RoleSeller)

	inactive := false
	if _, err := svc.Update(ctx, deactivated.ID, UpdateUserRequest{IsActive: &inactive}); err != nil {
		t.Fatalf("deactivate user: %v", err)
	}
	if err := svc.Delete(ctx, deleted.ID); err != nil {
		t.Fatalf("delete user: %v", err)
	}

	list, err := repo.GetByIDs(ctx, []uuid.UUID{active.ID, deactivated.ID, deleted.ID})
	if err != nil {
		t.Fatalf("GetByIDs: %v", err)
	}

	seen := map[uuid.UUID]bool{}
	for _, u := range list {
		seen[u.ID] = true
	}
	if !seen[active.ID] {
		t.Fatal("expected active user to be included")
	}
	if seen[deactivated.ID] {
		t.Fatal("expected deactivated user to be excluded — must not remain visible as a team member")
	}
	if seen[deleted.ID] {
		t.Fatal("expected deleted user to be excluded — must not remain visible as a team member")
	}
}
