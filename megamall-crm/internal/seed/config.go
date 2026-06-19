package seed

// config.go — Seed configuration parsed from environment variables.
//
// Three modes control what gets seeded and how passwords are validated:
//
//   dev         — all demo users, password123 allowed (local only)
//   staging     — all demo users, explicit password required, password123 rejected
//   production  — owner account only, explicit password required, password123 rejected

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

// Mode is the seeding scope and safety level.
type Mode string

const (
	ModeDev        Mode = "dev"
	ModeStaging    Mode = "staging"
	ModeProduction Mode = "production"

	insecurePassword = "password123"
)

// Config holds validated seed parameters.
type Config struct {
	Mode            Mode
	// DefaultPassword is used for all non-owner demo users (dev + staging).
	DefaultPassword string
	// OwnerPassword is used for the owner account in all modes.
	// In dev it falls back to DefaultPassword when empty.
	OwnerPassword   string
}

// ParseConfig reads SEED_MODE, SEED_DEFAULT_PASSWORD, and SEED_OWNER_PASSWORD
// from the environment, applies mode-specific validation, and returns a ready
// Config or a descriptive error.
//
// Environment variables:
//
//	SEED_MODE              dev | staging | production  (default: dev)
//	SEED_DEFAULT_PASSWORD  password for all demo users (default in dev: password123)
//	SEED_OWNER_PASSWORD    password for the owner account (optional in dev)
func ParseConfig() (*Config, error) {
	rawMode := strings.TrimSpace(os.Getenv("SEED_MODE"))
	if rawMode == "" {
		rawMode = "dev"
	}

	mode := Mode(strings.ToLower(rawMode))
	if !mode.valid() {
		return nil, fmt.Errorf(
			"SEED_MODE %q is not valid — allowed values: dev, staging, production",
			rawMode,
		)
	}

	defaultPwd := strings.TrimSpace(os.Getenv("SEED_DEFAULT_PASSWORD"))
	ownerPwd   := strings.TrimSpace(os.Getenv("SEED_OWNER_PASSWORD"))

	cfg := &Config{
		Mode:            mode,
		DefaultPassword: defaultPwd,
		OwnerPassword:   ownerPwd,
	}

	return cfg, cfg.validate()
}

// validate enforces mode-specific password rules.
func (c *Config) validate() error {
	switch c.Mode {
	case ModeDev:
		// Dev: apply insecure fallback so the seeder still works without any env vars set.
		if c.DefaultPassword == "" {
			c.DefaultPassword = insecurePassword
		}
		if c.OwnerPassword == "" {
			c.OwnerPassword = c.DefaultPassword
		}
		return nil

	case ModeStaging:
		var errs []string
		if c.DefaultPassword == "" {
			errs = append(errs, "SEED_DEFAULT_PASSWORD is required for SEED_MODE=staging")
		}
		if c.DefaultPassword == insecurePassword {
			errs = append(errs, "SEED_DEFAULT_PASSWORD must not be \"password123\" in staging")
		}
		if c.OwnerPassword == "" {
			c.OwnerPassword = c.DefaultPassword // owner uses default if not set separately
		}
		if c.OwnerPassword == insecurePassword {
			errs = append(errs, "SEED_OWNER_PASSWORD must not be \"password123\" in staging")
		}
		return joinErrors(errs)

	case ModeProduction:
		var errs []string
		if c.OwnerPassword == "" {
			errs = append(errs, "SEED_OWNER_PASSWORD is required for SEED_MODE=production")
		}
		if c.OwnerPassword == insecurePassword {
			errs = append(errs, "SEED_OWNER_PASSWORD must not be \"password123\" in production")
		}
		return joinErrors(errs)
	}

	// unreachable — mode.valid() guards above
	return nil
}

// valid reports whether the Mode value is one of the three recognised modes.
func (m Mode) valid() bool {
	return m == ModeDev || m == ModeStaging || m == ModeProduction
}

// seedsAllUsers reports whether this mode creates all demo accounts.
func (c *Config) seedsAllUsers() bool {
	return c.Mode == ModeDev || c.Mode == ModeStaging
}

// passwordFor returns the password to use for a given role.
// Owner always gets OwnerPassword; everyone else gets DefaultPassword.
func (c *Config) passwordFor(role string) string {
	if role == "owner" {
		return c.OwnerPassword
	}
	return c.DefaultPassword
}

// joinErrors returns nil if errs is empty, otherwise a multi-line error.
func joinErrors(errs []string) error {
	if len(errs) == 0 {
		return nil
	}
	return errors.New(strings.Join(errs, "\n"))
}
