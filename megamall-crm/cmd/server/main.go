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
	"strings"
	"syscall"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/auth"
	"github.com/megamall/crm/internal/budget"
	"github.com/megamall/crm/internal/compensation"
	"github.com/megamall/crm/internal/courier"
	"github.com/megamall/crm/internal/customers"
	delivery_settings "github.com/megamall/crm/internal/delivery_settings"
	"github.com/megamall/crm/internal/dispatch"
	"github.com/megamall/crm/internal/finance"
	"github.com/megamall/crm/internal/health"
	"github.com/megamall/crm/internal/hierarchy"
	"github.com/megamall/crm/internal/inventory"
	"github.com/megamall/crm/internal/logistics"
	logistics_settings "github.com/megamall/crm/internal/logistics_settings"
	"github.com/megamall/crm/internal/orders"
	"github.com/megamall/crm/internal/payouts"
	"github.com/megamall/crm/internal/products"
	"github.com/megamall/crm/internal/teams"
	"github.com/megamall/crm/internal/uploads"
	"github.com/megamall/crm/internal/users"
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

	userBriefsFn := func(ctx context.Context, ids []uuid.UUID) ([]hierarchy.UserBrief, error) {
		list, err := userRepo.GetByIDs(ctx, ids)
		if err != nil {
			return nil, err
		}
		out := make([]hierarchy.UserBrief, len(list))
		for i, u := range list {
			out[i] = hierarchy.UserBrief{
				ID:        u.ID,
				FullName:  u.FullName,
				Phone:     u.Phone,
				Role:      string(u.Role),
				AvatarURL: u.AvatarURL,
			}
		}
		return out, nil
	}

	teamBriefFn := func(ctx context.Context, id uuid.UUID) (*hierarchy.TeamBrief, error) {
		t, err := teamRepo.GetByID(ctx, id)
		if err != nil {
			return nil, err
		}
		if t == nil {
			return nil, nil
		}
		return &hierarchy.TeamBrief{
			ID:         t.ID,
			Name:       t.Name,
			TeamLeadID: t.TeamLeadID,
			ManagerID:  t.ManagerID,
		}, nil
	}

	// ── Services ─────────────────────────────────────────────────────────────
	userSvc := users.NewService(userRepo)
	teamSvc := teams.NewService(teamRepo, userExistsFn)
	hierarchySvc := hierarchy.NewService(hierarchyRepo, userExistsFn, teamExistsFn, userBriefsFn, teamBriefFn)
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

	// Wire is_active lookup so deactivated users lose access before their
	// access token naturally expires (checked on every request + on refresh).
	authSvc.SetActiveChecker(func(ctx context.Context, userID uuid.UUID) (bool, error) {
		u, err := userRepo.GetByID(ctx, userID)
		if err != nil {
			return false, err
		}
		if u == nil {
			return false, nil
		}
		return u.IsActive, nil
	})

	// Wire session revocation so deactivating/deleting a user immediately
	// invalidates their existing refresh tokens.
	userSvc.SetSessionRevoker(authSvc.Logout)

	// ── Inject JWT validator into middleware package ───────────────────────────
	middleware.SetTokenValidator(func(ctx context.Context, token string) (*middleware.ContextClaims, error) {
		claims, err := authSvc.ValidateAccessToken(ctx, token)
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

	// ── Phase 3: Products / Inventory ─────────────────────────────────────────
	productsRepo := products.NewRepository(db)
	productsSvc := products.NewService(productsRepo, activityLogger)
	productsHandler := products.NewHandler(productsSvc)

	inventoryRepo := inventory.NewRepository(db)
	inventorySvc := inventory.NewService(inventoryRepo, activityLogger)
	inventoryHandler := inventory.NewHandler(inventorySvc)

	// ── Phase 4: Customers + Orders ───────────────────────────────────────────
	customerRepo := customers.NewRepository(db)
	customerSvc := customers.NewService(customerRepo, activityLogger)
	customerHandler := customers.NewHandler(customerSvc)

	loc := cfg.Server.Location()

	// Finance is constructed before Budget: Budget's live balance formula reads
	// Finance's accumulated net profit (internal/finance.Repository.GetNetProfit)
	// instead of storing a per-order profit transfer.
	financeRepo := finance.NewRepository(db)
	financeHandler := finance.NewHandler(financeRepo, loc)

	budgetRepo := budget.NewRepository(db, loc, financeRepo)
	budgetHandler := budget.NewHandler(budgetRepo)

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
		deliverySettingsHandler := delivery_settings.NewHandler(db, activityLogger)
		deliverySettingsHandler.RegisterRoutes(v1.Group("/settings/delivery", middleware.RequireAuth()))

		// Phase 15: Owner Finance Dashboard
		financeHandler.RegisterRoutes(v1.Group("/finance"))

		// Company Budget
		budgetHandler.RegisterRoutes(v1.Group("/owner/budget"))

		// Phase 17: Owner Logistics
		logisticsHandler.RegisterRoutes(v1.Group("/owner/logistics"))

		// Phase 2 (delivery rework): cities + per-courier payout tariffs.
		logisticsSettingsHandler := logistics_settings.NewHandler(db, activityLogger)
		logisticsSettingsHandler.RegisterRoutes(v1)

		// Payouts: generalized ledger (Team Lead → Manager/Seller, Owner → anyone).
		payoutsRepo := payouts.NewRepository(db)
		payoutsSvc := payouts.NewService(payoutsRepo, compensationSvc)
		payoutsHandler := payouts.NewHandler(payoutsSvc)
		payoutsHandler.RegisterRoutes(v1.Group("/payouts"))

		// File uploads — saves to ./uploads/ and returns a URL.
		// The allowed type/size is enforced by internal/uploads.Validate via
		// magic-byte sniffing — the client-supplied filename/extension is
		// never trusted for either the check or the persisted extension.
		uploadAuth := middleware.RequireAuth()
		v1.POST("/uploads", uploadAuth, func(c *gin.Context) {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, uploads.MaxFileSize+64<<10)

			file, header, err := c.Request.FormFile("file")
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": "BAD_REQUEST", "message": "file is required"}})
				return
			}
			defer file.Close()

			ext, _, err := uploads.Validate(file, header.Size)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
				return
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

	// Serve uploaded files. Never trusts the on-disk file's extension for the
	// Content-Type — re-sniffs the actual bytes on every request via
	// uploads.SniffAllowed, so a file that predates this validation (or
	// somehow bypassed it) still can't be served as anything other than an
	// allowed type. Non-image types are forced to download rather than
	// render inline.
	router.GET("/uploads/:filename", func(c *gin.Context) {
		// :filename is a single gin path segment (no "/"), but reject any
		// ".." defensively before it ever reaches the filesystem.
		name := c.Param("filename")
		if name == "" || strings.Contains(name, "..") || strings.Contains(name, "/") {
			c.Status(http.StatusNotFound)
			return
		}

		f, err := os.Open(filepath.Join("./uploads", name))
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		defer f.Close()

		info, err := f.Stat()
		if err != nil || info.IsDir() {
			c.Status(http.StatusNotFound)
			return
		}

		contentType, ok := uploads.SniffAllowed(f)
		if !ok {
			c.Status(http.StatusNotFound)
			return
		}

		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Content-Type", contentType)
		if !uploads.IsImage(contentType) {
			c.Header("Content-Disposition", `attachment; filename="`+name+`"`)
		}
		http.ServeContent(c.Writer, c.Request, name, info.ModTime(), f)
	})

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
