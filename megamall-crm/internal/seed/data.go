package seed

import "github.com/megamall/crm/internal/compensation"

// ─── Demo users ───────────────────────────────────────────────────────────────

type demoUser struct {
	phone    string
	fullName string
	role     string
	// password is NOT stored here — injected at runtime from Config.
	// See Config.passwordFor(role).
}

// demoUsers defines the full set of demo accounts.
// Passwords are resolved by Config.passwordFor at seed time, not hardcoded here.
var demoUsers = []demoUser{
	{phone: "+992900000001", fullName: "Owner Admin",         role: "owner"},
	{phone: "+992900000002", fullName: "Team Lead Demo",      role: "sales_team_lead"},
	{phone: "+992900000003", fullName: "Manager Demo",        role: "manager"},
	{phone: "+992900000004", fullName: "Seller Demo",         role: "seller"},
	{phone: "+992900000005", fullName: "Dispatcher Demo",     role: "dispatcher"},
	{phone: "+992900000006", fullName: "Warehouse Demo",      role: "warehouse_manager"},
	{phone: "+992900000007", fullName: "Courier Demo",        role: "courier"},
}

// ─── Default commission rates (global scope) ──────────────────────────────────
// Uses only commission types defined in Phase 2 (compensation.AllCommissionTypes).

type defaultRate struct {
	commType compensation.CommissionType
	rate     float64
	notes    string
}

var defaultCommissionRates = []defaultRate{
	{compensation.CommissionTypeSellerRate,          0.10000, "default global seller commission (10%)"},
	{compensation.CommissionTypeManagerTeamRate,     0.05000, "default global manager team commission (5%)"},
	{compensation.CommissionTypeManagerPersonalRate, 0.12000, "default global manager personal commission (12%)"},
	{compensation.CommissionTypeTeamLeadPoolRate,    0.03000, "default global team lead pool (3%)"},
	{compensation.CommissionTypeCompanyRate,         0.30000, "default global company revenue (30%)"},
}

// ─── Catalog constants ────────────────────────────────────────────────────────

const (
	DefaultWarehouseName  = "Main Warehouse"
	DefaultCategoryName   = "General"
	DefaultSupplierName   = "Default Supplier"
	DefaultProductSKU     = "TEST-001"
	DefaultProductName    = "Test Product"
	DefaultTeamName       = "Default Team"
	DefaultTariffName     = "Standard Delivery"
	DefaultTariffFee      = 10.0
	DefaultProductSalePrice = 100.0
	DefaultProductPurchasePrice = 40.0
	DefaultInventoryQty   = 100
	DefaultLowStockThreshold = 10
)
