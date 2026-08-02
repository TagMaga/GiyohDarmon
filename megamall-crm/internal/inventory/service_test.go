package inventory_test

// service_test.go — DB-backed tests for batch expiry dates, the
// multi-line goods-receipt invoice, and FEFO consumption ordering.
//
// External test package (inventory_test, not inventory): internal/testutil
// itself imports internal/inventory for its fixture helpers, so an
// in-package test file here would create an import cycle. This is the same
// reason internal/warehouses' DB-backed tests live in a package that can
// import both inventory and testutil freely.
//
// Requires a real Postgres DB via TEST_ADMIN_DSN (see internal/testutil).
// Run with: TEST_ADMIN_DSN=... go test ./internal/inventory/ -v

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/inventory"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"gorm.io/gorm"
)

// dushanbe mirrors config.ServerConfig's default business timezone
// (Asia/Dushanbe, UTC+5) without depending on the test runner having IANA
// tzdata installed.
var dushanbe = time.FixedZone("Asia/Dushanbe", 5*3600)

func buildTestService(t *testing.T, db *gorm.DB) *inventory.Service {
	t.Helper()
	repo := inventory.NewRepository(db, dushanbe)
	logger := activity.NewLogger(activity.NewRepository(db))
	return inventory.NewService(repo, logger, dushanbe, nil)
}

func ymd(t time.Time) string { return t.Format(inventory.ExpiryDateLayout) }

// insertTestMovement inserts a bare inventory_movements row inside tx and
// returns its ID, so direct Repository.ConsumeFEFO calls in these tests have
// a real movement to satisfy inventory_batch_consumptions' FK — mirroring
// how every production call site inserts its movement before consuming.
func insertTestMovement(t *testing.T, tx *gorm.DB, productID, actorID uuid.UUID, qty int) uuid.UUID {
	t.Helper()
	m := &inventory.Movement{
		ID:           uuid.New(),
		ProductID:    productID,
		MovementType: inventory.MovementSale,
		Quantity:     qty,
		CreatedBy:    actorID,
	}
	if err := tx.Create(m).Error; err != nil {
		t.Fatalf("insert test movement: %v", err)
	}
	return m.ID
}

// ─── Multi-line goods receipt ────────────────────────────────────────────────

// Scenario 1: a multi-line invoice creates a goods_receipts header plus one
// batch/movement per line, and updates inventory for every product involved.
func TestReceiveBatch_MultiLineAtomic(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p1 := testutil.CreateProduct(t, db)
	p2 := testutil.CreateProduct(t, db)

	today := svc.BusinessToday()
	req := inventory.CreateGoodsReceiptRequest{
		InvoiceNo:  "INV-ATOMIC-1",
		ReceivedAt: ymd(today),
		Items: []inventory.CreateGoodsReceiptItem{
			{ProductID: p1.ID, Quantity: 10, UnitCost: 5, ExpiryDate: ymd(today.AddDate(0, 0, 30))},
			{ProductID: p2.ID, Quantity: 20, UnitCost: 7, ExpiryDate: ymd(today.AddDate(0, 0, 60))},
		},
	}

	resp, err := svc.ReceiveBatch(context.Background(), actor.ID, req)
	if err != nil {
		t.Fatalf("ReceiveBatch: %v", err)
	}
	if resp.ItemCount != 2 || resp.TotalUnits != 30 {
		t.Fatalf("expected 2 items / 30 units, got %d items / %d units", resp.ItemCount, resp.TotalUnits)
	}
	if resp.TotalValue != 10*5+20*7 {
		t.Fatalf("expected total value 190, got %v", resp.TotalValue)
	}

	var receiptCount int64
	db.Table("goods_receipts").Where("id = ?", resp.ID).Count(&receiptCount)
	if receiptCount != 1 {
		t.Fatalf("expected 1 goods_receipts row, got %d", receiptCount)
	}

	var batchCount int64
	db.Table("inventory_batches").Where("goods_receipt_id = ?", resp.ID).Count(&batchCount)
	if batchCount != 2 {
		t.Fatalf("expected 2 batches linked to the receipt, got %d", batchCount)
	}

	var inv1, inv2 inventory.Inventory
	if err := db.Where("product_id = ?", p1.ID).First(&inv1).Error; err != nil {
		t.Fatalf("load inventory for p1: %v", err)
	}
	if inv1.Quantity != 10 {
		t.Errorf("p1 quantity: got %d, want 10", inv1.Quantity)
	}
	if err := db.Where("product_id = ?", p2.ID).First(&inv2).Error; err != nil {
		t.Fatalf("load inventory for p2: %v", err)
	}
	if inv2.Quantity != 20 {
		t.Errorf("p2 quantity: got %d, want 20", inv2.Quantity)
	}
}

// Scenario 2: an invalid line (unknown product FK) aborts the whole
// transaction — the first (valid) line must not persist either.
func TestReceiveBatch_ErrorInOneLineRollsBackWholeReceipt(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p1 := testutil.CreateProduct(t, db)
	unknownProduct := uuid.New() // not in products table -> FK violation on line 2

	today := svc.BusinessToday()
	req := inventory.CreateGoodsReceiptRequest{
		InvoiceNo:  "INV-ROLLBACK-1",
		ReceivedAt: ymd(today),
		Items: []inventory.CreateGoodsReceiptItem{
			{ProductID: p1.ID, Quantity: 5, UnitCost: 5, ExpiryDate: ymd(today.AddDate(0, 0, 30))},
			{ProductID: unknownProduct, Quantity: 5, UnitCost: 5, ExpiryDate: ymd(today.AddDate(0, 0, 30))},
		},
	}

	if _, err := svc.ReceiveBatch(context.Background(), actor.ID, req); err == nil {
		t.Fatal("expected an error from the unknown-product line, got nil")
	}

	var receiptCount int64
	db.Table("goods_receipts").Where("invoice_no = ?", "INV-ROLLBACK-1").Count(&receiptCount)
	if receiptCount != 0 {
		t.Errorf("expected no goods_receipts row after rollback, got %d", receiptCount)
	}

	var invCount int64
	db.Table("inventory").Where("product_id = ?", p1.ID).Count(&invCount)
	if invCount != 0 {
		t.Errorf("expected line 1's inventory row to not exist after rollback, got %d rows", invCount)
	}
}

// ─── Expiry-date validation on single-line receiving ─────────────────────────

// Scenario 3: a new receipt without an expiry date is rejected.
func TestReceive_MissingExpiryDateRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)

	_, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 5, UnitCost: 1, ExpiryDate: "",
	})
	if err == nil {
		t.Fatal("expected missing expiry_date to be rejected")
	}
}

// Scenario 4: an expiry date already in the past (relative to the business
// date) is rejected. Today itself is allowed (and immediately critical).
func TestReceive_PastExpiryDateRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)

	yesterday := svc.BusinessToday().AddDate(0, 0, -1)
	_, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 5, UnitCost: 1, ExpiryDate: ymd(yesterday),
	})
	if err == nil {
		t.Fatal("expected an expiry date in the past to be rejected")
	}
}

// Receiving with expiry_date == today's business date must be accepted
// (the spec: "today counts as critical, not rejected").
func TestReceive_TodayExpiryDateAccepted(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)

	today := svc.BusinessToday()
	resp, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 5, UnitCost: 1, ExpiryDate: ymd(today),
	})
	if err != nil {
		t.Fatalf("expected today's date to be accepted, got: %v", err)
	}
	if resp.Batch.ExpiryDate == nil || *resp.Batch.ExpiryDate != ymd(today) {
		t.Errorf("expected batch expiry_date %s, got %v", ymd(today), resp.Batch.ExpiryDate)
	}
}

// ─── FEFO consumption ordering ────────────────────────────────────────────────

// Scenario 5: FEFO consumes the batch with the nearest expiry date first,
// even though it was received later (so plain FIFO would pick the other one).
func TestConsumeFEFO_PicksEarliestExpiryOverReceivedOrder(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)
	today := svc.BusinessToday()

	// Received first, expires later.
	farBatch, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 10, UnitCost: 1, ExpiryDate: ymd(today.AddDate(0, 0, 30)),
	})
	if err != nil {
		t.Fatalf("receive far batch: %v", err)
	}
	// Received second, expires sooner -> FEFO must consume this one first.
	nearBatch, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 10, UnitCost: 2, ExpiryDate: ymd(today.AddDate(0, 0, 5)),
	})
	if err != nil {
		t.Fatalf("receive near batch: %v", err)
	}

	repo := inventory.NewRepository(db, dushanbe)
	err = db.Transaction(func(tx *gorm.DB) error {
		mID := insertTestMovement(t, tx, p.ID, actor.ID, 4)
		_, err := repo.ConsumeFEFO(tx, context.Background(), p.ID, 4, mID)
		return err
	})
	if err != nil {
		t.Fatalf("ConsumeFEFO: %v", err)
	}

	var near, far inventory.Batch
	db.First(&near, "id = ?", nearBatch.Batch.ID)
	db.First(&far, "id = ?", farBatch.Batch.ID)

	if near.RemainingQuantity != 6 {
		t.Errorf("near-expiry batch: expected 6 remaining after consuming 4, got %d", near.RemainingQuantity)
	}
	if far.RemainingQuantity != 10 {
		t.Errorf("far-expiry batch: expected untouched 10 remaining, got %d", far.RemainingQuantity)
	}
}

// Scenario 6: when two batches share the same expiry date, FEFO falls back
// to FIFO (earliest received_at first).
func TestConsumeFEFO_SameExpiryFallsBackToFIFO(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)
	today := svc.BusinessToday()
	sameExpiry := today.AddDate(0, 0, 20)

	older, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 10, UnitCost: 1, ExpiryDate: ymd(sameExpiry),
	})
	if err != nil {
		t.Fatalf("receive older batch: %v", err)
	}
	// Force a strictly earlier received_at than `newer` so FIFO order is
	// unambiguous even when both receipts land in the same test tick.
	db.Model(&inventory.Batch{}).Where("id = ?", older.Batch.ID).
		UpdateColumn("received_at", gorm.Expr("received_at - interval '1 hour'"))

	newer, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 10, UnitCost: 2, ExpiryDate: ymd(sameExpiry),
	})
	if err != nil {
		t.Fatalf("receive newer batch: %v", err)
	}

	repo := inventory.NewRepository(db, dushanbe)
	err = db.Transaction(func(tx *gorm.DB) error {
		mID := insertTestMovement(t, tx, p.ID, actor.ID, 4)
		_, err := repo.ConsumeFEFO(tx, context.Background(), p.ID, 4, mID)
		return err
	})
	if err != nil {
		t.Fatalf("ConsumeFEFO: %v", err)
	}

	var olderRow, newerRow inventory.Batch
	db.First(&olderRow, "id = ?", older.Batch.ID)
	db.First(&newerRow, "id = ?", newer.Batch.ID)

	if olderRow.RemainingQuantity != 6 {
		t.Errorf("older (earlier received_at) batch: expected 6 remaining, got %d", olderRow.RemainingQuantity)
	}
	if newerRow.RemainingQuantity != 10 {
		t.Errorf("newer batch: expected untouched 10 remaining, got %d", newerRow.RemainingQuantity)
	}
}

// Scenario 7: a historical batch with no recorded expiry date is consumed
// only after every dated batch, regardless of received_at.
func TestConsumeFEFO_HistoricalNullExpiryConsumedLast(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)
	today := svc.BusinessToday()

	// Historical batch: predates this feature, no expiry, received long ago.
	historical := &inventory.Batch{
		ID: uuid.New(), ProductID: p.ID, ReceivedQuantity: 10, RemainingQuantity: 10,
		UnitCost: 1, ReceivedAt: today.AddDate(0, -6, 0), ExpiryDate: nil, CreatedBy: &actor.ID,
	}
	if err := db.Create(historical).Error; err != nil {
		t.Fatalf("create historical batch: %v", err)
	}

	// Dated batch received AFTER the historical one, but FEFO must still
	// prefer it since it has a known expiry.
	dated, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 10, UnitCost: 2, ExpiryDate: ymd(today.AddDate(0, 0, 10)),
	})
	if err != nil {
		t.Fatalf("receive dated batch: %v", err)
	}

	repo := inventory.NewRepository(db, dushanbe)
	err = db.Transaction(func(tx *gorm.DB) error {
		mID := insertTestMovement(t, tx, p.ID, actor.ID, 4)
		_, err := repo.ConsumeFEFO(tx, context.Background(), p.ID, 4, mID)
		return err
	})
	if err != nil {
		t.Fatalf("ConsumeFEFO: %v", err)
	}

	var datedRow, historicalRow inventory.Batch
	db.First(&datedRow, "id = ?", dated.Batch.ID)
	db.First(&historicalRow, "id = ?", historical.ID)

	if datedRow.RemainingQuantity != 6 {
		t.Errorf("dated batch: expected 6 remaining (consumed first), got %d", datedRow.RemainingQuantity)
	}
	if historicalRow.RemainingQuantity != 10 {
		t.Errorf("historical (no expiry) batch: expected untouched 10 remaining, got %d", historicalRow.RemainingQuantity)
	}
}

// Scenario 8: a consumption spanning multiple batches creates one
// inventory_batch_consumptions row per batch touched, with correct per-batch
// quantities and unit costs.
func TestConsumeFEFO_MultiBatchConsumptionRecords(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)
	today := svc.BusinessToday()

	b1, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 5, UnitCost: 3, ExpiryDate: ymd(today.AddDate(0, 0, 5)),
	})
	if err != nil {
		t.Fatalf("receive b1: %v", err)
	}
	b2, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 10, UnitCost: 6, ExpiryDate: ymd(today.AddDate(0, 0, 15)),
	})
	if err != nil {
		t.Fatalf("receive b2: %v", err)
	}

	var movementID uuid.UUID
	repo := inventory.NewRepository(db, dushanbe)
	err = db.Transaction(func(tx *gorm.DB) error {
		movementID = insertTestMovement(t, tx, p.ID, actor.ID, 8)
		_, err := repo.ConsumeFEFO(tx, context.Background(), p.ID, 8, movementID)
		return err
	})
	if err != nil {
		t.Fatalf("ConsumeFEFO: %v", err)
	}

	var consumptions []inventory.BatchConsumption
	if err := db.Where("movement_id = ?", movementID).Order("unit_cost ASC").Find(&consumptions).Error; err != nil {
		t.Fatalf("load consumptions: %v", err)
	}
	if len(consumptions) != 2 {
		t.Fatalf("expected 2 consumption rows (one per batch touched), got %d", len(consumptions))
	}
	if consumptions[0].BatchID != b1.Batch.ID || consumptions[0].Quantity != 5 || consumptions[0].UnitCost != 3 {
		t.Errorf("first consumption: expected batch %s qty=5 cost=3, got batch=%s qty=%d cost=%v",
			b1.Batch.ID, consumptions[0].BatchID, consumptions[0].Quantity, consumptions[0].UnitCost)
	}
	if consumptions[1].BatchID != b2.Batch.ID || consumptions[1].Quantity != 3 || consumptions[1].UnitCost != 6 {
		t.Errorf("second consumption: expected batch %s qty=3 cost=6, got batch=%s qty=%d cost=%v",
			b2.Batch.ID, consumptions[1].BatchID, consumptions[1].Quantity, consumptions[1].UnitCost)
	}
}

// ─── Expiry alerts ────────────────────────────────────────────────────────────

// Scenario 9: a batch expiring in exactly 14 days is included as expiring_soon.
func TestExpiryAlerts_ExactlyFourteenDaysIncluded(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)
	today := svc.BusinessToday()

	if _, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 5, UnitCost: 1, ExpiryDate: ymd(today.AddDate(0, 0, 14)),
	}); err != nil {
		t.Fatalf("receive: %v", err)
	}

	alerts, _, err := svc.ExpiryAlerts(context.Background())
	if err != nil {
		t.Fatalf("ExpiryAlerts: %v", err)
	}
	found := findAlertByProduct(alerts, p.ID)
	if found == nil {
		t.Fatal("expected a batch expiring in exactly 14 days to appear in alerts")
	}
	if found.DaysUntilExpiry != 14 {
		t.Errorf("expected days_until_expiry=14, got %d", found.DaysUntilExpiry)
	}
	if found.Status != inventory.ExpiryStatusExpiringSoon {
		t.Errorf("expected status expiring_soon, got %s", found.Status)
	}
}

// Scenario 10: a batch expiring on day 15 must NOT appear in alerts.
func TestExpiryAlerts_FifteenDaysExcluded(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)
	today := svc.BusinessToday()

	if _, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 5, UnitCost: 1, ExpiryDate: ymd(today.AddDate(0, 0, 15)),
	}); err != nil {
		t.Fatalf("receive: %v", err)
	}

	alerts, _, err := svc.ExpiryAlerts(context.Background())
	if err != nil {
		t.Fatalf("ExpiryAlerts: %v", err)
	}
	if found := findAlertByProduct(alerts, p.ID); found != nil {
		t.Errorf("expected a batch expiring in 15 days to NOT appear in alerts, got %+v", found)
	}
}

// Scenario 11: a fully consumed batch (remaining_quantity = 0) must not
// appear in alerts even if its expiry date is imminent.
func TestExpiryAlerts_FullyConsumedBatchExcluded(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)
	today := svc.BusinessToday()

	resp, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 5, UnitCost: 1, ExpiryDate: ymd(today.AddDate(0, 0, 2)),
	})
	if err != nil {
		t.Fatalf("receive: %v", err)
	}

	repo := inventory.NewRepository(db, dushanbe)
	err = db.Transaction(func(tx *gorm.DB) error {
		mID := insertTestMovement(t, tx, p.ID, actor.ID, 5)
		_, err := repo.ConsumeFEFO(tx, context.Background(), p.ID, 5, mID)
		return err
	})
	if err != nil {
		t.Fatalf("consume all: %v", err)
	}

	var remaining int
	db.Model(&inventory.Batch{}).Where("id = ?", resp.Batch.ID).Select("remaining_quantity").Scan(&remaining)
	if remaining != 0 {
		t.Fatalf("setup error: expected batch fully consumed, remaining=%d", remaining)
	}

	alerts, _, err := svc.ExpiryAlerts(context.Background())
	if err != nil {
		t.Fatalf("ExpiryAlerts: %v", err)
	}
	if found := findAlertByProduct(alerts, p.ID); found != nil {
		t.Errorf("expected a fully consumed batch to NOT appear in alerts, got %+v", found)
	}
}

// Scenario 12: an already-expired batch with remaining stock appears with a
// negative days_until_expiry and status "expired" (and is not blocked from
// use — see TestConsumeFEFO tests, which never skip expired batches).
func TestExpiryAlerts_ExpiredBatchIncluded(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)
	today := svc.BusinessToday()
	expired := today.AddDate(0, 0, -3)

	// Bypass service-level validation (which rejects a past expiry_date on
	// receiving) to set up a batch that has since expired — this is exactly
	// the state a batch created weeks ago legitimately reaches over time.
	b := &inventory.Batch{
		ID: uuid.New(), ProductID: p.ID, ReceivedQuantity: 5, RemainingQuantity: 5,
		UnitCost: 1, ReceivedAt: today.AddDate(0, 0, -30), ExpiryDate: &expired, CreatedBy: &actor.ID,
	}
	if err := db.Create(b).Error; err != nil {
		t.Fatalf("create expired batch: %v", err)
	}

	alerts, meta, err := svc.ExpiryAlerts(context.Background())
	if err != nil {
		t.Fatalf("ExpiryAlerts: %v", err)
	}
	found := findAlertByProduct(alerts, p.ID)
	if found == nil {
		t.Fatal("expected the expired batch to appear in alerts")
	}
	if found.DaysUntilExpiry != -3 {
		t.Errorf("expected days_until_expiry=-3, got %d", found.DaysUntilExpiry)
	}
	if found.Status != inventory.ExpiryStatusExpired {
		t.Errorf("expected status expired, got %s", found.Status)
	}
	if meta.ExpiredCount < 1 {
		t.Errorf("expected meta.expired_count >= 1, got %d", meta.ExpiredCount)
	}
}

func findAlertByProduct(alerts []inventory.ExpiryAlertResponse, productID uuid.UUID) *inventory.ExpiryAlertResponse {
	for i := range alerts {
		if alerts[i].ProductID == productID {
			return &alerts[i]
		}
	}
	return nil
}

// ─── Editing + audit ──────────────────────────────────────────────────────────

// Scenario 14: editing a receiving's expiry date records old/new in the
// receiving-edit audit trail.
func TestUpdateReceiving_ExpiryEditRecordsAudit(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)
	today := svc.BusinessToday()
	oldExpiry := today.AddDate(0, 0, 10)
	newExpiry := today.AddDate(0, 0, 20)

	resp, err := svc.Receive(context.Background(), actor.ID, inventory.CreateReceivingRequest{
		ProductID: p.ID, Quantity: 5, UnitCost: 1, ExpiryDate: ymd(oldExpiry),
	})
	if err != nil {
		t.Fatalf("receive: %v", err)
	}

	_, err = svc.UpdateReceiving(context.Background(), actor.ID, resp.MovementID, inventory.UpdateReceivingRequest{
		ProductID: p.ID, Quantity: 5, UnitCost: 1, ExpiryDate: ymd(newExpiry),
	})
	if err != nil {
		t.Fatalf("UpdateReceiving: %v", err)
	}

	edits, err := svc.ListReceivingEdits(context.Background(), resp.MovementID)
	if err != nil {
		t.Fatalf("ListReceivingEdits: %v", err)
	}
	if len(edits) != 1 {
		t.Fatalf("expected 1 receiving edit, got %d", len(edits))
	}
	edit := inventory.ToReceivingEditResponse(&edits[0])
	if edit.OldExpiryDate == nil || *edit.OldExpiryDate != ymd(oldExpiry) {
		t.Errorf("expected old_expiry_date %s, got %v", ymd(oldExpiry), edit.OldExpiryDate)
	}
	if edit.NewExpiryDate == nil || *edit.NewExpiryDate != ymd(newExpiry) {
		t.Errorf("expected new_expiry_date %s, got %v", ymd(newExpiry), edit.NewExpiryDate)
	}
}

// ─── Integrity ────────────────────────────────────────────────────────────────

// Scenario 15: after a multi-line receipt and a partial FEFO consumption,
// the integrity check confirms inventory.quantity still equals the sum of
// its batches' remaining_quantity (no discrepancy reported).
func TestInventoryIntegrityCheck_MatchesAfterReceiveAndConsume(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := buildTestService(t, db)
	actor := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	p := testutil.CreateProduct(t, db)
	today := svc.BusinessToday()

	req := inventory.CreateGoodsReceiptRequest{
		InvoiceNo:  "INV-INTEGRITY-1",
		ReceivedAt: ymd(today),
		Items: []inventory.CreateGoodsReceiptItem{
			{ProductID: p.ID, Quantity: 10, UnitCost: 1, ExpiryDate: ymd(today.AddDate(0, 0, 5))},
			{ProductID: p.ID, Quantity: 10, UnitCost: 2, ExpiryDate: ymd(today.AddDate(0, 0, 10))},
		},
	}
	if _, err := svc.ReceiveBatch(context.Background(), actor.ID, req); err != nil {
		t.Fatalf("ReceiveBatch: %v", err)
	}

	repo := inventory.NewRepository(db, dushanbe)
	err := db.Transaction(func(tx *gorm.DB) error {
		inv, err := repo.GetOrCreateForUpdate(tx, context.Background(), p.ID)
		if err != nil {
			return err
		}
		if err := repo.UpdateQuantity(tx, context.Background(), inv.ID, inv.Quantity-7); err != nil {
			return err
		}
		mID := insertTestMovement(t, tx, p.ID, actor.ID, 7)
		_, err = repo.ConsumeFEFO(tx, context.Background(), p.ID, 7, mID)
		return err
	})
	if err != nil {
		t.Fatalf("consume: %v", err)
	}

	discrepancies, err := svc.InventoryIntegrityCheck(context.Background())
	if err != nil {
		t.Fatalf("InventoryIntegrityCheck: %v", err)
	}
	for _, d := range discrepancies {
		if d.ProductID == p.ID {
			t.Fatalf("expected no discrepancy for product %s, got %+v", p.ID, d)
		}
	}
}
