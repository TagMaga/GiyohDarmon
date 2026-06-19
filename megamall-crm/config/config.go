package config

import (
	"fmt"
	"time"

	"github.com/kelseyhightower/envconfig"
)

type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	JWT      JWTConfig
	Redis    RedisConfig
}

type ServerConfig struct {
	Port            string        `envconfig:"SERVER_PORT" default:"8080"`
	ReadTimeout     time.Duration `envconfig:"SERVER_READ_TIMEOUT" default:"10s"`
	WriteTimeout    time.Duration `envconfig:"SERVER_WRITE_TIMEOUT" default:"10s"`
	ShutdownTimeout time.Duration `envconfig:"SERVER_SHUTDOWN_TIMEOUT" default:"30s"`
	Mode            string        `envconfig:"GIN_MODE" default:"debug"`
	// CORSOrigins is a comma-separated allowlist of permitted request origins.
	// Empty = allow all origins (development only). Must be set in staging/prod.
	// Example: "https://app.example.com,https://staging.example.com"
	CORSOrigins string `envconfig:"CORS_ORIGINS" default:""`
	// Timezone is the IANA timezone name for interpreting bare YYYY-MM-DD date
	// parameters as local midnight. All DB timestamps are still stored in UTC.
	// Override with APP_TIMEZONE env var. Default matches Tajikistan (UTC+5).
	Timezone string `envconfig:"APP_TIMEZONE" default:"Asia/Dushanbe"`
}

// Location returns the parsed *time.Location for Timezone, falling back to UTC
// if the name is invalid. Called once at startup; result is safe to cache.
func (s ServerConfig) Location() *time.Location {
	if loc, err := time.LoadLocation(s.Timezone); err == nil {
		return loc
	}
	return time.UTC
}

type DatabaseConfig struct {
	DSN             string        `envconfig:"DB_DSN" required:"true"`
	MaxOpenConns    int           `envconfig:"DB_MAX_OPEN_CONNS" default:"25"`
	MaxIdleConns    int           `envconfig:"DB_MAX_IDLE_CONNS" default:"10"`
	ConnMaxLifetime time.Duration `envconfig:"DB_CONN_MAX_LIFETIME" default:"5m"`
	ConnMaxIdleTime time.Duration `envconfig:"DB_CONN_MAX_IDLE_TIME" default:"1m"`
	SlowQueryMS     int           `envconfig:"DB_SLOW_QUERY_MS" default:"200"`
}

type JWTConfig struct {
	AccessSecret    string        `envconfig:"JWT_ACCESS_SECRET" required:"true"`
	RefreshSecret   string        `envconfig:"JWT_REFRESH_SECRET" required:"true"`
	AccessTokenTTL  time.Duration `envconfig:"JWT_ACCESS_TTL" default:"15m"`
	RefreshTokenTTL time.Duration `envconfig:"JWT_REFRESH_TTL" default:"168h"` // 7 days
}

type RedisConfig struct {
	URL string `envconfig:"REDIS_URL" default:"redis://localhost:6379"`
}

// Load reads all config from environment variables.
func Load() (*Config, error) {
	var cfg Config

	if err := envconfig.Process("", &cfg.Server); err != nil {
		return nil, fmt.Errorf("server config: %w", err)
	}
	if err := envconfig.Process("", &cfg.Database); err != nil {
		return nil, fmt.Errorf("database config: %w", err)
	}
	if err := envconfig.Process("", &cfg.JWT); err != nil {
		return nil, fmt.Errorf("jwt config: %w", err)
	}
	if err := envconfig.Process("", &cfg.Redis); err != nil {
		return nil, fmt.Errorf("redis config: %w", err)
	}

	return &cfg, nil
}
