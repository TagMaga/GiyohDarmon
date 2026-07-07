package auth

// service_test.go — Deactivated/deleted-user access tests (DB-backed).
//
// Requires a real Postgres DB via DB_DSN (see internal/testutil). Each test
// runs inside a rolled-back transaction so no manual cleanup is needed.
// Run with: DB_DSN=... go test ./internal/auth/ -v -run TestAuth

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"gorm.io/gorm"
)

func testJWTConfig() config.JWTConfig {
	return config.JWTConfig{
		AccessSecret:    "test-access-secret",
		RefreshSecret:   "test-refresh-secret",
		AccessTokenTTL:  time.Hour,
		RefreshTokenTTL: 24 * time.Hour,
	}
}

// newTestAuthService wires an auth.Service against the given tx, with the
// active-checker reading live is_active/deleted_at state — mirrors main.go.
func newTestAuthService(db *gorm.DB) (*Service, *users.Repository) {
	userRepo := users.NewRepository(db)
	authRepo := NewRepository(db)

	userByPhone := func(ctx context.Context, phone string) (*users.User, error) {
		return userRepo.GetByPhone(ctx, phone)
	}
	teamForUser := func(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error) {
		return nil, nil
	}

	svc := NewService(authRepo, testJWTConfig(), userByPhone, teamForUser)
	svc.SetRoleResolver(func(ctx context.Context, userID uuid.UUID) (users.Role, error) {
		u, err := userRepo.GetByID(ctx, userID)
		if err != nil {
			return "", err
		}
		if u == nil {
			return "", apperrors.NotFound("user")
		}
		return u.Role, nil
	})
	svc.SetActiveChecker(func(ctx context.Context, userID uuid.UUID) (bool, error) {
		u, err := userRepo.GetByID(ctx, userID)
		if err != nil {
			return false, err
		}
		if u == nil {
			return false, nil
		}
		return u.IsActive, nil
	})

	return svc, userRepo
}

func deactivate(t *testing.T, db *gorm.DB, userID uuid.UUID) {
	t.Helper()
	if err := db.Model(&users.User{}).Where("id = ?", userID).Update("is_active", false).Error; err != nil {
		t.Fatalf("deactivate user: %v", err)
	}
}

func appErrorCode(t *testing.T, err error) apperrors.Code {
	t.Helper()
	ae, ok := err.(*apperrors.AppError)
	if !ok {
		t.Fatalf("expected *apperrors.AppError, got %T: %v", err, err)
	}
	return ae.Code
}

func TestAuth_ValidateAccessToken_InactiveUserRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := newTestAuthService(db)
	ctx := context.Background()

	u := testutil.CreateUser(t, db, users.RoleSeller)
	pair, err := svc.issueTokenPair(ctx, u.ID, u.Role, nil, uuid.New(), "127.0.0.1", "test-agent")
	if err != nil {
		t.Fatalf("issueTokenPair: %v", err)
	}

	if _, err := svc.ValidateAccessToken(ctx, pair.AccessToken); err != nil {
		t.Fatalf("expected active user's token to validate, got: %v", err)
	}

	deactivate(t, db, u.ID)

	_, err = svc.ValidateAccessToken(ctx, pair.AccessToken)
	if err == nil {
		t.Fatal("expected inactive user's access token to be rejected")
	}
	if code := appErrorCode(t, err); code != apperrors.CodeUserInactive {
		t.Fatalf("expected CodeUserInactive, got %s", code)
	}
}

func TestAuth_ValidateAccessToken_DeletedUserRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, userRepo := newTestAuthService(db)
	ctx := context.Background()

	u := testutil.CreateUser(t, db, users.RoleSeller)
	pair, err := svc.issueTokenPair(ctx, u.ID, u.Role, nil, uuid.New(), "127.0.0.1", "test-agent")
	if err != nil {
		t.Fatalf("issueTokenPair: %v", err)
	}

	if err := userRepo.SoftDelete(ctx, u.ID); err != nil {
		t.Fatalf("soft delete user: %v", err)
	}

	_, err = svc.ValidateAccessToken(ctx, pair.AccessToken)
	if err == nil {
		t.Fatal("expected deleted user's access token to be rejected")
	}
	if code := appErrorCode(t, err); code != apperrors.CodeUserInactive {
		t.Fatalf("expected CodeUserInactive, got %s", code)
	}
}

func TestAuth_Refresh_InactiveUserRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, _ := newTestAuthService(db)
	ctx := context.Background()

	u := testutil.CreateUser(t, db, users.RoleSeller)
	pair, err := svc.issueTokenPair(ctx, u.ID, u.Role, nil, uuid.New(), "127.0.0.1", "test-agent")
	if err != nil {
		t.Fatalf("issueTokenPair: %v", err)
	}

	deactivate(t, db, u.ID)

	_, err = svc.Refresh(ctx, pair.RefreshToken, "127.0.0.1", "test-agent")
	if err == nil {
		t.Fatal("expected inactive user's refresh token to be rejected")
	}
	if code := appErrorCode(t, err); code != apperrors.CodeUserInactive {
		t.Fatalf("expected CodeUserInactive, got %s", code)
	}
}

func TestAuth_DeactivationRevokesSessions(t *testing.T) {
	db := testutil.NewTestDB(t)
	authSvc, userRepo := newTestAuthService(db)
	ctx := context.Background()

	usersSvc := users.NewService(userRepo)
	usersSvc.SetSessionRevoker(authSvc.Logout)

	u := testutil.CreateUser(t, db, users.RoleSeller)
	if _, err := authSvc.issueTokenPair(ctx, u.ID, u.Role, nil, uuid.New(), "127.0.0.1", "device-a"); err != nil {
		t.Fatalf("issueTokenPair: %v", err)
	}
	if _, err := authSvc.issueTokenPair(ctx, u.ID, u.Role, nil, uuid.New(), "127.0.0.1", "device-b"); err != nil {
		t.Fatalf("issueTokenPair: %v", err)
	}

	inactive := false
	if _, err := usersSvc.Update(ctx, u.ID, users.UpdateUserRequest{IsActive: &inactive}); err != nil {
		t.Fatalf("Update: %v", err)
	}

	var count int64
	if err := db.Model(&RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", u.ID).
		Count(&count).Error; err != nil {
		t.Fatalf("count active tokens: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0 active refresh tokens after deactivation, got %d", count)
	}
}

func TestAuth_DeleteRevokesSessions(t *testing.T) {
	db := testutil.NewTestDB(t)
	authSvc, userRepo := newTestAuthService(db)
	ctx := context.Background()

	usersSvc := users.NewService(userRepo)
	usersSvc.SetSessionRevoker(authSvc.Logout)

	u := testutil.CreateUser(t, db, users.RoleSeller)
	if _, err := authSvc.issueTokenPair(ctx, u.ID, u.Role, nil, uuid.New(), "127.0.0.1", "device-a"); err != nil {
		t.Fatalf("issueTokenPair: %v", err)
	}

	if err := usersSvc.Delete(ctx, u.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	var count int64
	if err := db.Model(&RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", u.ID).
		Count(&count).Error; err != nil {
		t.Fatalf("count active tokens: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0 active refresh tokens after delete, got %d", count)
	}
}
