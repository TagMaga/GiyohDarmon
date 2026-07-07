package seed

// seeder.go — Idempotent demo data seeder (Phase 6).
//
// Design rules:
//   1. Each entity uses a check-before-insert pattern (no UPSERT that would
//      overwrite production data).
//   2. Running seed multiple times is safe — already-existing rows are skipped
//      and reported as "skipped".
//   3. All model structs are imported directly from domain packages — no
//      business logic is reimplemented here.
//   4. Commission types use ONLY compensation.AllCommissionTypes from Phase 2.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/compensation"
	"github.com/megamall/crm/internal/inventory"
	"github.com/megamall/crm/internal/products"
	"github.com/megamall/crm/internal/teams"
	"github.com/megamall/crm/internal/users"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// Result summarises what the seeder created vs skipped.
type Result struct {
	Created int
	Skipped int
	Errors  []string
}

func (r *Result) created(label string) {
	r.Created++
	log.Printf("  ✓ created  %s", label)
}

func (r *Result) skipped(label string) {
	r.Skipped++
	log.Printf("  · skipped  %s (already exists)", label)
}

func (r *Result) fail(label string, err error) {
	r.Errors = append(r.Errors, fmt.Sprintf("%s: %v", label, err))
	log.Printf("  ✗ FAILED   %s: %v", label, err)
}

// Run seeds demo data according to cfg.  Safe to call multiple times.
//
// Behaviour by mode:
//
//	dev / staging  — creates all 7 demo accounts + team, hierarchy, catalog, commissions
//	production     — creates owner account only + catalog, commissions (no demo staff)
func Run(ctx context.Context, db *gorm.DB, cfg *Config) (*Result, error) {
	res := &Result{}
	log.Printf("=== megamall-crm seeder (mode: %s) ===", cfg.Mode)

	// ── Users ─────────────────────────────────────────────────────────────────
	log.Println("--- Users ---")
	userIDs := map[string]uuid.UUID{}
	for _, u := range demoUsers {
		// In production mode only the owner account is seeded.
		if !cfg.seedsAllUsers() && u.role != "owner" {
			log.Printf("  · skipped  user %s (%s) — production mode seeds owner only", u.phone, u.role)
			continue
		}

		password := cfg.passwordFor(u.role)
		id, err := seedUser(ctx, db, u, password)
		if err != nil {
			res.fail("user "+u.phone, err)
			continue
		}
		if id == uuid.Nil {
			res.skipped("user " + u.phone)
			// Still need the existing ID for hierarchy wiring.
			existing, _ := getUserByPhone(ctx, db, u.phone)
			if existing != nil {
				userIDs[u.role] = existing.ID
			}
		} else {
			res.created("user " + u.phone + " (" + u.role + ")")
			userIDs[u.role] = id
		}
	}

	// ── Team + Hierarchy (dev/staging only) ──────────────────────────────────
	var teamID uuid.UUID
	if cfg.seedsAllUsers() {
		log.Println("--- Team ---")
		var err error
		teamID, err = seedTeam(ctx, db, res, userIDs)
		if err != nil {
			return res, fmt.Errorf("seed team: %w", err)
		}

		log.Println("--- User Hierarchy ---")
		seedHierarchy(ctx, db, res, teamID, userIDs)
	} else {
		log.Println("--- Team + Hierarchy skipped (production mode) ---")
	}

	// ── Supplier ──────────────────────────────────────────────────────────────
	log.Println("--- Supplier ---")
	supplierID, err := seedSupplier(ctx, db, res)
	if err != nil {
		return res, fmt.Errorf("seed supplier: %w", err)
	}

	// ── Product ───────────────────────────────────────────────────────────────
	log.Println("--- Product ---")
	productID, err := seedProduct(ctx, db, res, supplierID)
	if err != nil {
		return res, fmt.Errorf("seed product: %w", err)
	}

	// ── Inventory ─────────────────────────────────────────────────────────────
	log.Println("--- Inventory ---")
	ownerID := userIDs["owner"]
	if ownerID == uuid.Nil {
		// Owner already existed — fetch their ID.
		existing, _ := getUserByPhone(ctx, db, demoUsers[0].phone)
		if existing != nil {
			ownerID = existing.ID
		}
	}
	seedInventory(ctx, db, res, productID, ownerID)

	// ── Commission configs ─────────────────────────────────────────────────────
	log.Println("--- Commission Configs ---")
	ownerPtr := &ownerID
	seedCommissionConfigs(ctx, db, res, ownerPtr)

	log.Printf("=== seed complete: %d created, %d skipped, %d errors ===",
		res.Created, res.Skipped, len(res.Errors))

	if len(res.Errors) > 0 {
		return res, fmt.Errorf("seed completed with %d error(s)", len(res.Errors))
	}
	return res, nil
}

// ─── Users ────────────────────────────────────────────────────────────────────

// seedUser inserts the user if their phone doesn't exist.
// Returns (newID, nil) on insert, (uuid.Nil, nil) if already existed.
// password is supplied by the caller (derived from Config) — not stored on demoUser.
func seedUser(ctx context.Context, db *gorm.DB, u demoUser, password string) (uuid.UUID, error) {
	existing, err := getUserByPhone(ctx, db, u.phone)
	if err != nil {
		return uuid.Nil, err
	}
	if existing != nil {
		return uuid.Nil, nil // already exists
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return uuid.Nil, fmt.Errorf("hash password: %w", err)
	}

	id := uuid.New()
	row := users.User{
		ID:           id,
		Phone:        u.phone,
		PasswordHash: string(hash),
		FullName:     u.fullName,
		Role:         users.Role(u.role),
		IsActive:     true,
	}
	if err := db.WithContext(ctx).Create(&row).Error; err != nil {
		return uuid.Nil, fmt.Errorf("create user: %w", err)
	}
	return id, nil
}

func getUserByPhone(ctx context.Context, db *gorm.DB, phone string) (*users.User, error) {
	var u users.User
	err := db.WithContext(ctx).Where("phone = ?", phone).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// ─── Team ─────────────────────────────────────────────────────────────────────

func seedTeam(ctx context.Context, db *gorm.DB, res *Result, userIDs map[string]uuid.UUID) (uuid.UUID, error) {
	var existing teams.Team
	err := db.WithContext(ctx).Where("name = ?", DefaultTeamName).First(&existing).Error
	if err == nil {
		res.skipped("team " + DefaultTeamName)
		return existing.ID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return uuid.Nil, err
	}

	tlID := ptr(userIDs["sales_team_lead"])
	mgrID := ptr(userIDs["manager"])

	t := teams.Team{
		ID:         uuid.New(),
		Name:       DefaultTeamName,
		TeamLeadID: tlID,
		ManagerID:  mgrID,
		IsActive:   true,
	}
	if err := db.WithContext(ctx).Create(&t).Error; err != nil {
		return uuid.Nil, err
	}
	res.created("team " + DefaultTeamName)
	return t.ID, nil
}

// ─── User Hierarchy ───────────────────────────────────────────────────────────

type hierarchyRow struct {
	ID     uuid.UUID  `gorm:"type:uuid;primaryKey"`
	UserID uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex"`
	TeamID *uuid.UUID `gorm:"type:uuid"`
}

func (hierarchyRow) TableName() string { return "user_hierarchy" }

func seedHierarchy(ctx context.Context, db *gorm.DB, res *Result, teamID uuid.UUID, userIDs map[string]uuid.UUID) {
	// Wire seller, manager, team_lead into the default team.
	rolesInTeam := []string{"seller", "manager", "sales_team_lead"}
	for _, role := range rolesInTeam {
		uid, ok := userIDs[role]
		if !ok || uid == uuid.Nil {
			// Try fetching existing user for this role.
			var u users.User
			if err := db.WithContext(ctx).Where("role = ?", role).First(&u).Error; err == nil {
				uid = u.ID
			} else {
				continue
			}
		}

		var existing hierarchyRow
		err := db.WithContext(ctx).Where("user_id = ?", uid).First(&existing).Error
		if err == nil {
			res.skipped("hierarchy for " + role)
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			res.fail("hierarchy "+role, err)
			continue
		}

		row := hierarchyRow{
			ID:     uuid.New(),
			UserID: uid,
			TeamID: &teamID,
		}
		if err := db.WithContext(ctx).Create(&row).Error; err != nil {
			res.fail("hierarchy "+role, err)
			continue
		}
		res.created("hierarchy for " + role)
	}
}

// ─── Supplier ─────────────────────────────────────────────────────────────────

func seedSupplier(ctx context.Context, db *gorm.DB, res *Result) (uuid.UUID, error) {
	var existing products.Supplier
	err := db.WithContext(ctx).Where("name = ?", DefaultSupplierName).First(&existing).Error
	if err == nil {
		res.skipped("supplier " + DefaultSupplierName)
		return existing.ID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return uuid.Nil, err
	}

	s := products.Supplier{
		ID:       uuid.New(),
		Name:     DefaultSupplierName,
		IsActive: true,
	}
	if err := db.WithContext(ctx).Create(&s).Error; err != nil {
		return uuid.Nil, err
	}
	res.created("supplier " + DefaultSupplierName)
	return s.ID, nil
}

// ─── Product ──────────────────────────────────────────────────────────────────

func seedProduct(ctx context.Context, db *gorm.DB, res *Result, supID uuid.UUID) (uuid.UUID, error) {
	var existing products.Product
	err := db.WithContext(ctx).Where("sku = ? AND deleted_at IS NULL", DefaultProductSKU).First(&existing).Error
	if err == nil {
		res.skipped("product " + DefaultProductSKU)
		return existing.ID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return uuid.Nil, err
	}

	sale := DefaultProductSalePrice
	purchase := DefaultProductPurchasePrice

	p := products.Product{
		ID:            uuid.New(),
		SKU:           DefaultProductSKU,
		Name:          DefaultProductName,
		SalePrice:     &sale,
		PurchasePrice: &purchase,
		SupplierID:    &supID,
		IsActive:      true,
	}
	if err := db.WithContext(ctx).Create(&p).Error; err != nil {
		return uuid.Nil, err
	}
	res.created("product " + DefaultProductSKU)
	return p.ID, nil
}

// ─── Inventory ────────────────────────────────────────────────────────────────

func seedInventory(ctx context.Context, db *gorm.DB, res *Result, productID, createdBy uuid.UUID) {
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Check existing inventory row.
		var existing inventory.Inventory
		err := tx.WithContext(ctx).
			Where("product_id = ?", productID).
			First(&existing).Error

		if err == nil {
			if batchErr := ensureSeedBatch(ctx, tx, res, existing, createdBy); batchErr != nil {
				return batchErr
			}
			if existing.Quantity >= DefaultInventoryQty {
				res.skipped(fmt.Sprintf("inventory %s (qty=%d)", productID, existing.Quantity))
				return nil
			}
			// Quantity is below expected — skip to avoid double-stocking.
			res.skipped(fmt.Sprintf("inventory exists (qty=%d, seed expects %d)", existing.Quantity, DefaultInventoryQty))
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		// Create inventory row.
		invRow := inventory.Inventory{
			ID:                uuid.New(),
			ProductID:         productID,
			Quantity:          DefaultInventoryQty,
			ReservedQuantity:  0,
			LowStockThreshold: DefaultLowStockThreshold,
		}
		if err := tx.WithContext(ctx).Create(&invRow).Error; err != nil {
			return fmt.Errorf("create inventory: %w", err)
		}

		// Insert purchase movement (always positive, direction = purchase = add).
		reason := "seed: initial stock"
		m := inventory.Movement{
			ID:               uuid.New(),
			ProductID:        productID,
			MovementType:     inventory.MovementPurchase,
			Quantity:         DefaultInventoryQty,
			PreviousQuantity: 0,
			NewQuantity:      DefaultInventoryQty,
			CreatedBy:        createdBy,
			Reason:           &reason,
		}
		if err := tx.WithContext(ctx).Create(&m).Error; err != nil {
			return fmt.Errorf("create movement: %w", err)
		}
		if err := createSeedBatch(ctx, tx, productID, DefaultInventoryQty, DefaultProductPurchasePrice, &m.ID, &createdBy); err != nil {
			return err
		}

		res.created(fmt.Sprintf("inventory %s (qty=%d)", DefaultProductSKU, DefaultInventoryQty))
		return nil
	})
	if err != nil {
		res.fail("inventory", err)
	}
}

func ensureSeedBatch(ctx context.Context, tx *gorm.DB, res *Result, invRow inventory.Inventory, createdBy uuid.UUID) error {
	if invRow.Quantity <= 0 {
		return nil
	}
	var batchQty int
	if err := tx.WithContext(ctx).
		Model(&inventory.Batch{}).
		Select("COALESCE(SUM(remaining_quantity), 0)").
		Where("product_id = ?", invRow.ProductID).
		Scan(&batchQty).Error; err != nil {
		return fmt.Errorf("sum seed batches: %w", err)
	}
	missingQty := invRow.Quantity - batchQty
	if missingQty <= 0 {
		return nil
	}
	reason := "seed: FIFO batch sync"
	m := inventory.Movement{
		ID:               uuid.New(),
		ProductID:        invRow.ProductID,
		MovementType:     inventory.MovementPurchase,
		Quantity:         missingQty,
		PreviousQuantity: batchQty,
		NewQuantity:      invRow.Quantity,
		CreatedBy:        createdBy,
		Reason:           &reason,
	}
	if err := tx.WithContext(ctx).Create(&m).Error; err != nil {
		return fmt.Errorf("create seed batch sync movement: %w", err)
	}
	if err := createSeedBatch(ctx, tx, invRow.ProductID, missingQty, DefaultProductPurchasePrice, &m.ID, &createdBy); err != nil {
		return err
	}
	res.created(fmt.Sprintf("inventory FIFO batch sync %s (qty=%d)", invRow.ProductID, missingQty))
	return nil
}

func createSeedBatch(ctx context.Context, tx *gorm.DB, productID uuid.UUID, qty int, unitCost float64, movementID, createdBy *uuid.UUID) error {
	if qty <= 0 {
		return nil
	}
	b := inventory.Batch{
		ID:                uuid.New(),
		ProductID:         productID,
		ReceivedQuantity:  qty,
		RemainingQuantity: qty,
		UnitCost:          unitCost,
		ReceivedAt:        time.Now().UTC(),
		MovementID:        movementID,
		CreatedBy:         createdBy,
	}
	if err := tx.WithContext(ctx).Create(&b).Error; err != nil {
		return fmt.Errorf("create seed inventory batch: %w", err)
	}
	return nil
}

// ─── Commission configs ───────────────────────────────────────────────────────

// seedCommissionConfigs inserts one global active config per commission type
// from Phase 2's compensation.AllCommissionTypes.
// A type is skipped if an active global config already exists for it.
func seedCommissionConfigs(ctx context.Context, db *gorm.DB, res *Result, createdBy *uuid.UUID) {
	now := time.Now().UTC()
	for _, dr := range defaultCommissionRates {
		var count int64
		db.WithContext(ctx).Model(&compensation.CommissionConfig{}).
			Where("commission_type = ? AND team_id IS NULL AND user_id IS NULL AND effective_to IS NULL", dr.commType).
			Count(&count)

		if count > 0 {
			res.skipped("commission_config " + string(dr.commType))
			continue
		}

		cfg := compensation.CommissionConfig{
			ID:             uuid.New(),
			CommissionType: dr.commType,
			Rate:           dr.rate,
			EffectiveFrom:  now,
			Notes:          dr.notes,
			CreatedBy:      createdBy,
		}
		if err := db.WithContext(ctx).Create(&cfg).Error; err != nil {
			res.fail("commission_config "+string(dr.commType), err)
			continue
		}
		res.created(fmt.Sprintf("commission_config %s (%.5f)", dr.commType, dr.rate))
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func ptr(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}
