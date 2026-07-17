package main

// cmd/seed/main.go — Run with: go run ./cmd/seed
//
// Reads DB_DSN from environment (same as the server).
// Safe to run multiple times — all operations are idempotent.
//
// SEED_MODE=production is a legitimate, intentional use of this tool
// (bootstrapping the owner account) already gated by requiring an explicit
// SEED_OWNER_PASSWORD — see internal/seed/config.go. dev/staging modes have
// no such gate and default to a known demo password, so those two refuse to
// run at all if DB_DSN looks production-shaped (see pkg/dbsafety): the
// danger this guards against is SEED_MODE being left at its "dev" default
// while DB_DSN accidentally points at production, not the deliberate
// production path.

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/seed"
	"github.com/megamall/crm/pkg/database"
	"github.com/megamall/crm/pkg/dbsafety"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	seedCfg, err := seed.ParseConfig()
	if err != nil {
		log.Fatalf("seed config: %v", err)
	}
	log.Printf("seed mode: %s", seedCfg.Mode)

	if seedCfg.Mode != seed.ModeProduction {
		if err := dbsafety.RefuseProduction(cfg.Database.DSN); err != nil {
			log.Fatalf("refusing to run SEED_MODE=%s against what looks like production (pass SEED_MODE=production with SEED_OWNER_PASSWORD if this is intentional): %v", seedCfg.Mode, err)
		}
	}

	db, err := database.Connect(cfg.Database)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	result, err := seed.Run(ctx, db, seedCfg)
	if err != nil {
		log.Printf("seed finished with errors: %v", err)
		if result != nil && len(result.Errors) > 0 {
			for _, e := range result.Errors {
				log.Printf("  - %s", e)
			}
		}
		os.Exit(1)
	}

	log.Printf("done — %d created, %d skipped", result.Created, result.Skipped)
}
