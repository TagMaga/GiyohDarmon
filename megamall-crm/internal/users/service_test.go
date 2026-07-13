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

func TestUsers_Update_PasswordReset_ChangesHashWithoutCurrentPassword(t *testing.T) {
	db := newTestDB(t)
	repo := NewRepository(db)
	svc := NewService(repo)
	ctx := context.Background()

	owner := createTestUser(t, db, RoleOwner)
	target := createTestUser(t, db, RoleSeller)
	originalHash := target.PasswordHash

	newPassword := "brand-new-pass"
	if _, err := svc.Update(ctx, target.ID, UpdateUserRequest{NewPassword: &newPassword}, owner.ID); err != nil {
		t.Fatalf("Update with new_password: %v", err)
	}

	reloaded, err := repo.GetByID(ctx, target.ID)
	if err != nil {
		t.Fatalf("reload target user: %v", err)
	}
	if reloaded.PasswordHash == originalHash {
		t.Fatal("password hash unchanged after reset")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(reloaded.PasswordHash), []byte(newPassword)); err != nil {
		t.Fatalf("new password does not match stored hash: %v", err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(reloaded.PasswordHash), []byte("testpass")); err == nil {
		t.Fatal("old password still matches stored hash after reset")
	}
}

// Password reset alongside other profile fields must be one atomic update —
// there is no scenario where the profile fields save but the password
// silently doesn't (or vice versa), since both are set on the same struct
// before the single repo.Update call.
func TestUsers_Update_PasswordReset_AtomicWithOtherFields(t *testing.T) {
	db := newTestDB(t)
	repo := NewRepository(db)
	svc := NewService(repo)
	ctx := context.Background()

	owner := createTestUser(t, db, RoleOwner)
	target := createTestUser(t, db, RoleSeller)

	newPassword := "brand-new-pass"
	newName := "Updated Name"
	updated, err := svc.Update(ctx, target.ID, UpdateUserRequest{FullName: &newName, NewPassword: &newPassword}, owner.ID)
	if err != nil {
		t.Fatalf("Update with new_password + full_name: %v", err)
	}
	if updated.FullName != newName {
		t.Errorf("full_name = %q, want %q", updated.FullName, newName)
	}

	reloaded, err := repo.GetByID(ctx, target.ID)
	if err != nil {
		t.Fatalf("reload target user: %v", err)
	}
	if reloaded.FullName != newName {
		t.Errorf("reloaded full_name = %q, want %q", reloaded.FullName, newName)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(reloaded.PasswordHash), []byte(newPassword)); err != nil {
		t.Fatalf("new password does not match stored hash: %v", err)
	}
}

func TestUsers_Update_PasswordReset_RecordsHistoryWithoutPassword(t *testing.T) {
	db := newTestDB(t)
	repo := NewRepository(db)
	svc := NewService(repo)
	ctx := context.Background()

	owner := createTestUser(t, db, RoleOwner)
	target := createTestUser(t, db, RoleSeller)

	newPassword := "brand-new-pass"
	if _, err := svc.Update(ctx, target.ID, UpdateUserRequest{NewPassword: &newPassword}, owner.ID); err != nil {
		t.Fatalf("Update with new_password: %v", err)
	}

	history, err := repo.ListHistory(ctx, target.ID)
	if err != nil {
		t.Fatalf("list history: %v", err)
	}
	if len(history) != 1 {
		t.Fatalf("history entries = %d, want 1", len(history))
	}
	entry := history[0]
	if entry.FieldName != "password_reset" {
		t.Errorf("field_name = %q, want password_reset", entry.FieldName)
	}
	if entry.OldValue != nil || entry.NewValue != nil {
		t.Errorf("history should never store password values, got old=%v new=%v", entry.OldValue, entry.NewValue)
	}
	if entry.ChangedBy == nil || *entry.ChangedBy != owner.ID {
		t.Errorf("changed_by = %v, want %s", entry.ChangedBy, owner.ID)
	}
}

func TestUsers_Update_PasswordReset_UnknownUserNotFound(t *testing.T) {
	db := newTestDB(t)
	repo := NewRepository(db)
	svc := NewService(repo)
	ctx := context.Background()

	owner := createTestUser(t, db, RoleOwner)

	newPassword := "brand-new-pass"
	_, err := svc.Update(ctx, uuid.New(), UpdateUserRequest{NewPassword: &newPassword}, owner.ID)
	if err == nil {
		t.Fatal("expected error for unknown user, got nil")
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
