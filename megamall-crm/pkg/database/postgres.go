package database

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/megamall/crm/config"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Connect initializes a GORM DB connection with production-grade pool settings.
func Connect(cfg config.DatabaseConfig) (*gorm.DB, error) {
	gormLogger := buildLogger(cfg.SlowQueryMS)

	db, err := gorm.Open(postgres.Open(cfg.DSN), &gorm.Config{
		Logger:                                   gormLogger,
		PrepareStmt:                              true,
		DisableForeignKeyConstraintWhenMigrating: true, // Goose manages FKs
		NowFunc: func() time.Time {
			return time.Now().UTC()
		},
	})
	if err != nil {
		return nil, fmt.Errorf("gorm open: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("get sql.DB: %w", err)
	}

	sqlDB.SetMaxOpenConns(cfg.MaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(cfg.ConnMaxLifetime)
	sqlDB.SetConnMaxIdleTime(cfg.ConnMaxIdleTime)

	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("db ping: %w", err)
	}

	return db, nil
}

func buildLogger(slowQueryMS int) logger.Interface {
	slowThreshold := time.Duration(slowQueryMS) * time.Millisecond

	return logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             slowThreshold,
			LogLevel:                  logger.Warn, // Only log slow queries + errors in prod
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)
}
