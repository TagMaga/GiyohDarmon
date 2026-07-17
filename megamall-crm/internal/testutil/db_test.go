package testutil

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/jackc/pgx/v5"
)

// These tests exercise setupDisposableDB directly (not through a package's
// TestMain) so they can provision, inspect, and tear down independently —
// verifying the actual safety properties Phase 0 is for, not just that the
// happy path compiles.

func TestSetupDisposableDB_RequiresAdminDSN(t *testing.T) {
	t.Setenv("TEST_ADMIN_DSN", "")

	_, err := setupDisposableDB()
	if err == nil {
		t.Fatal("expected an error when TEST_ADMIN_DSN is unset, got nil")
	}
}

func TestSetupDisposableDB_UniquePerCall(t *testing.T) {
	requireAdminDSN(t)

	cleanup1, err := setupDisposableDB()
	if err != nil {
		t.Fatalf("first setupDisposableDB: %v", err)
	}
	db1 := DB(t)
	var name1 string
	if err := db1.Raw("SELECT current_database()").Scan(&name1).Error; err != nil {
		cleanup1()
		t.Fatalf("query current_database (1): %v", err)
	}

	cleanup2, err := setupDisposableDB()
	if err != nil {
		cleanup1()
		t.Fatalf("second setupDisposableDB: %v", err)
	}
	db2 := DB(t)
	var name2 string
	if err := db2.Raw("SELECT current_database()").Scan(&name2).Error; err != nil {
		cleanup1()
		cleanup2()
		t.Fatalf("query current_database (2): %v", err)
	}

	cleanup2()
	cleanup1()

	if name1 == name2 {
		t.Fatalf("expected two calls to setupDisposableDB to provision different databases, both got %q", name1)
	}
	if name1 == "postgres" || name2 == "postgres" || name1 == "" || name2 == "" {
		t.Fatalf("disposable database names look wrong: %q, %q", name1, name2)
	}
}

func TestSetupDisposableDB_RoleCannotEscalate(t *testing.T) {
	requireAdminDSN(t)

	cleanup, err := setupDisposableDB()
	if err != nil {
		t.Fatalf("setupDisposableDB: %v", err)
	}
	defer cleanup()

	db := DB(t)
	var isSuper, canCreateDB, canCreateRole bool
	err = db.Raw(`
		SELECT rolsuper, rolcreatedb, rolcreaterole
		FROM pg_roles
		WHERE rolname = current_user
	`).Row().Scan(&isSuper, &canCreateDB, &canCreateRole)
	if err != nil {
		t.Fatalf("query pg_roles for current_user: %v", err)
	}
	if isSuper || canCreateDB || canCreateRole {
		t.Fatalf("disposable role has escalated privileges: super=%v createdb=%v createrole=%v", isSuper, canCreateDB, canCreateRole)
	}
}

func TestSetupDisposableDB_CleanupDropsDatabaseAndRole(t *testing.T) {
	requireAdminDSN(t)

	cleanup, err := setupDisposableDB()
	if err != nil {
		t.Fatalf("setupDisposableDB: %v", err)
	}
	db := DB(t)
	var dbName, roleName string
	if err := db.Raw("SELECT current_database(), current_user").Row().Scan(&dbName, &roleName); err != nil {
		cleanup()
		t.Fatalf("query current_database/current_user: %v", err)
	}

	cleanup()

	adminDSN, err := adminDSNForTest(t)
	if err != nil {
		t.Fatalf("re-derive admin DSN: %v", err)
	}
	ctx := context.Background()
	adminCfg, err := pgx.ParseConfig(adminDSN)
	if err != nil {
		t.Fatalf("parse admin DSN: %v", err)
	}
	conn, err := pgx.ConnectConfig(ctx, adminCfg)
	if err != nil {
		t.Fatalf("reconnect as admin: %v", err)
	}
	defer conn.Close(ctx)

	var dbExists bool
	if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", dbName).Scan(&dbExists); err != nil {
		t.Fatalf("check pg_database: %v", err)
	}
	if dbExists {
		t.Errorf("database %q still exists after cleanup", dbName)
	}

	var roleExists bool
	if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)", roleName).Scan(&roleExists); err != nil {
		t.Fatalf("check pg_roles: %v", err)
	}
	if roleExists {
		t.Errorf("role %q still exists after cleanup", roleName)
	}
}

// TestCompileOnly_NeverRequiresAdminDSN is a regression test for the exact
// incident this guards against: deploy.yml's "Compile all backend
// packages" step runs `go test -run '^$' ./...` with no TEST_ADMIN_DSN and
// no database at all — it exists purely to catch _test.go compile errors
// before shipping, not to run anything. TestMain executes unconditionally
// regardless of -run (that's a Go runtime fact, not a choice this package
// makes), so without compileOnly's guard this would fail on a missing
// TEST_ADMIN_DSN despite selecting zero tests — which is exactly what broke
// the first production deploy attempt after this package's own guard was
// introduced. This spawns a real `go test -run '^$'` subprocess (the only
// way to observe compileOnly's actual behavior, since it reads the live
// process's own flags) against internal/media, a real package with a
// TestMain wired to testutil.Main.
func TestCompileOnly_NeverRequiresAdminDSN(t *testing.T) {
	if testing.Short() {
		t.Skip("spawns a go test subprocess; skipped in -short")
	}

	repoRoot := repoRootForTest(t)

	cmd := exec.Command("go", "test", "-run", "^$", "./internal/media/...")
	cmd.Dir = repoRoot
	cmd.Env = append(os.Environ(), "TEST_ADMIN_DSN=", "CGO_ENABLED=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("`go test -run '^$' ./internal/media/...` with no TEST_ADMIN_DSN must succeed (compile-only, no tests selected), got: %v\n%s", err, out)
	}
}

// repoRootForTest locates the megamall-crm module root the same way
// migrationsDir does — anchored to this source file's own path, stable
// regardless of the test binary's working directory.
func repoRootForTest(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// this file is internal/testutil/db_test.go — module root is two levels up.
	return filepath.Join(filepath.Dir(thisFile), "..", "..")
}

func requireAdminDSN(t *testing.T) {
	t.Helper()
	if _, err := adminDSNForTest(t); err != nil {
		t.Skipf("TEST_ADMIN_DSN not usable, skipping: %v", err)
	}
}

// adminDSNForTest reads TEST_ADMIN_DSN directly so tests can produce a clear
// skip reason when it's absent, rather than failing outright.
func adminDSNForTest(t *testing.T) (string, error) {
	t.Helper()
	dsn := os.Getenv("TEST_ADMIN_DSN")
	if dsn == "" {
		return "", fmt.Errorf("TEST_ADMIN_DSN is not set")
	}
	return dsn, nil
}
