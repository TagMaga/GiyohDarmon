package testutil

// db.go — Test database helpers (Phase 6).
//
// Usage:
//   db := testutil.NewTestDB(t)   // opens a tx; rolls back on t.Cleanup
//   user := testutil.CreateUser(t, db, "seller")

import (
	"fmt"
	"os"
	"sync"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var (
	globalDB   *gorm.DB
	globalOnce sync.Once
)

// DB returns a shared *gorm.DB for the test suite, connected via DB_DSN env var.
// Panics if DB_DSN is not set — tests that need a DB must set it.
func DB(t *testing.T) *gorm.DB {
	t.Helper()
	globalOnce.Do(func() {
		dsn := os.Getenv("DB_DSN")
		if dsn == "" {
			panic("DB_DSN env var is required for database tests")
		}
		db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Silent),
		})
		if err != nil {
			panic(fmt.Sprintf("testutil: connect to DB: %v", err))
		}
		globalDB = db
	})
	return globalDB
}

// NewTestDB wraps every test in a transaction that is automatically rolled back
// when the test ends.  All operations done on the returned *gorm.DB run inside
// that transaction, so the database is left clean after each test.
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
