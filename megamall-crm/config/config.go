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
	Media    MediaConfig
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

// MediaConfig governs the centralized upload/image pipeline (internal/media).
// Every limit here is deliberately configurable — production defaults are
// chosen to be safe on a memory-constrained host (see the libvips benchmark
// in megamall-audits/libvips-install-20260716/BENCHMARK_RESULTS.md), not
// maximally permissive.
type MediaConfig struct {
	// Enabled is the master switch for the entire pipeline. Defaults to
	// false so a production deploy of this code is a no-op until someone
	// deliberately turns it on: cmd/server/main.go skips constructing the
	// repository/service/handler, registering any /api/v1/media or
	// /media/public|private route, and starting the quarantine-purge
	// goroutine entirely when this is false — see the "Gated behind
	// MEDIA_PIPELINE_ENABLED" comment there. The legacy /uploads endpoint
	// and every existing route are completely unaffected either way.
	Enabled bool `envconfig:"MEDIA_PIPELINE_ENABLED" default:"false"`
	// MaxUploadBytes is the hard ceiling for any single upload, enforced at
	// the HTTP body-read layer before any per-category limit is checked.
	MaxUploadBytes int64 `envconfig:"MEDIA_MAX_UPLOAD_BYTES" default:"20971520"` // 20 MiB
	// MaxImageBytes/MaxDocumentBytes are the per-category ceilings applied
	// after MaxUploadBytes (must be <= it). Product/avatar/proof images use
	// MaxImageBytes; user_document (which may be a PDF) uses MaxDocumentBytes.
	MaxImageBytes    int64 `envconfig:"MEDIA_MAX_IMAGE_BYTES" default:"15728640"`    // 15 MiB
	MaxDocumentBytes int64 `envconfig:"MEDIA_MAX_DOCUMENT_BYTES" default:"20971520"` // 20 MiB
	// MaxPixels bounds width*height for any image before it is ever handed
	// to libvips — the actual decompression-bomb defense. 40MP comfortably
	// covers any real camera/phone photo (a 12MP phone photo, a 24MP DSLR
	// photo) while rejecting the pathological declared-but-implausible
	// dimensions a crafted file can claim in its header alone.
	MaxPixels int64 `envconfig:"MEDIA_MAX_PIXELS" default:"40000000"`
	// MaxDimension bounds any single side, independent of the total-pixel
	// cap (catches e.g. a 1x2000000000 degenerate image that would pass a
	// pure area check).
	MaxDimension int `envconfig:"MEDIA_MAX_DIMENSION" default:"12000"`
	// SigningSecret is the HMAC key for private-media signed URLs. Distinct
	// from the JWT signing keys to avoid any cross-protocol key reuse. Not
	// marked `required:"true"` here — a production deploy with the pipeline
	// disabled (the default) must start cleanly without this ever being
	// set. Load() below enforces it's non-empty only when Enabled is true.
	SigningSecret string `envconfig:"MEDIA_SIGNING_SECRET"`
	// SignedURLTTL is how long a signed private-media URL remains valid.
	SignedURLTTL time.Duration `envconfig:"MEDIA_SIGNED_URL_TTL" default:"15m"`
	// SignedURLCacheBucket buckets the expiry timestamp used to mint a
	// signed private-media URL so repeated mints for the same asset+variant
	// within one bucket window produce byte-identical URLs — letting the
	// requester's own device (Cache-Control: private, see
	// media.Handler.PrivateDelivery) reuse a previously-downloaded image
	// instead of redownloading it on every screen open. 0 disables bucketing
	// (every mint gets a fresh, unique expiry, as before). Every minted URL
	// still remains valid for at least SignedURLTTL regardless of where in
	// the bucket window it was minted — see Service.signedURLExpiry.
	SignedURLCacheBucket time.Duration `envconfig:"MEDIA_SIGNED_URL_CACHE_BUCKET" default:"5m"`
	// QuarantineRetention is how long a deleted asset's physical file is
	// kept in quarantine before the purge job removes it permanently.
	QuarantineRetention time.Duration `envconfig:"MEDIA_QUARANTINE_RETENTION" default:"720h"` // 30 days
	// ProcessingConcurrency bounds how many image-processing jobs may run
	// at once, process-wide — see the concurrency=2 benchmark result.
	// Deliberately conservative pending a dedicated load test at higher
	// concurrency (see BENCHMARK_RESULTS.md's noted limitation).
	ProcessingConcurrency int `envconfig:"MEDIA_PROCESSING_CONCURRENCY" default:"2"`
	// ProcessingTimeout bounds a single image's processing wall time.
	ProcessingTimeout time.Duration `envconfig:"MEDIA_PROCESSING_TIMEOUT" default:"20s"`
	// UploadDir is the root directory uploaded/processed files are written
	// under, matching the existing (currently hardcoded) "./uploads" the
	// rest of the app uses — kept configurable here so tests can point it
	// at a temp directory instead of the live uploads/ tree.
	UploadDir string `envconfig:"MEDIA_UPLOAD_DIR" default:"./uploads"`
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
	if err := envconfig.Process("", &cfg.Media); err != nil {
		return nil, fmt.Errorf("media config: %w", err)
	}
	if cfg.Media.Enabled && cfg.Media.SigningSecret == "" {
		return nil, fmt.Errorf("media config: MEDIA_SIGNING_SECRET is required when MEDIA_PIPELINE_ENABLED=true")
	}

	return &cfg, nil
}
