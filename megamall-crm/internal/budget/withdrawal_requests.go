package budget

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrWithdrawalRequestNotFound = errors.New("withdrawal request not found")
	ErrWithdrawalRequestDecided  = errors.New("withdrawal request already decided")
)

// CreateWithdrawalRequest inserts a pending withdrawal request. The real
// company_budget_transactions row (and balance change) is only created once
// ApproveWithdrawalRequest runs.
func (r *Repository) CreateWithdrawalRequest(ctx context.Context, userID uuid.UUID, amount float64, note string, expiresAt time.Time) (*WithdrawalRequest, error) {
	row := WithdrawalRequest{
		ID:          uuid.New(),
		Amount:      amount,
		Note:        note,
		RequestedBy: userID,
		Status:      WithdrawalRequestPending,
		ExpiresAt:   expiresAt,
	}
	if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

// SetTelegramMessage records the chat/message ID of the approval message sent
// for a request, so it can be edited later once decided.
func (r *Repository) SetTelegramMessage(ctx context.Context, id uuid.UUID, chatID, messageID int64) error {
	return r.db.WithContext(ctx).Model(&WithdrawalRequest{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{"telegram_chat_id": chatID, "telegram_message_id": messageID}).Error
}

// GetWithdrawalRequest fetches one request by ID.
func (r *Repository) GetWithdrawalRequest(ctx context.Context, id uuid.UUID) (*WithdrawalRequest, error) {
	var row WithdrawalRequest
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrWithdrawalRequestNotFound
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// ListWithdrawalRequests returns the most recent requests (pending first by
// virtue of created_at ordering being recent-first — pending ones are
// necessarily recent since they expire), for the owner's approval-status view.
func (r *Repository) ListWithdrawalRequests(ctx context.Context, limit int) ([]WithdrawalRequestRow, error) {
	if limit < 1 || limit > 200 {
		limit = 50
	}
	var rows []WithdrawalRequestRow
	err := r.db.WithContext(ctx).Table("budget_withdrawal_requests req").
		Select(`req.id, req.amount, req.note, req.status,
			u.full_name AS requested_by_name,
			req.decided_at, req.expires_at, req.created_at`).
		Joins("LEFT JOIN users u ON u.id = req.requested_by").
		Order("req.created_at DESC").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

// ApproveWithdrawalRequest atomically moves a pending request to approved and
// creates the corresponding owner_withdrawal ledger row, returning the new
// company balance. Returns ErrWithdrawalRequestDecided if it was already
// approved/rejected/expired (e.g. a double button press, or the timeout sweep
// racing an approval) — the caller should treat that as a no-op, not an error
// to surface to the Telegram user as a failure.
func (r *Repository) ApproveWithdrawalRequest(ctx context.Context, id uuid.UUID, telegramUserID int64) (float64, error) {
	var newBalance float64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var req WithdrawalRequest
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", id).First(&req).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrWithdrawalRequestNotFound
			}
			return err
		}
		if req.Status != WithdrawalRequestPending {
			return ErrWithdrawalRequestDecided
		}

		manual, err := manualNet(ctx, tx, nil, nil)
		if err != nil {
			return err
		}
		newManual := roundMoney(manual - req.Amount)
		txn := Transaction{
			ID:              uuid.New(),
			TransactionType: TypeOwnerWithdrawal,
			Amount:          req.Amount,
			Note:            req.Note,
			CreatedBy:       &req.RequestedBy,
			BalanceAfter:    newManual,
		}
		if err := tx.WithContext(ctx).Create(&txn).Error; err != nil {
			return err
		}

		netProfit, err := r.financeRepo.GetNetProfit(ctx, nil, nil)
		if err != nil {
			return err
		}
		newBalance = roundMoney(newManual + netProfit)

		now := time.Now()
		return tx.Model(&WithdrawalRequest{}).Where("id = ?", id).Updates(map[string]interface{}{
			"status":                      WithdrawalRequestApproved,
			"decided_by_telegram_user_id": telegramUserID,
			"decided_at":                  now,
			"transaction_id":              txn.ID,
		}).Error
	})
	if err != nil {
		return 0, err
	}
	return newBalance, nil
}

// RejectWithdrawalRequest atomically moves a pending request to rejected. No
// ledger row is ever created for a rejected request.
func (r *Repository) RejectWithdrawalRequest(ctx context.Context, id uuid.UUID, telegramUserID int64) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var req WithdrawalRequest
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", id).First(&req).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrWithdrawalRequestNotFound
			}
			return err
		}
		if req.Status != WithdrawalRequestPending {
			return ErrWithdrawalRequestDecided
		}
		now := time.Now()
		return tx.Model(&WithdrawalRequest{}).Where("id = ?", id).Updates(map[string]interface{}{
			"status":                      WithdrawalRequestRejected,
			"decided_by_telegram_user_id": telegramUserID,
			"decided_at":                  now,
		}).Error
	})
}

// ExpiredRequest is one request the sweep goroutine just auto-expired, with
// enough Telegram context to edit its message in place.
type ExpiredRequest struct {
	ID                uuid.UUID
	Amount            float64
	TelegramChatID    *int64
	TelegramMessageID *int64
}

// ExpirePendingRequests marks every still-pending request whose expires_at
// has passed as expired, and returns them so the caller can edit their
// Telegram messages to reflect the timeout.
func (r *Repository) ExpirePendingRequests(ctx context.Context, now time.Time) ([]ExpiredRequest, error) {
	var toExpire []WithdrawalRequest
	if err := r.db.WithContext(ctx).
		Where("status = ? AND expires_at < ?", WithdrawalRequestPending, now).
		Find(&toExpire).Error; err != nil {
		return nil, err
	}
	if len(toExpire) == 0 {
		return nil, nil
	}

	ids := make([]uuid.UUID, 0, len(toExpire))
	for _, req := range toExpire {
		ids = append(ids, req.ID)
	}
	if err := r.db.WithContext(ctx).Model(&WithdrawalRequest{}).
		Where("id IN ? AND status = ?", ids, WithdrawalRequestPending).
		Update("status", WithdrawalRequestExpired).Error; err != nil {
		return nil, err
	}

	expired := make([]ExpiredRequest, 0, len(toExpire))
	for _, req := range toExpire {
		expired = append(expired, ExpiredRequest{
			ID:                req.ID,
			Amount:            req.Amount,
			TelegramChatID:    req.TelegramChatID,
			TelegramMessageID: req.TelegramMessageID,
		})
	}
	return expired, nil
}
