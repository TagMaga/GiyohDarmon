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

type WithdrawalRequestStatus string

const (
	WithdrawalRequestPending  WithdrawalRequestStatus = "pending"
	WithdrawalRequestApproved WithdrawalRequestStatus = "approved"
	WithdrawalRequestRejected WithdrawalRequestStatus = "rejected"
	WithdrawalRequestExpired  WithdrawalRequestStatus = "expired"
)

// WithdrawalRequest is a row in budget_withdrawal_requests: an owner
// withdrawal that is held pending Telegram approval before the corresponding
// company_budget_transactions row (and balance change) is created.
type WithdrawalRequest struct {
	ID                      uuid.UUID               `gorm:"type:uuid;primaryKey"`
	Amount                  float64                 `gorm:"type:numeric(14,2);not null"`
	Note                    string                  `gorm:"not null;default:''"`
	RequestedBy             uuid.UUID               `gorm:"type:uuid;column:requested_by;not null"`
	Status                  WithdrawalRequestStatus `gorm:"type:budget_withdrawal_request_status;not null;default:pending"`
	TelegramChatID          *int64                  `gorm:"column:telegram_chat_id"`
	TelegramMessageID       *int64                  `gorm:"column:telegram_message_id"`
	DecidedByTelegramUserID *int64                  `gorm:"column:decided_by_telegram_user_id"`
	DecidedAt               *time.Time              `gorm:"column:decided_at"`
	ExpiresAt               time.Time               `gorm:"column:expires_at;not null"`
	TransactionID           *uuid.UUID              `gorm:"type:uuid;column:transaction_id"`
	CreatedAt               time.Time               `gorm:"autoCreateTime"`
}

func (WithdrawalRequest) TableName() string { return "budget_withdrawal_requests" }
