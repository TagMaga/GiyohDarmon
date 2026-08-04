package config

// timezone_test.go — Location() must fail loudly on a bad/unavailable
// timezone instead of silently degrading to UTC.
//
// The silent fallback it replaces was indistinguishable at runtime from a
// correct configuration, while shifting every business-day boundary by the
// zone's offset (5h for Asia/Dushanbe): "today" filters, daily revenue
// buckets and month-to-date commission rankings all move without a single
// log line. Production runs a CGO_ENABLED=0 static binary under systemd, so
// a host missing /usr/share/zoneinfo would have hit exactly that path —
// cmd/server now embeds time/tzdata, and this makes any remaining failure
// (e.g. a typo in APP_TIMEZONE) a startup error.
//
// Run with: go test ./config/ -v -run TestLocation

import (
	"testing"
	"time"
)

func TestLocation_DefaultIsDushanbe(t *testing.T) {
	loc, err := ServerConfig{Timezone: "Asia/Dushanbe"}.Location()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if loc.String() != "Asia/Dushanbe" {
		t.Errorf("got %q, want Asia/Dushanbe", loc.String())
	}

	// Sanity-check the offset the rest of the app depends on: UTC+5, no DST.
	ref := time.Date(2026, 8, 3, 12, 0, 0, 0, loc)
	if _, offset := ref.Zone(); offset != 5*3600 {
		t.Errorf("offset = %ds, want 18000s (UTC+5)", offset)
	}
}

func TestLocation_InvalidNameReturnsError(t *testing.T) {
	loc, err := ServerConfig{Timezone: "Not/AZone"}.Location()
	if err == nil {
		t.Fatalf("expected an error for an invalid timezone, got loc=%v", loc)
	}
	if loc != nil {
		t.Errorf("expected nil location alongside the error, got %v", loc)
	}
}

// An empty APP_TIMEZONE must not quietly resolve to UTC either. envconfig
// applies the `default` tag only when the variable is *unset*, so a stray
// `APP_TIMEZONE=` line in a .env bypasses the Asia/Dushanbe default and
// arrives here as "" — and time.LoadLocation("") returns UTC with a nil
// error, which would reopen the silent fallback this whole change closes.
func TestLocation_EmptyNameIsRejected(t *testing.T) {
	loc, err := ServerConfig{Timezone: ""}.Location()
	if err == nil {
		t.Fatalf("expected an error for an empty timezone, got loc=%v", loc)
	}
	if loc != nil {
		t.Errorf("expected nil location alongside the error, got %v", loc)
	}

	// Whitespace-only is the same mistake wearing a hat.
	if _, err := (ServerConfig{Timezone: "   "}).Location(); err == nil {
		t.Error("expected an error for a whitespace-only timezone")
	}
}

// The documented default must still resolve when the variable is simply unset,
// which is how every current deployment runs (APP_TIMEZONE appears in no .env
// or workflow in this repo).
func TestLocation_UnsetUsesDushanbeDefault(t *testing.T) {
	requiredBaseEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.Server.Timezone != "Asia/Dushanbe" {
		t.Fatalf("default Timezone = %q, want Asia/Dushanbe", cfg.Server.Timezone)
	}
	loc, err := cfg.Server.Location()
	if err != nil {
		t.Fatalf("unexpected error resolving the default: %v", err)
	}
	if loc.String() != "Asia/Dushanbe" {
		t.Errorf("got %q, want Asia/Dushanbe", loc.String())
	}
}
