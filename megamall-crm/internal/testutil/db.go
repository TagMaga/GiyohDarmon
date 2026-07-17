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
// Main just runs m.Run(), then drops the disposable database + role if any
// test actually used one during that run — see DB's doc comment for why
// provisioning is lazy (triggered by the first test that calls DB/NewTestDB)
// rather than eager. The connection comes exclusively from TEST_ADMIN_DSN
// via pkg/dbsafety — never from DB_DSN, which is also what a production
// deploy uses. See pkg/dbsafety's doc comment: this split exists because a
// prior scratch test pointed a connection string at the live production
// role and mutated its password directly, causing an outage.

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
	globalDB      *gorm.DB
	globalErr     error
	globalCleanup func()
	globalOnce    sync.Once
	globalStateMu sync.Mutex
)

// Main runs m.Run(), then unconditionally drops the disposable database +
// role if DB/NewTestDB provisioned one during the run — even on
// panic/failure, via defer. Every package with DB-backed tests must call
// this from its own TestMain:
//
//	func TestMain(m *testing.M) { os.Exit(testutil.Main(m)) }
//
// Provisioning is deliberately lazy (see DB), so calling Main costs nothing
// extra for a test binary whose selected tests never touch the database —
// e.g. `go test -run '^$'` (compile-check only) or a -run pattern that
// names only DB-independent tests, both of which deploy.yml's pipeline
// actually does. TestMain itself always executes regardless of -run (a Go
// runtime fact, not a choice made here) — what varies is only whether any
// individual test body goes on to call DB/NewTestDB.
func Main(m *testing.M) int {
	code := m.Run()

	globalStateMu.Lock()
	cleanup := globalCleanup
	globalCleanup = nil
	globalDB = nil
	globalStateMu.Unlock()

	if cleanup != nil {
		cleanup()
	}
	return code
}

func provisionDisposableDB() (db *gorm.DB, cleanup func(), err error) {
	ctx := context.Background()

	adminDSN, err := dbsafety.AdminDSN()
	if err != nil {
		return nil, nil, err
	}

	adminCfg, err := pgx.ParseConfig(adminDSN)
	if err != nil {
		return nil, nil, fmt.Errorf("testutil: parse %s: %w", dbsafety.EnvAdminDSN, err)
	}

	adminConn, err := pgx.ConnectConfig(ctx, adminCfg)
	if err != nil {
		return nil, nil, fmt.Errorf("testutil: connect to disposable-DB admin instance: %w", err)
	}

	dbToken, err1 := dbsafety.RandomToken(6)
	roleToken, err2 := dbsafety.RandomToken(6)
	password, err3 := dbsafety.RandomToken(24)
	if err := firstNonNil(err1, err2, err3); err != nil {
		adminConn.Close(ctx)
		return nil, nil, err
	}

	// Pure "prefix + lowercase hex" — never derived from any external
	// input, so this can never be used to inject SQL. Still sanitized as an
	// identifier below, for defense in depth.
	dbName := "megamall_test_" + dbToken
	roleName := "test_role_" + roleToken

	if verifyErr := dbsafety.AssertNotProduction(fmt.Sprintf("host=%s port=%d dbname=%s user=%s", adminCfg.Host, adminCfg.Port, dbName, roleName)); verifyErr != nil {
		adminConn.Close(ctx)
		return nil, nil, fmt.Errorf("testutil: refusing to provision disposable database: %w", verifyErr)
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
		return nil, nil, fmt.Errorf("testutil: create disposable role: %w", execErr)
	}

	if _, execErr := adminConn.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s OWNER %s", quotedDB, quotedRole)); execErr != nil {
		teardown()
		return nil, nil, fmt.Errorf("testutil: create disposable database: %w", execErr)
	}

	if _, execErr := adminConn.Exec(ctx, "REVOKE ALL ON DATABASE "+quotedDB+" FROM PUBLIC"); execErr != nil {
		teardown()
		return nil, nil, fmt.Errorf("testutil: restrict disposable database to its owner: %w", execErr)
	}

	// CREATE EXTENSION and (on some Postgres versions) ownership of the
	// public schema require privileges the disposable, non-superuser role
	// deliberately doesn't have — do this once via the admin connection,
	// then hand off to the disposable role for the actual migrations.
	if execErr := prepareSchema(ctx, adminCfg, dbName, quotedRole); execErr != nil {
		teardown()
		return nil, nil, execErr
	}

	disposableCfg := adminCfg.Copy()
	disposableCfg.Database = dbName
	disposableCfg.User = roleName
	disposableCfg.Password = password

	if verifyErr := dbsafety.AssertNotProduction(disposableCfg.ConnString()); verifyErr != nil {
		teardown()
		return nil, nil, fmt.Errorf("testutil: refusing disposable connection: %w", verifyErr)
	}

	sqlDB := stdlib.OpenDB(*disposableCfg)

	dir, dirErr := migrationsDir()
	if dirErr != nil {
		sqlDB.Close()
		teardown()
		return nil, nil, dirErr
	}

	goose.SetLogger(goose.NopLogger())
	if dialectErr := goose.SetDialect("postgres"); dialectErr != nil {
		sqlDB.Close()
		teardown()
		return nil, nil, fmt.Errorf("testutil: set goose dialect: %w", dialectErr)
	}
	if upErr := goose.Up(sqlDB, dir); upErr != nil {
		sqlDB.Close()
		teardown()
		return nil, nil, fmt.Errorf("testutil: run migrations on disposable database: %w", upErr)
	}

	gdb, openErr := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if openErr != nil {
		sqlDB.Close()
		teardown()
		return nil, nil, fmt.Errorf("testutil: open gorm over disposable database: %w", openErr)
	}

	return gdb, func() {
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

// DB returns a disposable *gorm.DB, provisioning it on the first call from
// any test in this binary and reusing it for the rest of the run — Main
// (via TestMain) drops it afterward. Provisioning is lazy rather than
// happening unconditionally in Main/TestMain because TestMain always
// executes regardless of -run, and several real CI invocations select only
// tests that never touch the database at all: `go test -run '^$'`
// (deploy.yml's compile-only check) and `-run 'TestValidate|...'`-style
// patterns naming a curated DB-independent subset (deploy.yml's "no DB
// required" steps). Eagerly provisioning in Main would require
// TEST_ADMIN_DSN even for those runs, even though nothing in them would
// ever use it — which is exactly what broke the first two production
// deploy attempts after this package was introduced. Lazy provisioning
// means only a test that actually calls DB/NewTestDB ever needs
// TEST_ADMIN_DSN to be set.
func DB(t *testing.T) *gorm.DB {
	t.Helper()
	globalOnce.Do(func() {
		db, cleanup, err := provisionDisposableDB()
		globalStateMu.Lock()
		globalDB, globalCleanup, globalErr = db, cleanup, err
		globalStateMu.Unlock()
	})

	globalStateMu.Lock()
	db, err := globalDB, globalErr
	globalStateMu.Unlock()

	if err != nil {
		t.Fatalf("testutil: %v", err)
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
