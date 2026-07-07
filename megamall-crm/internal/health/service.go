package health

// service.go — Health and readiness check logic (Phase 6).
//
// Health:   fast ping — is the app and DB alive?
// Readiness: deep check — is seed data present so the app can accept real traffic?

import (
	"context"
	"fmt"
	"time"

	"github.com/megamall/crm/internal/compensation"
	"gorm.io/gorm"
)

// HealthStatus is the response for GET /api/v1/health.
type HealthStatus struct {
	Status    string    `json:"status"`
	Database  string    `json:"database"`
	Migration string    `json:"migration_version"`
	Timestamp time.Time `json:"timestamp"`
}

// ReadinessStatus is the response for GET /api/v1/ready.
type ReadinessStatus struct {
	Ready  bool                   `json:"ready"`
	Checks map[string]interface{} `json:"checks"`
}

// Service performs health and readiness checks.
type Service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

// Health performs a lightweight DB ping and returns current status.
func (s *Service) Health(ctx context.Context) HealthStatus {
	dbStatus := "connected"
	sqlDB, err := s.db.DB()
	if err != nil || sqlDB.PingContext(ctx) != nil {
		dbStatus = "unreachable"
	}

	migration := s.migrationVersion(ctx)

	return HealthStatus{
		Status:    "ok",
		Database:  dbStatus,
		Migration: migration,
		Timestamp: time.Now().UTC(),
	}
}

// migrationVersion reads the latest applied goose migration version.
// Returns "unknown" if the table doesn't exist yet.
func (s *Service) migrationVersion(ctx context.Context) string {
	type row struct{ VersionID int64 }
	var r row
	err := s.db.WithContext(ctx).Raw(
		`SELECT COALESCE(MAX(version_id), 0) AS version_id
		 FROM goose_db_version WHERE is_applied = true`,
	).Scan(&r).Error
	if err != nil {
		return "unknown"
	}
	return fmt.Sprintf("%d", r.VersionID)
}

// Ready performs all readiness checks. Returns the aggregate status and individual check results.
func (s *Service) Ready(ctx context.Context) ReadinessStatus {
	checks := map[string]interface{}{}
	allOK := true

	// 1. Database reachable.
	dbOK := true
	sqlDB, err := s.db.DB()
	if err != nil || sqlDB.PingContext(ctx) != nil {
		dbOK = false
		allOK = false
	}
	checks["database"] = dbOK

	// 2. Owner user exists.
	ownerOK := s.countCheck(ctx, "users",
		"role = 'owner' AND deleted_at IS NULL", 1)
	checks["owner_user"] = ownerOK
	if !ownerOK {
		allOK = false
	}

	// 3. Default product exists (by seed SKU).
	productOK := s.countCheck(ctx, "products",
		"sku = 'TEST-001' AND deleted_at IS NULL", 1)
	checks["default_product"] = productOK
	if !productOK {
		allOK = false
	}

	// 4. All five commission types have at least one active global config.
	commOK := true
	for _, ct := range compensation.AllCommissionTypes {
		ok := s.countCheck(ctx, "commission_configs",
			fmt.Sprintf("commission_type = '%s' AND team_id IS NULL AND user_id IS NULL AND effective_to IS NULL", ct), 1)
		checks[fmt.Sprintf("commission_%s", string(ct))] = ok
		if !ok {
			commOK = false
			allOK = false
		}
	}
	checks["commission_configs"] = commOK

	// 5. Delivery settings singleton row exists.
	deliverySettingsOK := s.countCheck(ctx, "delivery_settings", "id = 1", 1)
	checks["delivery_settings"] = deliverySettingsOK
	if !deliverySettingsOK {
		allOK = false
	}

	return ReadinessStatus{Ready: allOK, Checks: checks}
}

// countCheck returns true if the table has at least `minCount` rows matching where.
func (s *Service) countCheck(ctx context.Context, table, where string, minCount int64) bool {
	var count int64
	err := s.db.WithContext(ctx).Table(table).Where(where).Count(&count).Error
	return err == nil && count >= minCount
}
