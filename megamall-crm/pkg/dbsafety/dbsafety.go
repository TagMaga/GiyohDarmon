// Package dbsafety exists because a prior scratch test once pointed a DB
// connection string at the live production PostgreSQL role and mutated its
// password directly, causing a production outage. Every test and
// scratch-database script in this repo must go through this package before
// touching any database, and none of it may be bypassed by convention —
// only by deliberately not calling it.
//
// The contract is deliberately narrow:
//  1. Tests and scratch scripts read a connection string ONLY from
//     TEST_ADMIN_DSN (see EnvAdminDSN). They must never fall back to
//     DB_DSN, which is also what a production deploy uses — conflating the
//     two is exactly how the prior incident happened.
//  2. AssertNotProduction is then run against that connection string (and
//     again against any connection string later derived from it) before any
//     query executes. It fails closed: a DSN it cannot parse, or that
//     matches any production-shaped pattern, is refused.
//  3. Nothing in this package — or anything built on it — ever mutates a
//     pre-existing role (password, privileges, or otherwise). See
//     internal/testutil.setupDisposableDB for the harness that actually
//     creates/drops a unique database and role per test run.
package dbsafety

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// EnvAdminDSN is the only environment variable this package (or anything
// built on it) will ever read a connection string from. It must point at a
// disposable PostgreSQL instance meant for testing — a CI service
// container, or a local Docker/test Postgres — never at a shared or
// production database.
const EnvAdminDSN = "TEST_ADMIN_DSN"

// deniedSubstrings are matched case-insensitively against the parsed host,
// database name, and username. This is defense in depth layered on top of
// (never a substitute for) the caller supplying its own disposable
// connection — AdminDSN already refuses to run at all without one.
var deniedSubstrings = []string{
	"prod", "production", "live", "megamall.com", "megamall.tj",
}

// allowedHosts is the default host allowlist: loopback addresses and the
// service-container/compose hostnames this repo's CI and local dev tooling
// actually use. A host outside this list is refused even if it contains no
// denied substring — an allowlist of "known-disposable" hosts is far more
// robust than trying to enumerate every way a production host could be
// spelled. Override/extend via TEST_ADMIN_ALLOWED_HOSTS (comma-separated)
// for environments that need a different disposable host name; the denylist
// above still applies on top of that override.
var allowedHosts = []string{
	"localhost", "127.0.0.1", "::1", "postgres", "db", "test-postgres", "db-test",
}

// productionEnvMarkers: if any of these environment variables is set to one
// of the listed values, every DSN is refused outright regardless of what it
// points at — this catches a test/script being invoked from within a
// production runtime context even when the DSN itself looks disposable.
var productionEnvMarkers = map[string][]string{
	"APP_ENV":     {"production", "prod"},
	"ENVIRONMENT": {"production", "prod"},
	"NODE_ENV":    {"production"},
	"GIN_MODE":    {"release"},
}

// AdminDSN returns the disposable-database admin connection string from
// TEST_ADMIN_DSN. It never reads DB_DSN or any other variable — a missing
// TEST_ADMIN_DSN is a hard failure, not a fallback to whatever DSN happens
// to be configured for the running process.
func AdminDSN() (string, error) {
	dsn := os.Getenv(EnvAdminDSN)
	if strings.TrimSpace(dsn) == "" {
		return "", fmt.Errorf("dbsafety: %s is not set — tests must use an explicit disposable Postgres connection, "+
			"never DB_DSN or any other fallback; see pkg/dbsafety doc comment", EnvAdminDSN)
	}
	if err := AssertNotProduction(dsn); err != nil {
		return "", err
	}
	return dsn, nil
}

// AssertNotProduction parses dsn (accepts both libpq keyword=value and URL
// forms, via pgconn.ParseConfig) and refuses it unless the host is on the
// disposable-host allowlist and none of host/database/user contain a
// production-shaped substring. It also refuses unconditionally if any
// productionEnvMarkers variable indicates a production runtime. Call this
// on every connection string before it is used — including ones this
// package itself derives, e.g. a freshly built disposable-role DSN.
//
// This is the strict variant: only automated test/CI code (which only ever
// needs a disposable local/service-container Postgres) should use it. A
// human-run scratch tool that legitimately needs to reach a real dev or
// staging host by name should use RefuseProduction instead — see its doc
// comment for why the two are different.
func AssertNotProduction(dsn string) error {
	cfg, err := checkCommon(dsn)
	if err != nil {
		return err
	}

	host := strings.ToLower(cfg.Host)
	if !hostAllowed(host) {
		return fmt.Errorf("dbsafety: refusing DSN — host %q is not on the disposable-host allowlist %v "+
			"(override with %s)", cfg.Host, allowedHosts, envAllowedHosts)
	}
	return nil
}

// RefuseProduction applies the same denylist and production-env-marker
// checks as AssertNotProduction, but without the disposable-host allowlist.
// It exists for human-run scratch/dev tools (bulk test-data generators, the
// local reset/e2e scripts) that legitimately need to target a real dev or
// staging host reachable by name or IP — something the strict, CI-only
// AssertNotProduction would always refuse. It still fails closed on an
// unparseable DSN and on anything matching a production-shaped pattern.
func RefuseProduction(dsn string) error {
	_, err := checkCommon(dsn)
	return err
}

func checkCommon(dsn string) (*pgconn.Config, error) {
	for envVar, badValues := range productionEnvMarkers {
		val := strings.ToLower(strings.TrimSpace(os.Getenv(envVar)))
		for _, bad := range badValues {
			if val == bad {
				return nil, fmt.Errorf("dbsafety: refusing to run — %s=%q indicates a production runtime", envVar, val)
			}
		}
	}

	cfg, err := pgconn.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("dbsafety: refusing an unparseable DSN: %w", err)
	}

	host := strings.ToLower(cfg.Host)
	db := strings.ToLower(cfg.Database)
	user := strings.ToLower(cfg.User)

	for _, needle := range deniedSubstrings {
		if strings.Contains(host, needle) {
			return nil, fmt.Errorf("dbsafety: refusing DSN — host %q matches a production-shaped pattern %q", cfg.Host, needle)
		}
		if strings.Contains(db, needle) {
			return nil, fmt.Errorf("dbsafety: refusing DSN — database %q matches a production-shaped pattern %q", cfg.Database, needle)
		}
		if strings.Contains(user, needle) {
			return nil, fmt.Errorf("dbsafety: refusing DSN — user %q matches a production-shaped pattern %q", cfg.User, needle)
		}
	}

	return cfg, nil
}

const envAllowedHosts = "TEST_ADMIN_ALLOWED_HOSTS"

func hostAllowed(host string) bool {
	list := allowedHosts
	if override := os.Getenv(envAllowedHosts); strings.TrimSpace(override) != "" {
		list = strings.Split(override, ",")
	}
	for _, h := range list {
		if strings.EqualFold(strings.TrimSpace(h), host) {
			return true
		}
	}
	return false
}

// RandomToken returns a cryptographically random lowercase-hex string of
// 2*n characters. Used to name disposable databases/roles and generate
// disposable-role passwords: hex-only output can never break out of a SQL
// string literal or a quoted identifier, so callers building DDL from it
// need no additional escaping — see internal/testutil.NewDisposableDB.
func RandomToken(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("dbsafety: generate random token: %w", err)
	}
	return hex.EncodeToString(buf), nil
}
