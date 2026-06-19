package seed

import (
	"strings"
	"testing"
)

// setenv sets env vars for the duration of a test and restores originals on cleanup.
func setenv(t *testing.T, pairs ...string) {
	t.Helper()
	for i := 0; i < len(pairs)-1; i += 2 {
		t.Setenv(pairs[i], pairs[i+1])
	}
}

// ─── dev mode ──────────────────────────────────────────────────────────────

func TestParseConfig_DevDefault(t *testing.T) {
	t.Setenv("SEED_MODE", "")
	t.Setenv("SEED_DEFAULT_PASSWORD", "")
	t.Setenv("SEED_OWNER_PASSWORD", "")

	cfg, err := ParseConfig()
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.Mode != ModeDev {
		t.Errorf("mode: want dev, got %q", cfg.Mode)
	}
	if cfg.DefaultPassword != insecurePassword {
		t.Errorf("DefaultPassword: want %q, got %q", insecurePassword, cfg.DefaultPassword)
	}
	if cfg.OwnerPassword != insecurePassword {
		t.Errorf("OwnerPassword: want %q, got %q", insecurePassword, cfg.OwnerPassword)
	}
}

func TestParseConfig_DevExplicitPasswords(t *testing.T) {
	setenv(t, "SEED_MODE", "dev", "SEED_DEFAULT_PASSWORD", "mydev", "SEED_OWNER_PASSWORD", "ownerdev")

	cfg, err := ParseConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.DefaultPassword != "mydev" {
		t.Errorf("DefaultPassword: want mydev, got %q", cfg.DefaultPassword)
	}
	if cfg.OwnerPassword != "ownerdev" {
		t.Errorf("OwnerPassword: want ownerdev, got %q", cfg.OwnerPassword)
	}
}

func TestParseConfig_DevOwnerFallsBackToDefault(t *testing.T) {
	setenv(t, "SEED_MODE", "dev", "SEED_DEFAULT_PASSWORD", "devpass", "SEED_OWNER_PASSWORD", "")

	cfg, err := ParseConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.OwnerPassword != "devpass" {
		t.Errorf("OwnerPassword should fall back to DefaultPassword, got %q", cfg.OwnerPassword)
	}
}

func TestParseConfig_DevSeedsAllUsers(t *testing.T) {
	t.Setenv("SEED_MODE", "dev")

	cfg, err := ParseConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.seedsAllUsers() {
		t.Error("dev mode must seed all users")
	}
}

// ─── staging mode ──────────────────────────────────────────────────────────

func TestParseConfig_StagingMissingPassword(t *testing.T) {
	setenv(t, "SEED_MODE", "staging", "SEED_DEFAULT_PASSWORD", "", "SEED_OWNER_PASSWORD", "")

	_, err := ParseConfig()
	if err == nil {
		t.Fatal("expected error for missing SEED_DEFAULT_PASSWORD in staging")
	}
	if !strings.Contains(err.Error(), "SEED_DEFAULT_PASSWORD is required") {
		t.Errorf("error should mention SEED_DEFAULT_PASSWORD required, got: %v", err)
	}
}

func TestParseConfig_StagingInsecureDefaultPassword(t *testing.T) {
	setenv(t, "SEED_MODE", "staging", "SEED_DEFAULT_PASSWORD", "password123", "SEED_OWNER_PASSWORD", "")

	_, err := ParseConfig()
	if err == nil {
		t.Fatal("expected error for insecure SEED_DEFAULT_PASSWORD in staging")
	}
	if !strings.Contains(err.Error(), "SEED_DEFAULT_PASSWORD must not be") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestParseConfig_StagingInsecureOwnerPassword(t *testing.T) {
	setenv(t, "SEED_MODE", "staging", "SEED_DEFAULT_PASSWORD", "securep@ss!", "SEED_OWNER_PASSWORD", "password123")

	_, err := ParseConfig()
	if err == nil {
		t.Fatal("expected error for insecure SEED_OWNER_PASSWORD in staging")
	}
	if !strings.Contains(err.Error(), "SEED_OWNER_PASSWORD must not be") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestParseConfig_StagingValid(t *testing.T) {
	setenv(t, "SEED_MODE", "staging", "SEED_DEFAULT_PASSWORD", "Stag!ngP@ss1", "SEED_OWNER_PASSWORD", "0wnerP@ss1")

	cfg, err := ParseConfig()
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.Mode != ModeStaging {
		t.Errorf("mode: want staging, got %q", cfg.Mode)
	}
	if !cfg.seedsAllUsers() {
		t.Error("staging mode must seed all users")
	}
}

func TestParseConfig_StagingOwnerFallsBackToDefault(t *testing.T) {
	setenv(t, "SEED_MODE", "staging", "SEED_DEFAULT_PASSWORD", "Stag!ngP@ss1", "SEED_OWNER_PASSWORD", "")

	cfg, err := ParseConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.OwnerPassword != "Stag!ngP@ss1" {
		t.Errorf("OwnerPassword should fall back to DefaultPassword in staging, got %q", cfg.OwnerPassword)
	}
}

// ─── production mode ───────────────────────────────────────────────────────

func TestParseConfig_ProductionMissingOwnerPassword(t *testing.T) {
	setenv(t, "SEED_MODE", "production", "SEED_OWNER_PASSWORD", "")

	_, err := ParseConfig()
	if err == nil {
		t.Fatal("expected error for missing SEED_OWNER_PASSWORD in production")
	}
	if !strings.Contains(err.Error(), "SEED_OWNER_PASSWORD is required") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestParseConfig_ProductionInsecureOwnerPassword(t *testing.T) {
	setenv(t, "SEED_MODE", "production", "SEED_OWNER_PASSWORD", "password123")

	_, err := ParseConfig()
	if err == nil {
		t.Fatal("expected error for insecure SEED_OWNER_PASSWORD in production")
	}
	if !strings.Contains(err.Error(), "SEED_OWNER_PASSWORD must not be") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestParseConfig_ProductionValid(t *testing.T) {
	setenv(t, "SEED_MODE", "production", "SEED_OWNER_PASSWORD", "Pr0dOwn3r!Secure")

	cfg, err := ParseConfig()
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.Mode != ModeProduction {
		t.Errorf("mode: want production, got %q", cfg.Mode)
	}
}

func TestParseConfig_ProductionDoesNotSeedAllUsers(t *testing.T) {
	setenv(t, "SEED_MODE", "production", "SEED_OWNER_PASSWORD", "Pr0dOwn3r!Secure")

	cfg, err := ParseConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.seedsAllUsers() {
		t.Error("production mode must NOT seed all users")
	}
}

// ─── invalid mode ──────────────────────────────────────────────────────────

func TestParseConfig_InvalidMode(t *testing.T) {
	t.Setenv("SEED_MODE", "banana")

	_, err := ParseConfig()
	if err == nil {
		t.Fatal("expected error for invalid SEED_MODE")
	}
	if !strings.Contains(err.Error(), "banana") {
		t.Errorf("error should mention the invalid value, got: %v", err)
	}
}

// ─── passwordFor helper ────────────────────────────────────────────────────

func TestPasswordFor_OwnerGetsOwnerPassword(t *testing.T) {
	cfg := &Config{
		Mode:            ModeDev,
		DefaultPassword: "default",
		OwnerPassword:   "ownerspecial",
	}
	if got := cfg.passwordFor("owner"); got != "ownerspecial" {
		t.Errorf("want ownerspecial, got %q", got)
	}
}

func TestPasswordFor_NonOwnerGetsDefault(t *testing.T) {
	cfg := &Config{
		Mode:            ModeDev,
		DefaultPassword: "default",
		OwnerPassword:   "ownerspecial",
	}
	for _, role := range []string{"seller", "manager", "sales_team_lead", "courier", "dispatcher", "warehouse_manager"} {
		if got := cfg.passwordFor(role); got != "default" {
			t.Errorf("role %q: want default, got %q", role, got)
		}
	}
}
