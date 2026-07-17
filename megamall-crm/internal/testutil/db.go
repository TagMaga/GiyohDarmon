package testutil

// db.go — Test database helpers.
//
// Usage: each package with DB-backed tests needs its own TestMain:
//
//	func TestMain(m *testing.M) { os.Exit(testutil.Main(m)) }
//
// Then in tests:
//
//	db := testutil.NewTestDB(t)   // opens a tx; rolls back on t.Cleanup
//	user := testutil.CreateUser(t, db, "seller")
//
// Main provisions one disposable PostgreSQL database and one disposable,
// non-superuser role for the lifetime of that test binary, then drops both
// when the binary exits. The connection comes exclusively from
// TEST_ADMIN_DSN via pkg/dbsafety — never from DB_DSN, which is also what a
// production deploy uses. See pkg/dbsafety's doc comment: this split exists
// because a prior scratch test pointed a connection string at the live
// production role and mutated its password directly, causing an outage.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/megamall/crm/pkg/dbsafety"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var (
	globalDB *gorm.DB
	globalMu sync.RWMutex
)

// Main provisions a single disposable database + disposable role for the
// lifetime of one `go test` process (one package's test binary), runs
// m.Run(), then unconditionally drops both — even on panic/failure, via
// defer. Every package with DB-backed tests must call this from its own
// TestMain (see package doc comment above). A package that never calls Main
// gets a clear failure from DB/NewTestDB rather than silently reusing
// another package's connection or falling back to anything shared.
func Main(m *testing.M) int {
	cleanup, err := setupDisposableDB()
	if err != nil {
		fmt.Fprintf(os.Stderr, "testutil: %v\n", err)
		return 1
	}
	defer cleanup()
	return m.Run()
}

func setupDisposableDB() (cleanup func(), err error) {
	ctx := context.Background()

	adminDSN, err := dbsafety.AdminDSN()
	if err != nil {
		return nil, err
	}

	adminCfg, err := pgx.ParseConfig(adminDSN)
	if err != nil {
		return nil, fmt.Errorf("testutil: parse %s: %w", dbsafety.EnvAdminDSN, err)
	}

	adminConn, err := pgx.ConnectConfig(ctx, adminCfg)
	if err != nil {
		return nil, fmt.Errorf("testutil: connect to disposable-DB admin instance: %w", err)
	}

	dbToken, err1 := dbsafety.RandomToken(6)
	roleToken, err2 := dbsafety.RandomToken(6)
	password, err3 := dbsafety.RandomToken(24)
	if err := firstNonNil(err1, err2, err3); err != nil {
		adminConn.Close(ctx)
		return nil, err
	}

	// Pure "prefix + lowercase hex" — never derived from any external
	// input, so this can never be used to inject SQL. Still sanitized as an
	// identifier below, for defense in depth.
	dbName := "megamall_test_" + dbToken
	roleName := "test_role_" + roleToken

	if verifyErr := dbsafety.AssertNotProduction(fmt.Sprintf("host=%s port=%d dbname=%s user=%s", adminCfg.Host, adminCfg.Port, dbName, roleName)); verifyErr != nil {
		adminConn.Close(ctx)
		return nil, fmt.Errorf("testutil: refusing to provision disposable database: %w", verifyErr)
	}

	quotedRole := pgx.Identifier{roleName}.Sanitize()
	quotedDB := pgx.Identifier{dbName}.Sanitize()

	teardown := func() {
		// Best-effort: this DB/role were never used by anything but this
		// process, so failures here just leave disposable, uniquely-named
		// clutter behind — never a shared or production object.
		_, _ = adminConn.Exec(ctx, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, dbName)
		_, _ = adminConn.Exec(ctx, "DROP DATABASE IF EXISTS "+quotedDB)
		_, _ = adminConn.Exec(ctx, "DROP ROLE IF EXISTS "+quotedRole)
		adminConn.Close(ctx)
	}

	// NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION: this role can never
	// escalate to manage other roles/databases, only operate inside the one
	// disposable database it owns. password is pure hex (RandomToken), so
	// it can never break out of the single-quoted literal.
	if _, execErr := adminConn.Exec(ctx, fmt.Sprintf(
		"CREATE ROLE %s LOGIN PASSWORD '%s' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION",
		quotedRole, password,
	)); execErr != nil {
		teardown()
		return nil, fmt.Errorf("testutil: create disposable role: %w", execErr)
	}

	if _, execErr := adminConn.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s OWNER %s", quotedDB, quotedRole)); execErr != nil {
		teardown()
		return nil, fmt.Errorf("testutil: create disposable database: %w", execErr)
	}

	if _, execErr := adminConn.Exec(ctx, "REVOKE ALL ON DATABASE "+quotedDB+" FROM PUBLIC"); execErr != nil {
		teardown()
		return nil, fmt.Errorf("testutil: restrict disposable database to its owner: %w", execErr)
	}

	// CREATE EXTENSION and (on some Postgres versions) ownership of the
	// public schema require privileges the disposable, non-superuser role
	// deliberately doesn't have — do this once via the admin connection,
	// then hand off to the disposable role for the actual migrations.
	if execErr := prepareSchema(ctx, adminCfg, dbName, quotedRole); execErr != nil {
		teardown()
		return nil, execErr
	}

	disposableCfg := adminCfg.Copy()
	disposableCfg.Database = dbName
	disposableCfg.User = roleName
	disposableCfg.Password = password

	if verifyErr := dbsafety.AssertNotProduction(disposableCfg.ConnString()); verifyErr != nil {
		teardown()
		return nil, fmt.Errorf("testutil: refusing disposable connection: %w", verifyErr)
	}

	sqlDB := stdlib.OpenDB(*disposableCfg)

	dir, dirErr := migrationsDir()
	if dirErr != nil {
		sqlDB.Close()
		teardown()
		return nil, dirErr
	}

	goose.SetLogger(goose.NopLogger())
	if dialectErr := goose.SetDialect("postgres"); dialectErr != nil {
		sqlDB.Close()
		teardown()
		return nil, fmt.Errorf("testutil: set goose dialect: %w", dialectErr)
	}
	if upErr := goose.Up(sqlDB, dir); upErr != nil {
		sqlDB.Close()
		teardown()
		return nil, fmt.Errorf("testutil: run migrations on disposable database: %w", upErr)
	}

	db, openErr := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if openErr != nil {
		sqlDB.Close()
		teardown()
		return nil, fmt.Errorf("testutil: open gorm over disposable database: %w", openErr)
	}

	globalMu.Lock()
	globalDB = db
	globalMu.Unlock()

	return func() {
		globalMu.Lock()
		globalDB = nil
		globalMu.Unlock()
		sqlDB.Close()
		teardown()
	}, nil
}

// prepareSchema connects to the freshly created dbName as admin (not the
// disposable role) to create the pgcrypto extension migration 00001 needs
// and to make sure the disposable role owns the public schema it will run
// every migration's DDL against.
func prepareSchema(ctx context.Context, adminCfg *pgx.ConnConfig, dbName string, quotedRole string) error {
	cfg := adminCfg.Copy()
	cfg.Database = dbName

	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("testutil: connect to disposable database as admin: %w", err)
	}
	defer conn.Close(ctx)

	if _, err := conn.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS pgcrypto"); err != nil {
		return fmt.Errorf("testutil: create pgcrypto extension: %w", err)
	}
	if _, err := conn.Exec(ctx, "ALTER SCHEMA public OWNER TO "+quotedRole); err != nil {
		return fmt.Errorf("testutil: grant public schema ownership: %w", err)
	}
	return nil
}

func migrationsDir() (string, error) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("testutil: locate migrations directory: runtime.Caller failed")
	}
	// this file lives at internal/testutil/db.go — migrations/ is two
	// levels up, anchored to the source file's own path so it's stable
	// regardless of which package's test binary (and thus working
	// directory) calls Main.
	dir := filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations")
	if _, statErr := os.Stat(dir); statErr != nil {
		return "", fmt.Errorf("testutil: migrations directory not found at %s: %w", dir, statErr)
	}
	return dir, nil
}

func firstNonNil(errs ...error) error {
	for _, e := range errs {
		if e != nil {
			return e
		}
	}
	return nil
}

// DB returns the disposable *gorm.DB provisioned by Main for this test
// binary. Fails the test immediately if Main was never called for this
// package.
func DB(t *testing.T) *gorm.DB {
	t.Helper()
	globalMu.RLock()
	db := globalDB
	globalMu.RUnlock()
	if db == nil {
		t.Fatal("testutil: no disposable database provisioned for this package — add:\n\n" +
			"\tfunc TestMain(m *testing.M) { os.Exit(testutil.Main(m)) }\n")
	}
	return db
}

// NewTestDB wraps every test in a transaction that is automatically rolled back
// when the test ends. All operations done on the returned *gorm.DB run inside
// that transaction, so the database is left clean after each test even though
// the underlying disposable database itself persists for the whole test binary.
func NewTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := DB(t)

	tx := db.Begin()
	if tx.Error != nil {
		t.Fatalf("testutil: begin transaction: %v", tx.Error)
	}

	t.Cleanup(func() {
		tx.Rollback() //nolint:errcheck
	})

	return tx
}
