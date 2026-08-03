package warehouses

// migration_backfill_test.go — DB-backed tests for migration 00099's
// courier cost-lot backfill.
//
// The migration is pure SQL with no Go call site, so these tests execute its
// Up block directly against fixtures that reproduce the pre-00098 states it
// has to repair. Requires a real Postgres DB via TEST_ADMIN_DSN.

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/inventory"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"gorm.io/gorm"
)

const backfillMigrationPath = "../../migrations/00099_backfill_courier_inventory_batches.sql"

// runBackfillMigration executes the statements in migration 00099's Up
// block. Reading the real file (rather than restating its SQL here) is the
// point: a test with its own copy of the query would keep passing after the
// shipped migration drifted away from it.
func runBackfillMigration(t *testing.T, db *gorm.DB) {
	t.Helper()
	raw, err := os.ReadFile(backfillMigrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	body := string(raw)
	start := strings.Index(body, "-- +goose StatementBegin")
	end := strings.Index(body, "-- +goose StatementEnd")
	if start < 0 || end < 0 || end < start {
		t.Fatalf("migration %s has no parseable Up block", backfillMigrationPath)
	}
	upBlock := body[start+len("-- +goose StatementBegin") : end]

	for _, stmt := range strings.Split(upBlock, ";") {
		if !hasExecutableSQL(stmt) {
			continue
		}
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatalf("exec migration statement: %v\n--- statement ---\n%s", err, stmt)
		}
	}
}

// hasExecutableSQL reports whether a chunk contains anything beyond comments
// and blank lines — the tail after the final ";" is all trailing comments.
func hasExecutableSQL(stmt string) bool {
	for _, line := range strings.Split(stmt, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "--") {
			return true
		}
	}
	return false
}

type courierLot struct {
	UnitCost          float64 `gorm:"column:unit_cost"`
	RemainingQuantity int     `gorm:"column:remaining_quantity"`
	TransferID        *string `gorm:"column:transfer_id"`
}

func courierLots(t *testing.T, db *gorm.DB, productID uuid.UUID) []courierLot {
	t.Helper()
	var lots []courierLot
	if err := db.Table("courier_inventory_batches").
		Select("unit_cost, remaining_quantity, transfer_id").
		Where("product_id = ?", productID).
		Order("created_at ASC").Scan(&lots).Error; err != nil {
		t.Fatalf("load courier lots: %v", err)
	}
	return lots
}

// twoBatchCourierStock gives a courier 20 units received as two накладные —
// 10 @ 40 then 10 @ 50 — then strips the cost lots AcceptTransfer created,
// leaving exactly the pre-00098 state: physical courier stock with no ledger
// behind it, but with the transfer's inventory_batch_consumptions history
// still intact for the backfill to replay.
func twoBatchCourierStock(t *testing.T, db *gorm.DB) (courierID, productID uuid.UUID) {
	t.Helper()
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db) // purchase_price = 40

	testutil.CreateInventory(t, db, p.ID, owner.ID, 10) // batch 1: 10 @ 40
	batch2 := &inventory.Batch{
		ID:                uuid.New(),
		ProductID:         p.ID,
		ReceivedQuantity:  10,
		RemainingQuantity: 10,
		UnitCost:          50.0,
		ReceivedAt:        time.Now().UTC().Add(time.Hour),
		CreatedBy:         &owner.ID,
	}
	if err := db.Create(batch2).Error; err != nil {
		t.Fatalf("create batch 2: %v", err)
	}
	if err := db.Model(&inventory.Inventory{}).Where("product_id = ?", p.ID).
		UpdateColumn("quantity", 20).Error; err != nil {
		t.Fatalf("bump inventory for batch 2: %v", err)
	}

	transfer, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})
	if err != nil {
		t.Fatalf("create transfer: %v", err)
	}
	if _, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID); err != nil {
		t.Fatalf("accept transfer: %v", err)
	}
	if err := db.Exec(`DELETE FROM courier_inventory_batches`).Error; err != nil {
		t.Fatalf("clear courier cost lots: %v", err)
	}
	return courier.ID, p.ID
}

// TestBackfill_ReplaysTransferHistory_RestoresRealCosts: the courier still
// holds everything they received, so both накладные come back at their true
// unit costs and in their original FIFO order.
func TestBackfill_ReplaysTransferHistory_RestoresRealCosts(t *testing.T) {
	db := testutil.NewTestDB(t)
	_, productID := twoBatchCourierStock(t, db)

	runBackfillMigration(t, db)

	lots := courierLots(t, db, productID)
	if len(lots) != 2 {
		t.Fatalf("expected 2 restored lots, got %d: %+v", len(lots), lots)
	}
	if lots[0].UnitCost != 40 || lots[0].RemainingQuantity != 10 {
		t.Errorf("expected first lot 10 @ 40, got %d @ %v", lots[0].RemainingQuantity, lots[0].UnitCost)
	}
	if lots[1].UnitCost != 50 || lots[1].RemainingQuantity != 10 {
		t.Errorf("expected second lot 10 @ 50, got %d @ %v", lots[1].RemainingQuantity, lots[1].UnitCost)
	}
	for i, l := range lots {
		if l.TransferID == nil {
			t.Errorf("lot %d should be traceable to its transfer, got NULL transfer_id", i)
		}
	}
}

// TestBackfill_PartiallyDeliveredStock_RestoresNewestLotsOnly: 12 of the 20
// units were already delivered before the backfill ran. Under FIFO those
// were the oldest ones, so only the newest 8 units are still on the shelf —
// and they must come back at the second накладная's price, not the first's.
func TestBackfill_PartiallyDeliveredStock_RestoresNewestLotsOnly(t *testing.T) {
	db := testutil.NewTestDB(t)
	_, productID := twoBatchCourierStock(t, db)

	if err := db.Exec(`UPDATE courier_inventory SET quantity = 8 WHERE product_id = ?`, productID).Error; err != nil {
		t.Fatalf("simulate prior deliveries: %v", err)
	}

	runBackfillMigration(t, db)

	lots := courierLots(t, db, productID)
	var total int
	for _, l := range lots {
		total += l.RemainingQuantity
		if l.UnitCost != 50 {
			t.Errorf("expected only second-накладная lots (@50) to survive, got a lot @ %v", l.UnitCost)
		}
	}
	if total != 8 {
		t.Errorf("expected restored lots to total the 8 units still held, got %d", total)
	}
}

// TestBackfill_NoHistory_FallsBackToPurchasePrice: stock that arrived by a
// path leaving no batch-consumption trail (seeded or imported rows, or
// transfers predating batch tracking) still has to get a lot, or the
// delivery-blocking shortfall survives the migration.
func TestBackfill_NoHistory_FallsBackToPurchasePrice(t *testing.T) {
	db := testutil.NewTestDB(t)
	_, productID := twoBatchCourierStock(t, db)

	// Erase the audit trail the previous tests rely on.
	if err := db.Exec(`DELETE FROM inventory_batch_consumptions`).Error; err != nil {
		t.Fatalf("clear consumption history: %v", err)
	}

	runBackfillMigration(t, db)

	lots := courierLots(t, db, productID)
	if len(lots) != 1 {
		t.Fatalf("expected 1 synthetic lot, got %d: %+v", len(lots), lots)
	}
	if lots[0].RemainingQuantity != 20 {
		t.Errorf("expected synthetic lot to cover all 20 held units, got %d", lots[0].RemainingQuantity)
	}
	if lots[0].UnitCost != 40 {
		t.Errorf("expected synthetic lot at purchase_price 40, got %v", lots[0].UnitCost)
	}
	if lots[0].TransferID != nil {
		t.Errorf("synthetic lot must have NULL transfer_id, got %v", *lots[0].TransferID)
	}
}

// TestBackfill_ExistingLots_NotDuplicated: transfers accepted after 00098
// already produced their own lots. The backfill is scoped by deficit, so a
// courier whose stock is already fully costed must come out unchanged.
func TestBackfill_ExistingLots_NotDuplicated(t *testing.T) {
	db := testutil.NewTestDB(t)
	whSvc, _ := buildTestServices(t, db)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	courier := testutil.CreateUser(t, db, users.RoleCourier)
	p := testutil.CreateProduct(t, db)
	testutil.CreateInventory(t, db, p.ID, owner.ID, 50)

	transfer, err := whSvc.CreateTransfer(context.Background(), owner.ID, CreateTransferRequest{
		FromWarehouseID: DefaultMainWarehouseID, CourierID: courier.ID,
		Items: []TransferItemRequest{{ProductID: p.ID, Quantity: 20}},
	})
	if err != nil {
		t.Fatalf("create transfer: %v", err)
	}
	if _, err := whSvc.AcceptTransfer(context.Background(), courier.ID, transfer.ID); err != nil {
		t.Fatalf("accept transfer: %v", err)
	}

	before := courierLots(t, db, p.ID)
	runBackfillMigration(t, db)
	after := courierLots(t, db, p.ID)

	if len(after) != len(before) {
		t.Fatalf("backfill must not add lots to already-costed stock: had %d, now %d", len(before), len(after))
	}
	var total int
	for _, l := range after {
		total += l.RemainingQuantity
	}
	if total != 20 {
		t.Errorf("expected lots to still total 20 units, got %d", total)
	}
}
