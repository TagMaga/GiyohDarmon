package main

// cmd/seed/main.go — Run with: go run ./cmd/seed
//
// Reads DB_DSN from environment (same as the server).
// Safe to run multiple times — all operations are idempotent.

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/seed"
	"github.com/megamall/crm/pkg/database"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	db, err := database.Connect(cfg.Database)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	seedCfg, err := seed.ParseConfig()
	if err != nil {
		log.Fatalf("seed config: %v", err)
	}
	log.Printf("seed mode: %s", seedCfg.Mode)

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
