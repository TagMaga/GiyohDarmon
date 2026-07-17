package dbsafety

import (
	"strings"
	"testing"
)

func TestAdminDSN_MissingFailsClosed(t *testing.T) {
	t.Setenv(EnvAdminDSN, "")

	if _, err := AdminDSN(); err == nil {
		t.Fatal("expected an error when TEST_ADMIN_DSN is unset, got nil")
	}
}

func TestAdminDSN_NeverReadsDBDSN(t *testing.T) {
	t.Setenv(EnvAdminDSN, "")
	t.Setenv("DB_DSN", "host=localhost port=5432 user=postgres password=x dbname=postgres sslmode=disable")

	// A real production deploy always has DB_DSN set. AdminDSN must never
	// fall back to it — this is the exact conflation that caused the prior
	// incident.
	if _, err := AdminDSN(); err == nil {
		t.Fatal("AdminDSN must not succeed via a DB_DSN fallback")
	}
}

func TestAssertNotProduction_AllowsLoopback(t *testing.T) {
	clearProductionEnvMarkers(t)

	dsn := "host=localhost port=5432 user=test_role_abc123 password=x dbname=megamall_test_abc123 sslmode=disable"
	if err := AssertNotProduction(dsn); err != nil {
		t.Fatalf("expected a loopback, non-production-shaped DSN to be allowed, got: %v", err)
	}
}

func TestAssertNotProduction_RejectsNonAllowlistedHost(t *testing.T) {
	clearProductionEnvMarkers(t)

	cases := []string{
		"host=db.internal.megamall.example port=5432 user=app password=x dbname=app sslmode=require",
		"host=10.0.4.12 port=5432 user=app password=x dbname=app sslmode=require",
		"host=megamall-prod-db.example.com port=5432 user=app password=x dbname=app sslmode=require",
	}
	for _, dsn := range cases {
		if err := AssertNotProduction(dsn); err == nil {
			t.Errorf("expected host to be rejected (not on allowlist): %q", dsn)
		}
	}
}

func TestAssertNotProduction_RejectsProductionShapedNames(t *testing.T) {
	clearProductionEnvMarkers(t)

	cases := []string{
		"host=localhost port=5432 user=postgres password=x dbname=megamall_production sslmode=disable",
		"host=localhost port=5432 user=prod_admin password=x dbname=megamall_test sslmode=disable",
		"host=localhost port=5432 user=app password=x dbname=live_orders sslmode=disable",
	}
	for _, dsn := range cases {
		if err := AssertNotProduction(dsn); err == nil {
			t.Errorf("expected production-shaped DSN to be rejected: %q", dsn)
		}
	}
}

func TestAssertNotProduction_RejectsUnparseableDSN(t *testing.T) {
	clearProductionEnvMarkers(t)

	if err := AssertNotProduction("this is not a connection string"); err == nil {
		t.Fatal("expected an unparseable DSN to be rejected, not silently accepted")
	}
}

func TestAssertNotProduction_RejectsProductionEnvMarkers(t *testing.T) {
	clearProductionEnvMarkers(t)
	t.Setenv("APP_ENV", "production")

	dsn := "host=localhost port=5432 user=test_role password=x dbname=megamall_test_1 sslmode=disable"
	if err := AssertNotProduction(dsn); err == nil {
		t.Fatal("expected APP_ENV=production to refuse every DSN regardless of shape")
	}
}

func TestAssertNotProduction_GinModeReleaseRefused(t *testing.T) {
	clearProductionEnvMarkers(t)
	t.Setenv("GIN_MODE", "release")

	dsn := "host=localhost port=5432 user=test_role password=x dbname=megamall_test_1 sslmode=disable"
	if err := AssertNotProduction(dsn); err == nil {
		t.Fatal("expected GIN_MODE=release to refuse every DSN regardless of shape")
	}
}

func TestAssertNotProduction_AllowedHostsOverride(t *testing.T) {
	clearProductionEnvMarkers(t)
	t.Setenv(envAllowedHosts, "ci-postgres")

	dsn := "host=ci-postgres port=5432 user=test_role password=x dbname=megamall_test_1 sslmode=disable"
	if err := AssertNotProduction(dsn); err != nil {
		t.Fatalf("expected TEST_ADMIN_ALLOWED_HOSTS override to allow the listed host, got: %v", err)
	}

	// The denylist still applies on top of an overridden allowlist.
	dsnBad := "host=ci-postgres port=5432 user=prod_admin password=x dbname=megamall_test_1 sslmode=disable"
	if err := AssertNotProduction(dsnBad); err == nil {
		t.Fatal("expected the denylist to still apply even when the host is explicitly allowlisted")
	}
}

func TestRefuseProduction_AllowsNonLoopbackDevHost(t *testing.T) {
	clearProductionEnvMarkers(t)

	// A real dev/staging host by name, unlike AssertNotProduction, must be
	// allowed here — RefuseProduction is for human-run scratch tools that
	// need this flexibility, guarded by the denylist alone.
	dsn := "host=dev-postgres.internal.example port=5432 user=devuser password=x dbname=megamall_dev sslmode=require"
	if err := RefuseProduction(dsn); err != nil {
		t.Fatalf("expected a non-production-shaped dev host to be allowed, got: %v", err)
	}
}

func TestRefuseProduction_RejectsProductionShapedNames(t *testing.T) {
	clearProductionEnvMarkers(t)

	cases := []string{
		"host=db.internal.example port=5432 user=app password=x dbname=megamall_production sslmode=require",
		"host=prod-db.internal.example port=5432 user=app password=x dbname=app sslmode=require",
		"host=db.internal.example port=5432 user=app password=x dbname=app sslmode=require host=megamall.com",
	}
	for _, dsn := range cases {
		if err := RefuseProduction(dsn); err == nil {
			t.Errorf("expected production-shaped DSN to be rejected: %q", dsn)
		}
	}
}

func TestRefuseProduction_RejectsProductionEnvMarkers(t *testing.T) {
	clearProductionEnvMarkers(t)
	t.Setenv("ENVIRONMENT", "production")

	dsn := "host=dev-postgres.internal.example port=5432 user=devuser password=x dbname=megamall_dev sslmode=require"
	if err := RefuseProduction(dsn); err == nil {
		t.Fatal("expected ENVIRONMENT=production to refuse every DSN regardless of shape")
	}
}

func TestRandomToken_LengthAndUniqueness(t *testing.T) {
	a, err := RandomToken(8)
	if err != nil {
		t.Fatalf("RandomToken: %v", err)
	}
	if len(a) != 16 {
		t.Errorf("RandomToken(8) length = %d, want 16 (2*n hex chars)", len(a))
	}
	for _, r := range a {
		if !strings.ContainsRune("0123456789abcdef", r) {
			t.Fatalf("RandomToken produced a non-hex character %q — this must stay pure hex so callers can safely interpolate it into SQL identifiers/literals", r)
		}
	}

	b, err := RandomToken(8)
	if err != nil {
		t.Fatalf("RandomToken: %v", err)
	}
	if a == b {
		t.Fatal("two calls to RandomToken produced the same value")
	}
}

// clearProductionEnvMarkers scrubs every variable AssertNotProduction checks
// so tests aren't at the mercy of whatever CI/dev environment happens to be
// running them, then relies on t.Setenv's automatic restore-on-cleanup.
func clearProductionEnvMarkers(t *testing.T) {
	t.Helper()
	for envVar := range productionEnvMarkers {
		t.Setenv(envVar, "")
	}
}
