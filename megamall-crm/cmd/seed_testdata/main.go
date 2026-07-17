package main

// cmd/seed_testdata/main.go — bulk production-like test data.
//
// Run with: go run ./cmd/seed_testdata
//
// Drives every order through the real orders.Service / dispatch.Service state
// machine (not raw SQL) so financial_events, inventory_movements/batches, and
// courier_payout freezing all come out of the actual business logic, exactly
// as they would from real usage. Idempotent for users/teams/products/customers
// (check-before-insert); re-running adds another batch of orders on top.
//
// This is a scratch/dev tool only — never run it against production. It
// refuses to start if DB_DSN looks production-shaped (see pkg/dbsafety);
// unlike cmd/seed, this tool has no legitimate production use case at all,
// so there is no override.

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/compensation"
	"github.com/megamall/crm/internal/customers"
	"github.com/megamall/crm/internal/dispatch"
	"github.com/megamall/crm/internal/hierarchy"
	"github.com/megamall/crm/internal/inventory"
	logistics_settings "github.com/megamall/crm/internal/logistics_settings"
	"github.com/megamall/crm/internal/orders"
	"github.com/megamall/crm/internal/products"
	"github.com/megamall/crm/internal/seed"
	"github.com/megamall/crm/internal/teams"
	"github.com/megamall/crm/internal/users"
	"github.com/megamall/crm/pkg/database"
	"github.com/megamall/crm/pkg/dbsafety"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const (
	numTeams        = 4
	sellersPerTeam  = 5 // 4*5 = 20 sellers
	numCouriers     = 10
	numCustomers    = 200
	numProducts     = 25
	numOrders       = 1000
	seedPassword    = "password123"
	initialStockQty = 3000
)

var rng = rand.New(rand.NewSource(time.Now().UnixNano()))

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if err := dbsafety.RefuseProduction(cfg.Database.DSN); err != nil {
		log.Fatalf("refusing to run against what looks like production: %v", err)
	}
	db, err := database.Connect(cfg.Database)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()

	ctx := context.Background()

	// Ensure baseline demo data (cities, commission configs, default team) exists.
	seedCfg, err := seed.ParseConfig()
	if err != nil {
		log.Fatalf("seed config: %v", err)
	}
	if _, err := seed.Run(ctx, db, seedCfg); err != nil {
		log.Printf("baseline seed finished with errors (continuing): %v", err)
	}

	// ── Repositories / services (mirrors cmd/server/main.go wiring) ──────────
	teamRepo := teams.NewRepository(db)
	hierRepo := hierarchy.NewRepository(db)
	customerRepo := customers.NewRepository(db)
	productRepo := products.NewRepository(db)
	inventoryRepo := inventory.NewRepository(db)
	activityLogger := activity.NewLogger(activity.NewRepository(db))

	compSvc := compensation.NewService(compensation.NewRepository(db), activityLogger, db)

	loc := cfg.Server.Location()
	orderRepo := orders.NewRepository(db, loc)
	seedUserRepo := users.NewRepository(db)
	orderSvc := orders.NewService(orderRepo, inventoryRepo, hierRepo, teamRepo, compSvc, activityLogger, db,
		func(ctx context.Context, id uuid.UUID) (*orders.SellerLookupResult, error) {
			u, err := seedUserRepo.GetByID(ctx, id)
			if err != nil {
				return nil, err
			}
			if u == nil {
				return nil, nil
			}
			return &orders.SellerLookupResult{IsActive: u.IsActive, Role: string(u.Role)}, nil
		},
	)

	dispatchSvc := dispatch.NewService(dispatch.NewRepository(db), orderSvc, activityLogger, db)

	// ── Actors used to drive the state machine ────────────────────────────────
	owner := mustGetUserByPhone(ctx, db, "+992900000001")
	dispatcher := mustGetUserByPhone(ctx, db, "+992900000005")

	dushanbeID := mustGetCityID(ctx, db, "Душанбе")
	khujandID := mustGetCityID(ctx, db, "Худжанд")

	log.Println("=== teams, sellers, managers, team leads ===")
	sellerIDs, teamCount := createTeamsAndSellers(ctx, db, teamRepo, hierRepo)
	log.Printf("teams: %d, sellers: %d", teamCount, len(sellerIDs))

	log.Println("=== couriers ===")
	cityCouriers := createCouriers(ctx, db, dushanbeID, khujandID)
	log.Printf("couriers: dushanbe=%d, khujand=%d", len(cityCouriers[dushanbeID]), len(cityCouriers[khujandID]))

	log.Println("=== customers ===")
	custs := createCustomers(ctx, db, customerRepo, sellerIDs)
	log.Printf("customers: %d", len(custs))

	log.Println("=== products + initial inventory ===")
	prods := createProducts(ctx, db, productRepo, owner.ID)
	log.Printf("products: %d", len(prods))

	log.Println("=== orders ===")
	runOrders(ctx, db, orderSvc, dispatchSvc, sellerIDs, custs, prods, owner.ID, dispatcher.ID, dushanbeID, khujandID, cityCouriers)

	log.Println("=== done ===")
}

// ─── Teams / sellers / managers / team leads ──────────────────────────────────

type demoNameUser struct {
	id    uuid.UUID
	phone string
	name  string
	role  users.Role
}

func createTeamsAndSellers(ctx context.Context, db *gorm.DB, teamRepo *teams.Repository, hierRepo *hierarchy.Repository) ([]uuid.UUID, int) {
	teamNames := []string{"Альфа", "Восток", "Юг", "Норд"}
	var allSellerIDs []uuid.UUID
	created := 0

	for i := 0; i < numTeams; i++ {
		teamName := "Команда " + teamNames[i%len(teamNames)]

		tl := ensureUser(ctx, db, phoneFor("92", i+1), randomFullName(), users.RoleSalesTeamLead)
		mgr := ensureUser(ctx, db, phoneFor("93", i+1), randomFullName(), users.RoleManager)

		var team teams.Team
		err := db.WithContext(ctx).Where("name = ?", teamName).First(&team).Error
		if err != nil {
			team = teams.Team{
				ID:         uuid.New(),
				Name:       teamName,
				TeamLeadID: &tl.id,
				ManagerID:  &mgr.id,
				IsActive:   true,
			}
			if err := teamRepo.Create(ctx, &team); err != nil {
				log.Printf("create team %s: %v", teamName, err)
				continue
			}
			created++
		}

		upsertHierarchy(ctx, hierRepo, tl.id, nil, &team.ID)
		upsertHierarchy(ctx, hierRepo, mgr.id, &tl.id, &team.ID)

		for s := 0; s < sellersPerTeam; s++ {
			seq := i*sellersPerTeam + s + 1
			seller := ensureUser(ctx, db, phoneFor("94", seq), randomFullName(), users.RoleSeller)
			upsertHierarchy(ctx, hierRepo, seller.id, &mgr.id, &team.ID)
			allSellerIDs = append(allSellerIDs, seller.id)
		}
	}

	return allSellerIDs, created
}

func upsertHierarchy(ctx context.Context, hierRepo *hierarchy.Repository, userID uuid.UUID, parentID, teamID *uuid.UUID) {
	existing, err := hierRepo.GetByUserID(ctx, userID)
	if err == nil && existing != nil {
		return
	}
	h := &hierarchy.UserHierarchy{
		ID:       uuid.New(),
		UserID:   userID,
		ParentID: parentID,
		TeamID:   teamID,
	}
	if err := hierRepo.Upsert(ctx, h); err != nil {
		log.Printf("hierarchy upsert for %s: %v", userID, err)
	}
}

// ─── Couriers ──────────────────────────────────────────────────────────────────

func createCouriers(ctx context.Context, db *gorm.DB, dushanbeID, khujandID uuid.UUID) map[uuid.UUID][]uuid.UUID {
	cityCouriers := map[uuid.UUID][]uuid.UUID{}

	for i := 0; i < numCouriers; i++ {
		c := ensureUser(ctx, db, phoneFor("95", i+1), randomFullName(), users.RoleCourier)

		var profile logistics_settings.CourierProfile
		err := db.WithContext(ctx).Where("user_id = ?", c.id).First(&profile).Error
		if err != nil {
			profile = logistics_settings.CourierProfile{
				UserID:       c.id,
				PayoutNormal: float64(15 + rng.Intn(11)), // 15-25
				PayoutFast:   float64(25 + rng.Intn(11)), // 25-35
				IsActive:     true,
			}
			if err := db.WithContext(ctx).Create(&profile).Error; err != nil {
				log.Printf("create courier profile %s: %v", c.id, err)
				continue
			}
		}

		// 6 couriers cover Dushanbe, 4 cover Khujand; first 2 Dushanbe couriers also
		// cover Khujand for cross-city realism.
		var citiesServed []uuid.UUID
		if i < 6 {
			citiesServed = append(citiesServed, dushanbeID)
			if i < 2 {
				citiesServed = append(citiesServed, khujandID)
			}
		} else {
			citiesServed = append(citiesServed, khujandID)
		}

		for _, cityID := range citiesServed {
			var count int64
			db.WithContext(ctx).Model(&logistics_settings.CourierCity{}).
				Where("courier_id = ? AND city_id = ?", c.id, cityID).Count(&count)
			if count == 0 {
				db.WithContext(ctx).Create(&logistics_settings.CourierCity{CourierID: c.id, CityID: cityID})
			}
			cityCouriers[cityID] = append(cityCouriers[cityID], c.id)
		}
	}

	return cityCouriers
}

// ─── Customers ─────────────────────────────────────────────────────────────────

type generatedCustomer struct {
	id      uuid.UUID
	address string
	cityID  uuid.UUID
	city    string
}

func createCustomers(ctx context.Context, db *gorm.DB, repo *customers.Repository, sellerIDs []uuid.UUID) []generatedCustomer {
	sources := []customers.CustomerSource{
		customers.SourceInstagram, customers.SourceFacebook, customers.SourceTikTok,
		customers.SourceWebsite, customers.SourcePhone, customers.SourceReferral,
		customers.SourceMarketplace, customers.SourceOther,
	}
	streets := []string{"Рудаки", "Айни", "Сомони", "Фирдавси", "Бухоро", "Дружбы Народов", "Наврӯз", "Борбад"}

	out := make([]generatedCustomer, 0, numCustomers)
	for i := 0; i < numCustomers; i++ {
		cityName := "Душанбе"
		if i%3 == 0 {
			cityName = "Худжанд"
		}
		address := fmt.Sprintf("ул. %s, д. %d, кв. %d", streets[rng.Intn(len(streets))], 1+rng.Intn(120), 1+rng.Intn(80))
		phone := phoneFor("96", i+1)
		source := sources[rng.Intn(len(sources))]
		createdBy := sellerIDs[rng.Intn(len(sellerIDs))]

		var existing customers.Customer
		err := db.WithContext(ctx).Where("phone = ?", phone).First(&existing).Error
		if err == nil {
			out = append(out, generatedCustomer{id: existing.ID, address: address, city: cityName})
			continue
		}

		c := &customers.Customer{
			ID:        uuid.New(),
			FullName:  randomFullName(),
			Phone:     phone,
			City:      &cityName,
			Address:   &address,
			Source:    &source,
			CreatedBy: &createdBy,
		}
		if err := repo.Create(ctx, c); err != nil {
			log.Printf("create customer %s: %v", phone, err)
			continue
		}
		out = append(out, generatedCustomer{id: c.ID, address: address, city: cityName})
	}
	return out
}

// ─── Products + initial inventory ──────────────────────────────────────────────

type generatedProduct struct {
	id        uuid.UUID
	salePrice float64
}

var catalog = []struct {
	name string
	sale float64
}{
	{"Смартфон Galaxy A14", 1200}, {"Наушники TWS Pro", 180}, {"Кроссовки Air Runner", 350},
	{"Куртка зимняя", 620}, {"Рюкзак городской", 210}, {"Умные часы Fit 5", 450},
	{"Пауэрбанк 20000mAh", 150}, {"Кофеварка капельная", 380}, {"Утюг паровой", 260},
	{"Фен для волос", 140}, {"Блендер погружной", 190}, {"Чайник электрический", 130},
	{"Мультиварка 5л", 480}, {"Телевизор 43\" Smart", 2400}, {"Планшет 10\"", 1100},
	{"Игровая мышь", 90}, {"Клавиатура механическая", 220}, {"Веб-камера HD", 160},
	{"Колонка портативная", 200}, {"Зарядное устройство 65W", 85}, {"Кабель USB-C 2м", 30},
	{"Термос 1л", 75}, {"Спортивная сумка", 160}, {"Солнцезащитные очки", 95},
	{"Постельное бельё комплект", 240},
}

func createProducts(ctx context.Context, db *gorm.DB, repo *products.Repository, ownerID uuid.UUID) []generatedProduct {
	var supplier products.Supplier
	err := db.WithContext(ctx).Where("name = ?", "Test Data Supplier").First(&supplier).Error
	if err != nil {
		supplier = products.Supplier{ID: uuid.New(), Name: "Test Data Supplier", IsActive: true}
		if err := repo.CreateSupplier(ctx, &supplier); err != nil {
			log.Fatalf("create supplier: %v", err)
		}
	}

	out := make([]generatedProduct, 0, numProducts)
	for i, c := range catalog {
		if i >= numProducts {
			break
		}
		sku := fmt.Sprintf("TD-%03d", i+1)
		var existing products.Product
		err := db.WithContext(ctx).Where("sku = ? AND deleted_at IS NULL", sku).First(&existing).Error
		if err == nil {
			out = append(out, generatedProduct{id: existing.ID, salePrice: derefF(existing.SalePrice)})
			ensureStock(ctx, db, existing.ID, ownerID, derefF(existing.PurchasePrice))
			continue
		}

		sale := c.sale
		purchase := c.sale * 0.6
		p := products.Product{
			ID:            uuid.New(),
			SKU:           sku,
			Name:          c.name,
			SalePrice:     &sale,
			PurchasePrice: &purchase,
			SupplierID:    &supplier.ID,
			IsActive:      true,
		}
		if err := repo.CreateProduct(ctx, &p); err != nil {
			log.Printf("create product %s: %v", sku, err)
			continue
		}
		ensureStock(ctx, db, p.ID, ownerID, purchase)
		out = append(out, generatedProduct{id: p.ID, salePrice: sale})
	}
	return out
}

func ensureStock(ctx context.Context, db *gorm.DB, productID, createdBy uuid.UUID, unitCost float64) {
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing inventory.Inventory
		err := tx.WithContext(ctx).Where("product_id = ?", productID).First(&existing).Error
		if err == nil {
			return nil // already stocked (from baseline seed or a prior run)
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}

		inv := inventory.Inventory{
			ID:                uuid.New(),
			ProductID:         productID,
			Quantity:          initialStockQty,
			ReservedQuantity:  0,
			LowStockThreshold: 20,
		}
		if err := tx.WithContext(ctx).Create(&inv).Error; err != nil {
			return err
		}

		reason := "seed_testdata: initial stock"
		m := inventory.Movement{
			ID:               uuid.New(),
			ProductID:        productID,
			MovementType:     inventory.MovementPurchase,
			Quantity:         initialStockQty,
			PreviousQuantity: 0,
			NewQuantity:      initialStockQty,
			CreatedBy:        createdBy,
			Reason:           &reason,
		}
		if err := tx.WithContext(ctx).Create(&m).Error; err != nil {
			return err
		}

		b := inventory.Batch{
			ID:                uuid.New(),
			ProductID:         productID,
			ReceivedQuantity:  initialStockQty,
			RemainingQuantity: initialStockQty,
			UnitCost:          unitCost,
			ReceivedAt:        time.Now().UTC(),
			MovementID:        &m.ID,
			CreatedBy:         &createdBy,
		}
		return tx.WithContext(ctx).Create(&b).Error
	})
	if err != nil {
		log.Printf("ensure stock for %s: %v", productID, err)
	}
}

// ─── Orders ────────────────────────────────────────────────────────────────────

func runOrders(
	ctx context.Context,
	db *gorm.DB,
	orderSvc *orders.Service,
	dispatchSvc *dispatch.Service,
	sellerIDs []uuid.UUID,
	custs []generatedCustomer,
	prods []generatedProduct,
	ownerID, dispatcherID uuid.UUID,
	dushanbeID, khujandID uuid.UUID,
	cityCouriers map[uuid.UUID][]uuid.UUID,
) {
	statuses := buildStatusPlan()
	rng.Shuffle(len(statuses), func(i, j int) { statuses[i], statuses[j] = statuses[j], statuses[i] })

	created, failed := 0, 0

	for i, targetStatus := range statuses {
		sellerID := sellerIDs[rng.Intn(len(sellerIDs))]
		cust := custs[rng.Intn(len(custs))]

		cityID := dushanbeID
		if cust.city == "Худжанд" {
			cityID = khujandID
		}

		deliveryMethod := "normal"
		if rng.Intn(10) < 3 {
			deliveryMethod = "fast"
		}

		items, subtotal := randomItems(prods)

		req := orders.CreateOrderRequest{
			CustomerID:      cust.id,
			OrderType:       orders.OrderTypeSeller,
			CityID:          cityID,
			Items:           items,
			DeliveryMethod:  deliveryMethod,
			DeliveryAddress: &cust.address,
		}

		if targetStatus == string(orders.StatusNew) {
			amt := roundMoney(subtotal * 0.3)
			receiver := "cash"
			req.PrepaymentRequired = true
			req.PrepaymentAmount = amt
			req.PrepaymentReceiver = &receiver
		}

		order, err := orderSvc.Create(ctx, sellerID, "seller", req)
		if err != nil {
			log.Printf("CREATE FAIL (target=%s): %v", targetStatus, err)
			failed++
			continue
		}

		courierID, hasCourier := pickCourier(cityCouriers, cityID)

		if err := advanceOrder(ctx, orderSvc, dispatchSvc, order.ID, targetStatus, ownerID, dispatcherID, courierID, hasCourier); err != nil {
			log.Printf("ADVANCE FAIL (target=%s, order=%s): %v", targetStatus, order.ID, err)
			failed++
			continue
		}

		backdateOrder(ctx, db, order.ID)
		created++

		if (i+1)%100 == 0 {
			log.Printf("orders progress: %d/%d (failed=%d)", i+1, numOrders, failed)
		}
	}

	log.Printf("orders done: created=%d failed=%d", created, failed)
}

// buildStatusPlan returns exactly numOrders status labels distributed to look
// like a real operating business: mostly delivered, a realistic cancellation
// rate, and a pipeline of orders at every other stage.
func buildStatusPlan() []string {
	counts := map[string]int{
		"delivered":           630,
		"cancelled":           140,
		"new":                 40,
		"confirmed":           50,
		"prepayment_pending":  20,
		"prepayment_received": 20,
		"assigned":            30,
		"in_delivery":         30,
		"issue":               40,
	}
	plan := make([]string, 0, numOrders)
	for status, n := range counts {
		for k := 0; k < n; k++ {
			plan = append(plan, status)
		}
	}
	return plan
}

func pickCourier(cityCouriers map[uuid.UUID][]uuid.UUID, cityID uuid.UUID) (uuid.UUID, bool) {
	list := cityCouriers[cityID]
	if len(list) == 0 {
		return uuid.Nil, false
	}
	return list[rng.Intn(len(list))], true
}

// advanceOrder drives a freshly-created order (status new or confirmed,
// depending on PrepaymentRequired) forward to targetStatus using the real
// service layer, exactly as a dispatcher/courier/owner would in the app.
func advanceOrder(
	ctx context.Context,
	orderSvc *orders.Service,
	dispatchSvc *dispatch.Service,
	orderID uuid.UUID,
	targetStatus string,
	ownerID, dispatcherID, courierID uuid.UUID,
	hasCourier bool,
) error {
	changeStatus := func(to orders.OrderStatus) error {
		_, err := orderSvc.ChangeStatus(ctx, ownerID, "owner", orderID, orders.ChangeStatusRequest{Status: to})
		return err
	}
	assign := func() error {
		if !hasCourier {
			return fmt.Errorf("no courier available for city")
		}
		_, err := dispatchSvc.AssignCourier(ctx, dispatcherID, orderID, dispatch.AssignCourierRequest{CourierID: courierID})
		return err
	}

	switch targetStatus {
	case "new", "confirmed":
		return nil // already there after Create

	case "prepayment_pending":
		return changeStatus(orders.StatusPrepaymentPending)

	case "prepayment_received":
		if err := changeStatus(orders.StatusPrepaymentPending); err != nil {
			return err
		}
		return changeStatus(orders.StatusPrepaymentReceived)

	case "assigned":
		return assign()

	case "in_delivery":
		if err := assign(); err != nil {
			return err
		}
		return changeStatus(orders.StatusInDelivery)

	case "issue":
		if err := assign(); err != nil {
			return err
		}
		if err := changeStatus(orders.StatusInDelivery); err != nil {
			return err
		}
		return changeStatus(orders.StatusIssue)

	case "delivered":
		if err := assign(); err != nil {
			return err
		}
		if err := changeStatus(orders.StatusInDelivery); err != nil {
			return err
		}
		return changeStatus(orders.StatusDelivered)

	case "cancelled":
		switch rng.Intn(3) {
		case 0:
			return changeStatus(orders.StatusCancelled)
		case 1:
			if err := assign(); err != nil {
				return changeStatus(orders.StatusCancelled) // no courier coverage — cancel from confirmed instead
			}
			return changeStatus(orders.StatusCancelled)
		default:
			// in_delivery has no direct edge to cancelled — go through issue first
			// (matches the real dispatcher workflow for a failed delivery).
			if err := assign(); err != nil {
				return changeStatus(orders.StatusCancelled)
			}
			if err := changeStatus(orders.StatusInDelivery); err != nil {
				return err
			}
			if err := changeStatus(orders.StatusIssue); err != nil {
				return err
			}
			return changeStatus(orders.StatusCancelled)
		}
	}
	return fmt.Errorf("unknown target status %q", targetStatus)
}

func randomItems(prods []generatedProduct) ([]orders.OrderItemRequest, float64) {
	n := 1 + rng.Intn(3)
	items := make([]orders.OrderItemRequest, 0, n)
	subtotal := 0.0
	for i := 0; i < n; i++ {
		p := prods[rng.Intn(len(prods))]
		qty := 1 + rng.Intn(4)
		items = append(items, orders.OrderItemRequest{
			ProductID: p.id,
			Quantity:  qty,
			UnitPrice: p.salePrice,
		})
		subtotal += p.salePrice * float64(qty)
	}
	return items, subtotal
}

// ─── Timestamp backdating ──────────────────────────────────────────────────────
//
// Every order is created "now" so the whole batch would otherwise land in the
// same few minutes. Spread each order's lifecycle over a random point in the
// last 120 days, preserving the real step order and adding realistic gaps
// between steps (hours, not months) — anything downstream that filters by
// created_at (finance summary, dashboards) sees a believable history.

func backdateOrder(ctx context.Context, db *gorm.DB, orderID uuid.UUID) {
	type row struct {
		ID       uuid.UUID
		ToStatus string
	}
	var rows []row
	if err := db.WithContext(ctx).Raw(
		"SELECT id, to_status::text AS to_status FROM order_timeline WHERE order_id = ? ORDER BY created_at ASC", orderID,
	).Scan(&rows).Error; err != nil || len(rows) == 0 {
		return
	}

	anchor := time.Now().UTC().AddDate(0, 0, -rng.Intn(120)).Add(-time.Duration(rng.Intn(24)) * time.Hour)
	cur := anchor
	tsByStatus := map[string]time.Time{}

	for i, r := range rows {
		if i > 0 {
			cur = cur.Add(time.Duration(1+rng.Intn(36)) * time.Hour)
		}
		tsByStatus[r.ToStatus] = cur
		db.WithContext(ctx).Exec("UPDATE order_timeline SET created_at = ? WHERE id = ?", cur, r.ID)
	}

	db.WithContext(ctx).Exec("UPDATE orders SET created_at = ?, updated_at = ? WHERE id = ?", anchor, cur, orderID)

	if ts, ok := tsByStatus["delivered"]; ok {
		db.WithContext(ctx).Exec("UPDATE financial_events SET created_at = ? WHERE order_id = ?", ts, orderID)
		db.WithContext(ctx).Exec("UPDATE inventory_movements SET created_at = ? WHERE reference_id = ?", ts, orderID)
	}
	if ts, ok := tsByStatus["assigned"]; ok {
		db.WithContext(ctx).Exec("UPDATE order_assignments SET assigned_at = ? WHERE order_id = ?", ts, orderID)
	}
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

func mustGetUserByPhone(ctx context.Context, db *gorm.DB, phone string) *users.User {
	var u users.User
	if err := db.WithContext(ctx).Where("phone = ?", phone).First(&u).Error; err != nil {
		log.Fatalf("required user %s not found (run ./run_seed.sh first): %v", phone, err)
	}
	return &u
}

func mustGetCityID(ctx context.Context, db *gorm.DB, name string) uuid.UUID {
	var c logistics_settings.City
	if err := db.WithContext(ctx).Where("name = ? AND is_active = true", name).First(&c).Error; err != nil {
		log.Fatalf("required city %s not found: %v", name, err)
	}
	return c.ID
}

func ensureUser(ctx context.Context, db *gorm.DB, phone, fullName string, role users.Role) demoNameUser {
	var existing users.User
	err := db.WithContext(ctx).Where("phone = ?", phone).First(&existing).Error
	if err == nil {
		return demoNameUser{id: existing.ID, phone: phone, name: existing.FullName, role: role}
	}

	hash, herr := bcrypt.GenerateFromPassword([]byte(seedPassword), bcrypt.DefaultCost)
	if herr != nil {
		log.Fatalf("hash password: %v", herr)
	}
	u := users.User{
		ID:           uuid.New(),
		Phone:        phone,
		PasswordHash: string(hash),
		FullName:     fullName,
		Role:         role,
		IsActive:     true,
	}
	if err := db.WithContext(ctx).Create(&u).Error; err != nil {
		log.Fatalf("create user %s: %v", phone, err)
	}
	return demoNameUser{id: u.ID, phone: phone, name: fullName, role: role}
}

func phoneFor(categoryCode string, seq int) string {
	return fmt.Sprintf("+992%s%06d", categoryCode, seq)
}

var firstNamesM = []string{
	"Фарход", "Далер", "Шариф", "Умед", "Джамшед", "Рустам", "Хуршед", "Азиз",
	"Бахтиёр", "Насим", "Сино", "Абдулло", "Зафар", "Комрон", "Ориф", "Сухроб",
	"Исмоил", "Равшан", "Диловар", "Файзулло",
}
var firstNamesF = []string{
	"Мадина", "Зарина", "Нигора", "Гулнора", "Дилноза", "Ситора", "Фарзона",
	"Малика", "Шахноза", "Наргис", "Мехрангез", "Парвина", "Тахмина", "Мунира", "Заррина",
}
var lastNames = []string{
	"Раҳимов", "Каримов", "Юсупов", "Назаров", "Собиров", "Холов", "Раджабов",
	"Абдуллоев", "Сафаров", "Тошев", "Исмоилов", "Одинаев", "Мирзоев", "Файзиев",
	"Шарипов", "Хамидов", "Комилов", "Гафуров", "Латифов", "Давлатов",
}

func randomFullName() string {
	var first string
	if rng.Intn(2) == 0 {
		first = firstNamesM[rng.Intn(len(firstNamesM))]
	} else {
		first = firstNamesF[rng.Intn(len(firstNamesF))]
	}
	last := lastNames[rng.Intn(len(lastNames))]
	return first + " " + last
}

func derefF(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

func roundMoney(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}
