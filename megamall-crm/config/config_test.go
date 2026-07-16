package config

// config_test.go — Proves the MEDIA_PIPELINE_ENABLED flag's production-
// safety contract at the config-loading layer:
//   1. it defaults to false
//   2. a disabled-by-default deploy starts cleanly with no MEDIA_* env vars
//      set at all (the app must not gain a new hard requirement just from
//      this feature existing in the binary)
//   3. enabling it without a signing secret fails fast at startup, rather
//      than silently running with an empty HMAC key
//   4. enabling it with a secret set succeeds
//
// Run with: go test ./config/ -v -run TestLoad_Media

import "testing"

// requiredBaseEnv sets the env vars Load() always requires (unrelated to
// media), so each test below only has to vary the MEDIA_* ones.
func requiredBaseEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DB_DSN", "host=localhost port=5432 user=test password=test dbname=test sslmode=disable")
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret")
	t.Setenv("JWT_REFRESH_SECRET", "test-refresh-secret")
}

func TestLoad_Media_DefaultsDisabled(t *testing.T) {
	requiredBaseEnv(t)
	// Deliberately do not set MEDIA_PIPELINE_ENABLED or MEDIA_SIGNING_SECRET
	// — this is what an unmodified production deploy of this code looks
	// like today.

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() with no MEDIA_* env vars set must succeed, got: %v", err)
	}
	if cfg.Media.Enabled {
		t.Error("MediaConfig.Enabled must default to false")
	}
	if cfg.Media.SigningSecret != "" {
		t.Error("SigningSecret should be empty when never set")
	}
}

func TestLoad_Media_EnabledWithoutSecretFailsFast(t *testing.T) {
	requiredBaseEnv(t)
	t.Setenv("MEDIA_PIPELINE_ENABLED", "true")
	// MEDIA_SIGNING_SECRET intentionally left unset.

	_, err := Load()
	if err == nil {
		t.Fatal("Load() must fail when MEDIA_PIPELINE_ENABLED=true but MEDIA_SIGNING_SECRET is unset — running with an empty HMAC key would be a real security bug, not a safe default")
	}
}

func TestLoad_Media_EnabledWithSecretSucceeds(t *testing.T) {
	requiredBaseEnv(t)
	t.Setenv("MEDIA_PIPELINE_ENABLED", "true")
	t.Setenv("MEDIA_SIGNING_SECRET", "a-real-secret-for-this-test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() with both flag and secret set should succeed, got: %v", err)
	}
	if !cfg.Media.Enabled {
		t.Error("expected Enabled=true")
	}
	if cfg.Media.SigningSecret != "a-real-secret-for-this-test" {
		t.Errorf("SigningSecret = %q, want the configured value", cfg.Media.SigningSecret)
	}
}

func TestLoad_Media_ExplicitlyDisabledIgnoresMissingSecret(t *testing.T) {
	requiredBaseEnv(t)
	t.Setenv("MEDIA_PIPELINE_ENABLED", "false")
	// No secret set — must still succeed since the feature is off.

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() with MEDIA_PIPELINE_ENABLED=false must succeed without a secret, got: %v", err)
	}
	if cfg.Media.Enabled {
		t.Error("expected Enabled=false")
	}
}
