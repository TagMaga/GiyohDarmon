package compensation

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// Repository handles all persistence for the compensation module.
type Repository struct {
	db *gorm.DB
}

// NewRepository creates a compensation repository backed by db.
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// ─── Commission config ─────────────────────────────────────────────────────────

// CreateConfig inserts a new commission config row inside an existing transaction.
// The caller is responsible for closing the previous active config first.
func (r *Repository) CreateConfig(ctx context.Context, tx *gorm.DB, cfg *CommissionConfig) error {
	if err := tx.WithContext(ctx).Create(cfg).Error; err != nil {
		return fmt.Errorf("create commission config: %w", err)
	}
	return nil
}

// CloseConfig sets effective_to on a config row, closing its active window.
// Only succeeds if the row currently has effective_to IS NULL (idempotency guard).
func (r *Repository) CloseConfig(ctx context.Context, tx *gorm.DB, id uuid.UUID, effectiveTo time.Time) error {
	result := tx.WithContext(ctx).
		Model(&CommissionConfig{}).
		Where("id = ? AND effective_to IS NULL", id).
		Update("effective_to", effectiveTo)
	if result.Error != nil {
		return fmt.Errorf("close commission config: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("commission config %s not found or already closed", id)
	}
	return nil
}

// GetActiveConfig finds the single open config (effective_to IS NULL) for the
// given scope and commission type.
//
// Scope is determined by userID / teamID:
//   userID != nil          → employee-level
//   teamID != nil, userID = nil → team-level
//   both nil               → global default
//
// Returns nil, nil if no active config exists for this scope/type.
func (r *Repository) GetActiveConfig(
	ctx context.Context,
	commissionType CommissionType,
	userID, teamID *uuid.UUID,
) (*CommissionConfig, error) {
	query := r.db.WithContext(ctx).
		Where("commission_type = ? AND effective_to IS NULL", commissionType)

	if userID != nil {
		query = query.Where("user_id = ?", userID)
	} else {
		query = query.Where("user_id IS NULL")
	}

	if teamID != nil {
		query = query.Where("team_id = ?", teamID)
	} else {
		query = query.Where("team_id IS NULL")
	}

	var cfg CommissionConfig
	if err := query.First(&cfg).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get active commission config: %w", err)
	}
	return &cfg, nil
}

// GetConfigByID loads a single config by its primary key.
// Returns nil, nil if not found.
func (r *Repository) GetConfigByID(ctx context.Context, id uuid.UUID) (*CommissionConfig, error) {
	var cfg CommissionConfig
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&cfg).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get commission config by id: %w", err)
	}
	return &cfg, nil
}

// ResolveRateAtTime returns the config whose window covers `at`.
//
// Used by RateResolver. The query matches:
//   effective_from <= at AND (effective_to IS NULL OR effective_to > at)
//
// Returns nil, nil if no config covers that timestamp for this scope/type.
func (r *Repository) ResolveRateAtTime(
	ctx context.Context,
	commissionType CommissionType,
	userID, teamID *uuid.UUID,
	at time.Time,
) (*CommissionConfig, error) {
	query := r.db.WithContext(ctx).
		Where("commission_type = ?", commissionType).
		Where("effective_from <= ?", at).
		Where("effective_to IS NULL OR effective_to > ?", at)

	if userID != nil {
		query = query.Where("user_id = ?", userID)
	} else {
		query = query.Where("user_id IS NULL")
	}

	if teamID != nil {
		query = query.Where("team_id = ?", teamID)
	} else {
		query = query.Where("team_id IS NULL")
	}

	var cfg CommissionConfig
	if err := query.Order("effective_from DESC").First(&cfg).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("resolve rate at time: %w", err)
	}
	return &cfg, nil
}

// ListConfigs returns a paginated, filtered list of commission configs.
func (r *Repository) ListConfigs(
	ctx context.Context,
	filter ConfigFilter,
	p pagination.Params,
) ([]CommissionConfig, int, error) {
	query := r.db.WithContext(ctx).Model(&CommissionConfig{})

	if filter.UserID != nil {
		query = query.Where("user_id = ?", filter.UserID)
	}
	if filter.TeamID != nil {
		query = query.Where("team_id = ?", filter.TeamID)
	}
	if filter.CommissionType != nil {
		query = query.Where("commission_type = ?", *filter.CommissionType)
	}
	if filter.From != nil {
		query = query.Where("created_at >= ?", filter.From)
	}
	if filter.To != nil {
		query = query.Where("created_at <= ?", filter.To)
	}
	switch filter.Scope {
	case "global":
		query = query.Where("user_id IS NULL AND team_id IS NULL")
	case "team":
		query = query.Where("team_id IS NOT NULL AND user_id IS NULL")
	case "employee":
		query = query.Where("user_id IS NOT NULL")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count commission configs: %w", err)
	}

	var list []CommissionConfig
	if err := query.
		Order("created_at DESC").
		Limit(p.Limit).
		Offset(p.Offset()).
		Find(&list).Error; err != nil {
		return nil, 0, fmt.Errorf("list commission configs: %w", err)
	}

	return list, int(total), nil
}

// ─── Delivery tariff ──────────────────────────────────────────────────────────

// CreateTariff inserts a tariff header inside an existing transaction.
func (r *Repository) CreateTariff(ctx context.Context, tx *gorm.DB, t *DeliveryTariff) error {
	if err := tx.WithContext(ctx).Create(t).Error; err != nil {
		return fmt.Errorf("create delivery tariff: %w", err)
	}
	return nil
}

// CreateTariffRanges bulk-inserts tier ranges inside an existing transaction.
func (r *Repository) CreateTariffRanges(ctx context.Context, tx *gorm.DB, ranges []DeliveryTariffRange) error {
	if len(ranges) == 0 {
		return nil
	}
	if err := tx.WithContext(ctx).Create(&ranges).Error; err != nil {
		return fmt.Errorf("create tariff ranges: %w", err)
	}
	return nil
}

// CloseTariff sets effective_to on a tariff and marks it inactive.
// Only updates rows where effective_to IS NULL.
func (r *Repository) CloseTariff(ctx context.Context, tx *gorm.DB, id uuid.UUID, effectiveTo time.Time) error {
	result := tx.WithContext(ctx).
		Model(&DeliveryTariff{}).
		Where("id = ? AND effective_to IS NULL", id).
		Updates(map[string]interface{}{
			"effective_to": effectiveTo,
			"is_active":    false,
		})
	if result.Error != nil {
		return fmt.Errorf("close delivery tariff: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("delivery tariff %s not found or already closed", id)
	}
	return nil
}

// GetActiveTariff returns the single currently-open tariff (is_active=true, effective_to IS NULL)
// with its ranges preloaded. Returns nil, nil if none exists.
func (r *Repository) GetActiveTariff(ctx context.Context) (*DeliveryTariff, error) {
	var t DeliveryTariff
	err := r.db.WithContext(ctx).
		Preload("Ranges", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC")
		}).
		Where("is_active = true AND effective_to IS NULL").
		First(&t).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get active tariff: %w", err)
	}
	return &t, nil
}

// GetActiveTariffAtTime returns the tariff active at a specific timestamp.
// Used by TariffCalculator during snapshot building.
// Returns nil, nil if no tariff covers that time.
func (r *Repository) GetActiveTariffAtTime(ctx context.Context, at time.Time) (*DeliveryTariff, error) {
	var t DeliveryTariff
	err := r.db.WithContext(ctx).
		Preload("Ranges", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC")
		}).
		Where("effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)", at, at).
		Order("effective_from DESC").
		First(&t).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get tariff at time: %w", err)
	}
	return &t, nil
}

// GetTariffByID loads a single tariff with its ranges. Returns nil, nil if not found.
func (r *Repository) GetTariffByID(ctx context.Context, id uuid.UUID) (*DeliveryTariff, error) {
	var t DeliveryTariff
	err := r.db.WithContext(ctx).
		Preload("Ranges", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC")
		}).
		Where("id = ?", id).
		First(&t).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get tariff by id: %w", err)
	}
	return &t, nil
}

// ListTariffs returns a paginated list of all tariffs (active and historical),
// without preloading ranges (for brevity in list views).
func (r *Repository) ListTariffs(ctx context.Context, p pagination.Params) ([]DeliveryTariff, int, error) {
	var total int64
	if err := r.db.WithContext(ctx).Model(&DeliveryTariff{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count tariffs: %w", err)
	}

	var list []DeliveryTariff
	if err := r.db.WithContext(ctx).
		Order("created_at DESC").
		Limit(p.Limit).
		Offset(p.Offset()).
		Find(&list).Error; err != nil {
		return nil, 0, fmt.Errorf("list tariffs: %w", err)
	}
	return list, int(total), nil
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

// CreateSnapshot inserts an order_financial_snapshots row inside an existing transaction.
// Called by SnapshotBuilder.BuildAndSave from Phase 4 order creation.
func (r *Repository) CreateSnapshot(ctx context.Context, tx *gorm.DB, s *OrderFinancialSnapshot) error {
	if err := tx.WithContext(ctx).Create(s).Error; err != nil {
		return fmt.Errorf("create snapshot: %w", err)
	}
	return nil
}

// GetSnapshotByID loads a snapshot by its primary key. Returns nil, nil if not found.
func (r *Repository) GetSnapshotByID(ctx context.Context, id uuid.UUID) (*OrderFinancialSnapshot, error) {
	var s OrderFinancialSnapshot
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&s).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get snapshot by id: %w", err)
	}
	return &s, nil
}

// GetSnapshotByOrderID loads the snapshot for a specific order.
// Returns nil, nil if not found.
func (r *Repository) GetSnapshotByOrderID(ctx context.Context, orderID uuid.UUID) (*OrderFinancialSnapshot, error) {
	var s OrderFinancialSnapshot
	if err := r.db.WithContext(ctx).Where("order_id = ?", orderID).First(&s).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get snapshot by order id: %w", err)
	}
	return &s, nil
}

// ─── Financial event ──────────────────────────────────────────────────────────

// CreateFinancialEvent inserts an immutable financial ledger entry inside a transaction.
// Called by the Financial Engine (Phase 4) on order status transitions.
func (r *Repository) CreateFinancialEvent(ctx context.Context, tx *gorm.DB, e *FinancialEvent) error {
	if err := tx.WithContext(ctx).Create(e).Error; err != nil {
		return fmt.Errorf("create financial event: %w", err)
	}
	return nil
}

// ListFinancialEventsByOrderID returns all financial events for a given order,
// ordered chronologically. Added in Phase 6 for E2E validation and reporting.
func (r *Repository) ListFinancialEventsByOrderID(ctx context.Context, orderID uuid.UUID) ([]FinancialEvent, error) {
	var rows []FinancialEvent
	if err := r.db.WithContext(ctx).
		Where("order_id = ?", orderID).
		Order("created_at ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list financial events by order: %w", err)
	}
	return rows, nil
}

// ─── Employee compensation ─────────────────────────────────────────────────────

// GetActiveEmployeeCompensation returns the active compensation record for a user.
// Returns nil, nil if no active record exists.
func (r *Repository) GetActiveEmployeeCompensation(ctx context.Context, userID uuid.UUID) (*EmployeeCompensation, error) {
	var ec EmployeeCompensation
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND is_active = true", userID).
		Order("effective_from DESC").
		First(&ec).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get active employee compensation: %w", err)
	}
	return &ec, nil
}

// ListEmployeeCompensations returns all compensation records for a user (most recent first).
func (r *Repository) ListEmployeeCompensations(ctx context.Context, userID uuid.UUID) ([]EmployeeCompensation, error) {
	var rows []EmployeeCompensation
	if err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("effective_from DESC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list employee compensations: %w", err)
	}
	return rows, nil
}

// CreateEmployeeCompensation closes the previous active record and inserts the new one.
func (r *Repository) CreateEmployeeCompensation(ctx context.Context, ec *EmployeeCompensation) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Close any currently active record for this user.
		if err := tx.Model(&EmployeeCompensation{}).
			Where("user_id = ? AND is_active = true", ec.UserID).
			Updates(map[string]interface{}{
				"is_active":    false,
				"effective_to": ec.EffectiveFrom,
			}).Error; err != nil {
			return fmt.Errorf("close previous compensation: %w", err)
		}
		if err := tx.Create(ec).Error; err != nil {
			return fmt.Errorf("create employee compensation: %w", err)
		}
		return nil
	})
}
