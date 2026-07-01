package budget

import (
	"time"

	"github.com/google/uuid"
)

type TransactionType string

const (
	TypeManualIncome    TransactionType = "manual_income" // displayed to the owner as "Top-up"
	TypeOwnerWithdrawal TransactionType = "owner_withdrawal"

	// TypeManualExpense and TypeFinanceProfit are legacy values that pre-date the
	// Finance/Budget split. Historical rows of these types remain in the table
	// forever (no deletes) but new code never writes them — business expenses now
	// live in internal/finance, and accumulated profit is computed live via
	// internal/finance.Repository.GetNetProfit instead of being stored per-order.
	TypeManualExpense TransactionType = "manual_expense"
	TypeFinanceProfit TransactionType = "finance_profit"
)

// Transaction is a row in company_budget_transactions. Company Budget only ever
// creates manual_income (top-up) and owner_withdrawal rows going forward.
type Transaction struct {
	ID              uuid.UUID       `gorm:"type:uuid;primaryKey"`
	TransactionType TransactionType `gorm:"type:budget_transaction_type;column:transaction_type;not null"`
	Amount          float64         `gorm:"type:numeric(14,2);not null"`
	Note            string          `gorm:"not null;default:''"`
	CreatedBy       *uuid.UUID      `gorm:"type:uuid;column:created_by"`
	SourceOrderID   *uuid.UUID      `gorm:"type:uuid;column:source_order_id"`
	BalanceAfter    float64         `gorm:"type:numeric(14,2);column:balance_after;not null"`
	CreatedAt       time.Time       `gorm:"autoCreateTime"`
}

func (Transaction) TableName() string { return "company_budget_transactions" }
