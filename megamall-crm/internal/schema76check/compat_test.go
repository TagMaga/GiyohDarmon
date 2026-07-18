//go:build schema76check

// Gated behind an explicit build tag: TestSchema76Compat_* are DESIGNED to
// fail against schema 76 (that failure is the proof this gate exists to
// produce — see the doc comment below), so this package must never run as
// part of the normal `go test ./...` suite (which pr-checks.yml's CI
// runs) — it would fail permanently, forever, by design, which is not a
// real CI regression. Run explicitly and only when re-verifying this
// specific hazard:
//
//	TEST_ADMIN_DSN=... go test -tags schema76check ./internal/schema76check/... -v
package schema76check

// compat_test.go — Phase 1 merge-readiness gate, requested explicitly
// before merging PR #42: proves whether this PR's application code can
// operate against a database migrated only through schema version 76 —
// i.e. BEFORE migrations 00077-00080 (which add avatar_media_asset_id to
// users, and media_asset_id/width/height to order_attachments,
// order_prepayments, and user_documents) are applied.
//
// This simulates the "deploy-before-migrate" misordering hazard: if the
// new binary were rolled out to production before those four migrations
// ran, would existing avatar/order/prepayment/document/cash-handover
// read-write flows break?
//
// Requires TEST_ADMIN_DSN (see pkg/dbsafety) — refuses to run against
// anything but a disposable loopback database, exactly like
// internal/testutil. Never touches production. Provisions its own
// separate disposable database (deliberately not using
// internal/testutil.NewTestDB, which always migrates to the LATEST
// version — the entire point here is to stop one migration short of
// this PR's own 00077-00080).
//
// Run with: TEST_ADMIN_DSN=... go test ./internal/schema76check/ -v

import (
	"context"
	"fmt"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/megamall/crm/internal/courier"
	"github.com/megamall/crm/internal/customers"
	"github.com/megamall/crm/internal/orders"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"github.com/megamall/crm/pkg/dbsafety"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// schema76TargetVersion is the migration version this check deliberately
// stops at — one short of this PR's own 00077 (avatar), 00078 (order
// attachments), 00079 (order prepayments), 00080 (user documents).
const schema76TargetVersion = 76

func migrationsDir(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate migrations dir: runtime.Caller failed")
	}
	dir := filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations")
	return dir
}

// provisionSchema76DB creates a fresh disposable database + role (the
// same safety discipline as internal/testutil.provisionDisposableDB —
// disposable, unprivileged role; AssertNotProduction on both the admin
// and disposable connection strings; guaranteed drop on cleanup) and
// migrates it ONLY through schema76TargetVersion via goose.UpTo, instead
// of testutil's goose.Up (which always goes to the latest migration).
func provisionSchema76DB(t *testing.T) *gorm.DB {
	t.Helper()
	ctx := context.Background()

	adminDSN, err := dbsafety.AdminDSN()
	if err != nil {
		t.Fatalf("AdminDSN: %v", err)
	}
	adminCfg, err := pgx.ParseConfig(adminDSN)
	if err != nil {
		t.Fatalf("parse admin DSN: %v", err)
	}
	adminConn, err := pgx.ConnectConfig(ctx, adminCfg)
	if err != nil {
		t.Fatalf("connect to disposable-DB admin instance: %v", err)
	}

	dbToken, err1 := dbsafety.RandomToken(6)
	roleToken, err2 := dbsafety.RandomToken(6)
	password, err3 := dbsafety.RandomToken(24)
	for _, e := range []error{err1, err2, err3} {
		if e != nil {
			adminConn.Close(ctx)
			t.Fatalf("generate random token: %v", e)
		}
	}

	dbName := "megamall_schema76_" + dbToken
	roleName := "schema76_role_" + roleToken

	if verifyErr := dbsafety.AssertNotProduction(fmt.Sprintf("host=%s port=%d dbname=%s user=%s", adminCfg.Host, adminCfg.Port, dbName, roleName)); verifyErr != nil {
		adminConn.Close(ctx)
		t.Fatalf("refusing to provision schema76 database: %v", verifyErr)
	}

	quotedRole := pgx.Identifier{roleName}.Sanitize()
	quotedDB := pgx.Identifier{dbName}.Sanitize()

	teardown := func() {
		_, _ = adminConn.Exec(ctx, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, dbName)
		_, _ = adminConn.Exec(ctx, "DROP DATABASE IF EXISTS "+quotedDB)
		_, _ = adminConn.Exec(ctx, "DROP ROLE IF EXISTS "+quotedRole)
		adminConn.Close(ctx)
	}
	t.Cleanup(teardown)

	if _, execErr := adminConn.Exec(ctx, fmt.Sprintf(
		"CREATE ROLE %s LOGIN PASSWORD '%s' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION",
		quotedRole, password,
	)); execErr != nil {
		t.Fatalf("create disposable role: %v", execErr)
	}
	if _, execErr := adminConn.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s OWNER %s", quotedDB, quotedRole)); execErr != nil {
		t.Fatalf("create disposable database: %v", execErr)
	}
	if _, execErr := adminConn.Exec(ctx, "REVOKE ALL ON DATABASE "+quotedDB+" FROM PUBLIC"); execErr != nil {
		t.Fatalf("restrict disposable database to its owner: %v", execErr)
	}

	schemaCfg := adminCfg.Copy()
	schemaCfg.Database = dbName
	schemaConn, err := pgx.ConnectConfig(ctx, schemaCfg)
	if err != nil {
		t.Fatalf("connect to disposable database as admin: %v", err)
	}
	if _, execErr := schemaConn.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS pgcrypto"); execErr != nil {
		schemaConn.Close(ctx)
		t.Fatalf("create pgcrypto extension: %v", execErr)
	}
	if _, execErr := schemaConn.Exec(ctx, "ALTER SCHEMA public OWNER TO "+quotedRole); execErr != nil {
		schemaConn.Close(ctx)
		t.Fatalf("grant public schema ownership: %v", execErr)
	}
	schemaConn.Close(ctx)

	disposableCfg := adminCfg.Copy()
	disposableCfg.Database = dbName
	disposableCfg.User = roleName
	disposableCfg.Password = password

	if verifyErr := dbsafety.AssertNotProduction(disposableCfg.ConnString()); verifyErr != nil {
		t.Fatalf("refusing disposable connection: %v", verifyErr)
	}

	sqlDB := stdlib.OpenDB(*disposableCfg)
	t.Cleanup(func() { sqlDB.Close() })

	goose.SetLogger(goose.NopLogger())
	if dialectErr := goose.SetDialect("postgres"); dialectErr != nil {
		t.Fatalf("set goose dialect: %v", dialectErr)
	}
	if upErr := goose.UpTo(sqlDB, migrationsDir(t), schema76TargetVersion); upErr != nil {
		t.Fatalf("migrate up to %d: %v", schema76TargetVersion, upErr)
	}

	// Confirm we actually stopped where intended, not at the latest.
	version, dbVersionErr := goose.GetDBVersion(sqlDB)
	if dbVersionErr != nil {
		t.Fatalf("get db version: %v", dbVersionErr)
	}
	if version != schema76TargetVersion {
		t.Fatalf("expected schema version %d, got %d — migrations directory or UpTo call is wrong", schema76TargetVersion, version)
	}
	t.Logf("provisioned disposable database %q at schema version %d (migrations 00077-00080 NOT applied)", dbName, version)

	gdb, openErr := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if openErr != nil {
		t.Fatalf("open gorm over disposable database: %v", openErr)
	}
	return gdb
}

// TestSchema76Compat_UserAvatarFlow proves whether internal/users.User's
// avatar-related create/read/update flows survive against schema 76
// (i.e. before avatar_media_asset_id/avatar_width/avatar_height exist).
func TestSchema76Compat_UserAvatarFlow(t *testing.T) {
	db := provisionSchema76DB(t)
	ctx := context.Background()

	var u *users.User
	t.Run("create_user", func(t *testing.T) {
		u = testutil.CreateUser(t, db, users.RoleSeller)
	})
	if u == nil {
		t.Fatal("create_user subtest failed — cannot continue avatar flow checks")
	}

	repo := users.NewRepository(db)
	t.Run("get_user_by_id", func(t *testing.T) {
		got, err := repo.GetByID(ctx, u.ID)
		if err != nil {
			t.Fatalf("GetByID: %v", err)
		}
		if got == nil {
			t.Fatal("expected user to be found")
		}
	})
	t.Run("update_user", func(t *testing.T) {
		u.FullName = "Updated Seller Name"
		if err := repo.Update(ctx, u); err != nil {
			t.Fatalf("Update: %v", err)
		}
	})
}

// TestSchema76Compat_UserDocumentFlow proves whether HR/passport document
// create/read survive against schema 76 (before user_documents.media_asset_id
// / width / height exist).
func TestSchema76Compat_UserDocumentFlow(t *testing.T) {
	db := provisionSchema76DB(t)
	ctx := context.Background()

	subject := testutil.CreateUser(t, db, users.RoleSeller)
	owner := testutil.CreateUser(t, db, users.RoleOwner)
	repo := users.NewRepository(db)

	var docID uuid.UUID
	t.Run("create_document_legacy_url", func(t *testing.T) {
		doc := &users.UserDocument{
			ID:               uuid.New(),
			UserID:           subject.ID,
			FileURL:          "/uploads/legacy-passport.pdf",
			OriginalFilename: "passport.pdf",
			UploadedBy:       &owner.ID,
		}
		if err := repo.CreateDocument(ctx, doc); err != nil {
			t.Fatalf("CreateDocument: %v", err)
		}
		docID = doc.ID
	})
	if docID == uuid.Nil {
		t.Fatal("create_document_legacy_url subtest failed — cannot continue")
	}
	t.Run("list_documents", func(t *testing.T) {
		docs, err := repo.ListDocuments(ctx, subject.ID)
		if err != nil {
			t.Fatalf("ListDocuments: %v", err)
		}
		if len(docs) != 1 {
			t.Fatalf("expected 1 document, got %d", len(docs))
		}
	})
	t.Run("get_document", func(t *testing.T) {
		doc, err := repo.GetDocument(ctx, subject.ID, docID)
		if err != nil {
			t.Fatalf("GetDocument: %v", err)
		}
		if doc == nil {
			t.Fatal("expected document to be found")
		}
	})
}

// TestSchema76Compat_OrderAttachmentAndPrepaymentFlow proves whether order
// attachment/prepayment create/read survive against schema 76 (before
// order_attachments.media_asset_id and order_prepayments.media_asset_id
// exist). The order and customer rows themselves are untouched by any of
// this PR's migrations, so only the attachment/prepayment inserts and
// reads are the actual subject of this check.
func TestSchema76Compat_OrderAttachmentAndPrepaymentFlow(t *testing.T) {
	db := provisionSchema76DB(t)
	ctx := context.Background()

	seller := testutil.CreateUser(t, db, users.RoleSeller)

	custRepo := customers.NewRepository(db)
	cust := &customers.Customer{
		ID:       uuid.New(),
		FullName: "Schema76 Test Customer",
		Phone:    "+1" + uuid.New().String()[:9],
	}
	if err := custRepo.Create(ctx, cust); err != nil {
		t.Fatalf("create customer fixture: %v", err)
	}

	order := &orders.Order{
		ID:         uuid.New(),
		CustomerID: cust.ID,
		SellerID:   seller.ID,
		OrderType:  orders.OrderTypeSeller,
	}
	if err := db.Table("orders").Create(order).Error; err != nil {
		t.Fatalf("create order fixture: %v", err)
	}

	t.Run("create_order_attachment_legacy_url", func(t *testing.T) {
		att := &orders.OrderAttachment{
			ID:         uuid.New(),
			OrderID:    order.ID,
			Type:       "payment_proof",
			FileURL:    "/uploads/legacy-proof.jpg",
			UploadedBy: seller.ID,
		}
		if err := db.Create(att).Error; err != nil {
			t.Fatalf("create order attachment: %v", err)
		}
	})

	t.Run("list_order_attachments", func(t *testing.T) {
		var atts []orders.OrderAttachment
		if err := db.Where("order_id = ?", order.ID).Find(&atts).Error; err != nil {
			t.Fatalf("list order attachments: %v", err)
		}
		if len(atts) != 1 {
			t.Fatalf("expected 1 attachment, got %d", len(atts))
		}
	})

	t.Run("create_order_prepayment_legacy_url", func(t *testing.T) {
		url := "/uploads/legacy-prepayment.jpg"
		p := &orders.OrderPrepayment{
			ID:        uuid.New(),
			OrderID:   order.ID,
			Amount:    50,
			ProofURL:  &url,
			CreatedBy: seller.ID,
		}
		if err := db.Create(p).Error; err != nil {
			t.Fatalf("create order prepayment: %v", err)
		}
	})

	t.Run("list_order_prepayments", func(t *testing.T) {
		var prepayments []orders.OrderPrepayment
		if err := db.Where("order_id = ?", order.ID).Find(&prepayments).Error; err != nil {
			t.Fatalf("list order prepayments: %v", err)
		}
		if len(prepayments) != 1 {
			t.Fatalf("expected 1 prepayment, got %d", len(prepayments))
		}
	})
}

// TestMigrations77To80_UpDownUp proves migrations 00077-00080 are cleanly
// reversible: from schema 76, up to 80 (latest), down four times back to
// 76, then up to 80 again — each step must succeed with no error, and the
// final schema version must land back on 80.
func TestMigrations77To80_UpDownUp(t *testing.T) {
	db := provisionSchema76DB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get *sql.DB: %v", err)
	}
	dir := migrationsDir(t)

	t.Run("up_to_80", func(t *testing.T) {
		if err := goose.UpTo(sqlDB, dir, 80); err != nil {
			t.Fatalf("goose up to 80: %v", err)
		}
		v, err := goose.GetDBVersion(sqlDB)
		if err != nil {
			t.Fatalf("get db version: %v", err)
		}
		if v != 80 {
			t.Fatalf("expected version 80, got %d", v)
		}
	})

	t.Run("down_to_76", func(t *testing.T) {
		for i := 0; i < 4; i++ {
			if err := goose.Down(sqlDB, dir); err != nil {
				t.Fatalf("goose down (step %d): %v", i+1, err)
			}
		}
		v, err := goose.GetDBVersion(sqlDB)
		if err != nil {
			t.Fatalf("get db version: %v", err)
		}
		if v != 76 {
			t.Fatalf("expected version 76 after 4 downs, got %d", v)
		}
	})

	t.Run("up_to_80_again", func(t *testing.T) {
		if err := goose.UpTo(sqlDB, dir, 80); err != nil {
			t.Fatalf("goose up to 80 (second time): %v", err)
		}
		v, err := goose.GetDBVersion(sqlDB)
		if err != nil {
			t.Fatalf("get db version: %v", err)
		}
		if v != 80 {
			t.Fatalf("expected version 80, got %d", v)
		}
	})

	// After the up/down/up cycle, the columns must actually be usable
	// again — a real create against the fully-migrated schema.
	t.Run("create_user_after_updownup", func(t *testing.T) {
		testutil.CreateUser(t, db, users.RoleSeller)
	})
}

// TestSchema76Compat_CashHandoverFlow_UnaffectedByThisPR is the control
// case: none of this PR's migrations touch cash_handovers (cash-handover
// proofs attach via the existing media_assets.owner_entity_type/
// owner_entity_id columns alone — see internal/courier/service.go's
// SubmitHandover doc comment), so this flow is expected to succeed against
// schema 76 exactly as it does today, with no schema change at all.
func TestSchema76Compat_CashHandoverFlow_UnaffectedByThisPR(t *testing.T) {
	db := provisionSchema76DB(t)
	ctx := context.Background()

	courierUser := testutil.CreateUser(t, db, users.RoleCourier)
	repo := courier.NewRepository(db)

	var handoverID uuid.UUID
	t.Run("create_cash_handover", func(t *testing.T) {
		h := &courier.CashHandover{
			ID:                uuid.New(),
			CourierID:         courierUser.ID,
			TotalCollected:    500,
			TotalDeliveryFees: 50,
			TotalToReturn:     450,
			Status:            courier.HandoverStatusPending,
		}
		if err := repo.CreateHandover(db, ctx, h); err != nil {
			t.Fatalf("CreateHandover: %v", err)
		}
		handoverID = h.ID
	})
	if handoverID == uuid.Nil {
		t.Fatal("create_cash_handover subtest failed — cannot continue")
	}

	t.Run("get_handover_by_id", func(t *testing.T) {
		h, err := repo.GetHandoverByID(ctx, handoverID)
		if err != nil {
			t.Fatalf("GetHandoverByID: %v", err)
		}
		if h == nil {
			t.Fatal("expected handover to be found")
		}
	})
}
