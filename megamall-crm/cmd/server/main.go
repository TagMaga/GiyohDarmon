package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/auth"
	"github.com/megamall/crm/internal/compensation"
	"github.com/megamall/crm/internal/courier"
	"github.com/megamall/crm/internal/customers"
	"github.com/megamall/crm/internal/dispatch"
	"github.com/megamall/crm/internal/finance"
	"github.com/megamall/crm/internal/health"
	"github.com/megamall/crm/internal/hierarchy"
	"github.com/megamall/crm/internal/inventory"
	"github.com/megamall/crm/internal/logistics"
	logistics_settings "github.com/megamall/crm/internal/logistics_settings"
	"github.com/megamall/crm/internal/orders"
	"github.com/megamall/crm/internal/products"
	delivery_settings "github.com/megamall/crm/internal/delivery_settings"
	"github.com/megamall/crm/internal/teams"
	"github.com/megamall/crm/internal/users"
	"github.com/megamall/crm/internal/warehouse"
	"github.com/megamall/crm/pkg/database"
	"github.com/megamall/crm/pkg/middleware"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// ── Database ──────────────────────────────────────────────────────────────
	db, err := database.Connect(cfg.Database)
	if err != nil {
		log.Fatalf("database connect: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("get sql.DB: %v", err)
	}
	defer sqlDB.Close()

	log.Println("database connected")

	// ── Repositories ─────────────────────────────────────────────────────────
	userRepo := users.NewRepository(db)
	teamRepo := teams.NewRepository(db)
	hierarchyRepo := hierarchy.NewRepository(db)
	authRepo := auth.NewRepository(db)
	activityRepo := activity.NewRepository(db)

	// ── Activity Logger ───────────────────────────────────────────────────────
	activityLogger := activity.NewLogger(activityRepo)

	// ── Cross-module adapters ─────────────────────────────────────────────────
	// Typed function adapters keep module boundaries clean without circular imports.

	userExistsFn := func(ctx context.Context, id uuid.UUID) (bool, error) {
		return userRepo.ExistsByID(ctx, id)
	}

	teamExistsFn := func(ctx context.Context, id uuid.UUID) (bool, error) {
		t, err := teamRepo.GetByID(ctx, id)
		if err != nil {
			return false, err
		}
		return t != nil, nil
	}

	teamForUserFn := func(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error) {
		h, err := hierarchyRepo.GetByUserID(ctx, userID)
		if err != nil {
			return nil, err
		}
		if h == nil {
			return nil, nil
		}
		return h.TeamID, nil
	}

	userByPhoneFn := func(ctx context.Context, phone string) (*users.User, error) {
		return userRepo.GetByPhone(ctx, phone)
	}

	// ── Services ─────────────────────────────────────────────────────────────
	userSvc := users.NewService(userRepo)
	teamSvc := teams.NewService(teamRepo, userExistsFn)
	hierarchySvc := hierarchy.NewService(hierarchyRepo, userExistsFn, teamExistsFn)
	authSvc := auth.NewService(authRepo, cfg.JWT, userByPhoneFn, teamForUserFn)

	// Wire role resolver after all services exist (breaks the circular init order).
	authSvc.SetRoleResolver(func(ctx context.Context, userID uuid.UUID) (users.Role, error) {
		u, err := userRepo.GetByID(ctx, userID)
		if err != nil {
			return "", err
		}
		if u == nil {
			return "", fmt.Errorf("user %s not found", userID)
		}
		return u.Role, nil
	})

	// ── Inject JWT validator into middleware package ───────────────────────────
	middleware.SetTokenValidator(func(token string) (*middleware.ContextClaims, error) {
		claims, err := authSvc.ValidateAccessToken(token)
		if err != nil {
			return nil, err
		}
		return &middleware.ContextClaims{
			UserID: claims.UserID,
			Role:   claims.Role,
			TeamID: claims.TeamID,
		}, nil
	})

	// ── Compensation module ───────────────────────────────────────────────────
	compensationRepo := compensation.NewRepository(db)
	compensationSvc := compensation.NewService(compensationRepo, activityLogger, db)
	compensationHandler := compensation.NewHandler(compensationSvc)

	// ── Phase 3: Products / Warehouse / Inventory ─────────────────────────────
	productsRepo := products.NewRepository(db)
	productsSvc := products.NewService(productsRepo, activityLogger)
	productsHandler := products.NewHandler(productsSvc)

	warehouseRepo := warehouse.NewRepository(db)
	warehouseSvc := warehouse.NewService(warehouseRepo, activityLogger)
	warehouseHandler := warehouse.NewHandler(warehouseSvc)

	inventoryRepo := inventory.NewRepository(db)
	inventorySvc := inventory.NewService(inventoryRepo, activityLogger)
	inventoryHandler := inventory.NewHandler(inventorySvc)

	// ── Phase 4: Customers + Orders ───────────────────────────────────────────
	customerRepo := customers.NewRepository(db)
	customerSvc := customers.NewService(customerRepo, activityLogger)
	customerHandler := customers.NewHandler(customerSvc)

	loc := cfg.Server.Location()

	orderRepo := orders.NewRepository(db, loc)
	orderSvc := orders.NewService(
		orderRepo,
		inventoryRepo,
		hierarchyRepo,
		teamRepo,
		compensationSvc,
		activityLogger,
		db,
	)
	orderHandler := orders.NewHandler(orderSvc)

	// ── Phase 5: Dispatch + Courier ───────────────────────────────────────────
	courierRepo := courier.NewRepository(db)
	courierSvc := courier.NewService(courierRepo, orderSvc, activityLogger, db)
	courierHandler := courier.NewHandler(courierSvc)

	dispatchRepo := dispatch.NewRepository(db)
	dispatchSvc := dispatch.NewService(dispatchRepo, orderSvc, activityLogger, db)
	dispatchHandler := dispatch.NewHandler(dispatchSvc, courierSvc)

	// ── Phase 6: Health checks ────────────────────────────────────────────────
	healthSvc := health.NewService(db)
	healthHandler := health.NewHandler(healthSvc)

	// ── Phase 15: Owner Finance Dashboard ─────────────────────────────────────
	financeRepo := finance.NewRepository(db)
	financeHandler := finance.NewHandler(financeRepo, loc)

	// ── Phase 17: Owner Logistics ─────────────────────────────────────────────
	logisticsRepo := logistics.NewRepository(db, loc)
	logisticsHandler := logistics.NewHandler(logisticsRepo, loc)

	// ── Rate-limit store (in-memory; swap for Redis store in production) ─────
	rateLimitStore := middleware.NewMemoryStore()

	// ── Handlers ─────────────────────────────────────────────────────────────
	authHandler := auth.NewHandler(authSvc)
	userHandler := users.NewHandler(userSvc)
	teamHandler := teams.NewHandler(teamSvc)
	hierarchyHandler := hierarchy.NewHandler(hierarchySvc)

	// ── Router ─────────────────────────────────────────────────────────────────
	gin.SetMode(cfg.Server.Mode)
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(middleware.RequestLogger())
	router.Use(middleware.CORS(middleware.NewCORSConfig(cfg.Server.CORSOrigins)))

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "megamall-crm"})
	})

	v1 := router.Group("/api/v1")
	{
		authHandler.RegisterRoutes(v1.Group("/auth"), rateLimitStore)
		userHandler.RegisterRoutes(v1.Group("/users"))
		teamHandler.RegisterRoutes(v1.Group("/teams"))
		hierarchyHandler.RegisterRoutes(v1.Group("/hierarchy"))
		compensationHandler.RegisterRoutes(v1.Group("/hr"))

		// Phase 3
		productsHandler.RegisterRoutes(v1)
		warehouseHandler.RegisterRoutes(v1.Group("/warehouses"))
		inventoryHandler.RegisterRoutes(v1.Group("/inventory"))

		// Phase 4
		customerHandler.RegisterRoutes(v1.Group("/customers"))
		orderHandler.RegisterRoutes(v1.Group("/orders"))

		// Phase 5
		dispatchHandler.RegisterRoutes(v1.Group("/dispatch"))
		courierHandler.RegisterRoutes(v1.Group("/courier"))

		// Phase 6: health checks (unauthenticated)
		healthHandler.RegisterRoutes(v1)

		// Delivery settings (GET: all authenticated roles; PUT: owner only)
		deliverySettingsHandler := delivery_settings.NewHandler(db)
		deliverySettingsHandler.RegisterRoutes(v1.Group("/settings/delivery", middleware.RequireAuth()))

		// Phase 15: Owner Finance Dashboard
		financeHandler.RegisterRoutes(v1.Group("/finance"))

		// Phase 17: Owner Logistics
		logisticsHandler.RegisterRoutes(v1.Group("/owner/logistics"))

		// Phase 2 (delivery rework): cities + per-courier payout tariffs.
		logisticsSettingsHandler := logistics_settings.NewHandler(db)
		logisticsSettingsHandler.RegisterRoutes(v1)

		// File uploads — saves to ./uploads/ and returns a URL
		uploadAuth := middleware.RequireAuth()
		v1.POST("/uploads", uploadAuth, func(c *gin.Context) {
			file, header, err := c.Request.FormFile("file")
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": "BAD_REQUEST", "message": "file is required"}})
				return
			}
			defer file.Close()

			ext := filepath.Ext(header.Filename)
			if ext == "" {
				ext = ".jpg"
			}
			filename := uuid.New().String() + ext

			if err := os.MkdirAll("./uploads", 0755); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": "INTERNAL", "message": "storage error"}})
				return
			}

			dst, err := os.Create(filepath.Join("./uploads", filename))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": "INTERNAL", "message": "storage error"}})
				return
			}
			defer dst.Close()

			if _, err := io.Copy(dst, file); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": "INTERNAL", "message": "write error"}})
				return
			}

			c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"url": "/uploads/" + filename}})
		})
	}

	// Serve uploaded files
	router.Static("/uploads", "./uploads")

	// ── HTTP Server ────────────────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	go func() {
		log.Printf("server listening on :%s (mode: %s)", cfg.Server.Port, cfg.Server.Mode)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	// ── Graceful shutdown ──────────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("shutdown signal received")

	ctx, cancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownTimeout)
	defer cancel()

	// Drain activity log buffer before exit.
	activityLogger.Shutdown(ctx)

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("server force shutdown: %v", err)
	}
	log.Println("server stopped cleanly")
}
