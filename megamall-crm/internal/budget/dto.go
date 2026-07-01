package budget

import "time"

// SummaryRow is the dashboard summary. Balance and TodayChange are always
// computed all-time / for the current day (unaffected by the caller's date
// filter). ProfitFromFinance/ManualTopUps/OwnerWithdrawals/TotalReceived are
// scoped to the requested [From, To] period.
type SummaryRow struct {
	Balance           float64 `json:"balance"`             // company balance, all-time, never affected by date filter
	ProfitFromFinance float64 `json:"profit_from_finance"` // period: accumulated Finance net profit (live, not stored)
	ManualTopUps      float64 `json:"manual_top_ups"`      // period: SUM(manual_income)
	OwnerWithdrawals  float64 `json:"owner_withdrawals"`   // period: SUM(owner_withdrawal)
	TotalReceived     float64 `json:"total_received"`      // period: profit_from_finance + manual_top_ups
	TodayChange       float64 `json:"today_change"`        // always today, unaffected by date filter
}

type CreatorRow struct {
	ID       string `gorm:"column:id"        json:"id"`
	FullName string `gorm:"column:full_name" json:"full_name"`
}

type TransactionRow struct {
	ID              string    `gorm:"column:id"               json:"id"`
	TransactionType string    `gorm:"column:transaction_type" json:"transaction_type"`
	Amount          float64   `gorm:"column:amount"           json:"amount"`
	Note            string    `gorm:"column:note"             json:"note"`
	CreatedByName   *string   `gorm:"column:created_by_name"  json:"created_by_name"`
	IsEdited        bool      `gorm:"column:is_edited"        json:"is_edited"`
	EditCount       int       `gorm:"column:edit_count"       json:"edit_count"`
	LastEditedAt    *time.Time `gorm:"column:last_edited_at"  json:"last_edited_at,omitempty"`
	BalanceAfter    float64   `gorm:"column:balance_after"    json:"balance_after"`
	CreatedAt       time.Time `gorm:"column:created_at"       json:"created_at"`
}
