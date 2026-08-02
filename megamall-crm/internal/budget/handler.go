package budget

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
)

// SendApprovalRequestFn sends the Telegram Approve/Reject message for a
// pending withdrawal request and returns the resulting chat/message ID (so it
// can be edited later once decided). Injected from cmd/server/main.go — the
// budget module deliberately doesn't import internal/telegram directly, to
// keep the same narrow-function-injection pattern used for cross-module
// dependencies elsewhere in this codebase.
type SendApprovalRequestFn func(ctx context.Context, requestID uuid.UUID, amount float64, note, requestedByName string) (chatID, messageID int64, err error)

type Handler struct {
	repo            *Repository
	sendApproval    SendApprovalRequestFn
	approvalTimeout time.Duration
	loc             *time.Location
}

// NewHandler creates a budget Handler. loc controls how bare YYYY-MM-DD
// from/to params are interpreted, as local midnight.
func NewHandler(repo *Repository, loc *time.Location) *Handler {
	if loc == nil {
		loc = time.UTC
	}
	return &Handler{repo: repo, approvalTimeout: 24 * time.Hour, loc: loc}
}

// SetTelegramApproval wires up the Telegram approval gate. When unset (the
// default), owner withdrawals post directly to the ledger exactly as before —
// this is what keeps a deploy with TELEGRAM_APPROVAL_ENABLED=false a no-op.
func (h *Handler) SetTelegramApproval(sendFn SendApprovalRequestFn, timeout time.Duration) {
	h.sendApproval = sendFn
	if timeout > 0 {
		h.approvalTimeout = timeout
	}
}

// GET /owner/budget/summary?from=&to=
func (h *Handler) GetSummary(c *gin.Context) {
	var from, to *time.Time
	if f := c.Query("from"); f != "" {
		t, err := time.ParseInLocation("2006-01-02", f, h.loc)
		if err != nil {
			response.Error(c, apperrors.BadRequest("invalid from date"))
			return
		}
		from = &t
	}
	if t := c.Query("to"); t != "" {
		parsed, err := time.ParseInLocation("2006-01-02", t, h.loc)
		if err != nil {
			response.Error(c, apperrors.BadRequest("invalid to date"))
			return
		}
		end := parsed.Add(24*time.Hour - time.Second)
		to = &end
	}

	row, err := h.repo.Summary(c.Request.Context(), from, to)
	if err != nil {
		response.Error(c, apperrors.Internal(err))
		return
	}
	response.OK(c, row)
}

// GET /owner/budget/transactions
func (h *Handler) ListTransactions(c *gin.Context) {
	pg := pagination.ParseFromQueryWithDefaults(c, 1, 50)
	p := ListParams{
		TransactionType: c.Query("type"),
		Search:          c.Query("search"),
		Page:            pg.Page,
		Limit:           pg.Limit,
	}
	if cb := c.Query("created_by"); cb != "" {
		id, err := uuid.Parse(cb)
		if err != nil {
			response.Error(c, apperrors.BadRequest("invalid created_by"))
			return
		}
		p.CreatedBy = &id
	}
	if f := c.Query("from"); f != "" {
		t, err := time.ParseInLocation("2006-01-02", f, h.loc)
		if err != nil {
			response.Error(c, apperrors.BadRequest("invalid from date"))
			return
		}
		p.From = &t
	}
	if to := c.Query("to"); to != "" {
		t, err := time.ParseInLocation("2006-01-02", to, h.loc)
		if err != nil {
			response.Error(c, apperrors.BadRequest("invalid to date"))
			return
		}
		p.To = &t
	}

	rows, total, err := h.repo.List(c.Request.Context(), p)
	if err != nil {
		response.Error(c, apperrors.Internal(err))
		return
	}
	response.OKWithMeta(c, rows, pagination.BuildMeta(pg, int(total)))
}

type incomeRequest struct {
	Amount float64 `json:"amount" binding:"gte=0"`
	Note   string  `json:"note"`
}

// POST /owner/budget/income — manual top-up
func (h *Handler) AddIncome(c *gin.Context) {
	var req incomeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if claims == nil {
		response.Error(c, apperrors.Unauthorized("not authenticated"))
		return
	}
	newBal, err := h.repo.AddIncome(c.Request.Context(), nil, claims.UserID, req.Amount, req.Note)
	if err != nil {
		response.Error(c, apperrors.Internal(err))
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": gin.H{"balance": newBal}})
}

type withdrawalRequest struct {
	Amount float64 `json:"amount" binding:"gte=0"`
	Note   string  `json:"note"`
}

// POST /owner/budget/withdrawal — owner withdrawal. When Telegram approval is
// configured (SetTelegramApproval called with a non-nil sender), this creates
// a pending request and returns 202 instead of writing the ledger row
// immediately; the actual withdrawal only happens once approved via the
// Telegram Approve button (see HandleTelegramDecision).
func (h *Handler) AddWithdrawal(c *gin.Context) {
	var req withdrawalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if claims == nil {
		response.Error(c, apperrors.Unauthorized("not authenticated"))
		return
	}

	if h.sendApproval == nil {
		newBal, err := h.repo.AddWithdrawal(c.Request.Context(), nil, claims.UserID, req.Amount, req.Note)
		if err != nil {
			if errors.Is(err, ErrInsufficientBalance) {
				response.Error(c, apperrors.Unprocessable("insufficient balance"))
				return
			}
			response.Error(c, apperrors.Internal(err))
			return
		}
		c.JSON(http.StatusCreated, gin.H{"success": true, "data": gin.H{"balance": newBal}})
		return
	}

	ctx := c.Request.Context()
	expiresAt := time.Now().Add(h.approvalTimeout)
	pending, err := h.repo.CreateWithdrawalRequest(ctx, claims.UserID, req.Amount, req.Note, expiresAt)
	if err != nil {
		response.Error(c, apperrors.Internal(err))
		return
	}

	requesterName, _ := h.repo.UserFullName(ctx, claims.UserID)
	chatID, messageID, err := h.sendApproval(ctx, pending.ID, req.Amount, req.Note, requesterName)
	if err != nil {
		response.Error(c, apperrors.Internal(fmt.Errorf("send telegram approval message: %w", err)))
		return
	}
	if err := h.repo.SetTelegramMessage(ctx, pending.ID, chatID, messageID); err != nil {
		response.Error(c, apperrors.Internal(err))
		return
	}

	c.JSON(http.StatusAccepted, gin.H{"success": true, "data": gin.H{
		"status":     "pending_telegram_approval",
		"request_id": pending.ID,
		"expires_at": pending.ExpiresAt,
	}})
}

// GET /owner/budget/withdrawal-requests — recent pending/decided requests.
func (h *Handler) ListWithdrawalRequests(c *gin.Context) {
	rows, err := h.repo.ListWithdrawalRequests(c.Request.Context(), 50)
	if err != nil {
		response.Error(c, apperrors.Internal(err))
		return
	}
	response.OK(c, rows)
}

type transactionUpdateRequest struct {
	Amount float64 `json:"amount" binding:"gte=0"`
	Note   string  `json:"note"`
}

// PATCH /owner/budget/transaction/:id — amount/note only, for top-up or withdrawal rows
func (h *Handler) UpdateTransaction(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid transaction id"))
		return
	}
	var req transactionUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, apperrors.BadRequest(err.Error()))
		return
	}
	claims := middleware.ClaimsFromContext(c)
	if claims == nil {
		response.Error(c, apperrors.Unauthorized("not authenticated"))
		return
	}
	if err := h.repo.UpdateTransaction(c.Request.Context(), id, claims.UserID, req.Amount, req.Note); err != nil {
		if errors.Is(err, ErrTransactionNotFound) {
			response.Error(c, apperrors.NotFound("transaction not found"))
			return
		}
		response.Error(c, apperrors.Internal(err))
		return
	}
	response.OK(c, gin.H{"updated": true})
}

// GET /owner/budget/transaction/:id/history
func (h *Handler) GetTransactionHistory(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.Error(c, apperrors.BadRequest("invalid transaction id"))
		return
	}
	rows, err := h.repo.ListTransactionHistory(c.Request.Context(), id)
	if err != nil {
		response.Error(c, apperrors.Internal(err))
		return
	}
	response.OK(c, rows)
}

// GET /owner/budget/creators
func (h *Handler) ListCreators(c *gin.Context) {
	rows, err := h.repo.ListCreators(c.Request.Context())
	if err != nil {
		response.Error(c, apperrors.Internal(err))
		return
	}
	response.OK(c, rows)
}

// HandleTelegramDecision processes an Approve/Reject button press for a
// withdrawal request. It matches internal/telegram.CallbackHandlerFn's
// signature so it can be injected directly as that package's callback
// (cmd/server/main.go wires it up) without internal/budget importing
// internal/telegram. ok=false + no error means the press was valid but stale
// (already decided) — a benign no-op, not a failure to log/alert on.
func (h *Handler) HandleTelegramDecision(ctx context.Context, requestIDStr, action string, telegramUserID int64) (toast, editedText string, err error) {
	requestID, err := uuid.Parse(requestIDStr)
	if err != nil {
		return "", "", fmt.Errorf("invalid request id %q: %w", requestIDStr, err)
	}

	switch action {
	case "approve":
		newBalance, err := h.repo.ApproveWithdrawalRequest(ctx, requestID, telegramUserID)
		if errors.Is(err, ErrWithdrawalRequestDecided) {
			return "Уже обработано.", "", nil
		}
		if errors.Is(err, ErrWithdrawalRequestNotFound) {
			return "Запрос не найден.", "", nil
		}
		if err != nil {
			return "", "", err
		}
		return "Подтверждено.", fmt.Sprintf("✅ Вывод средств подтверждён.\nНовый баланс: %.2f", newBalance), nil

	case "reject":
		err := h.repo.RejectWithdrawalRequest(ctx, requestID, telegramUserID)
		if errors.Is(err, ErrWithdrawalRequestDecided) {
			return "Уже обработано.", "", nil
		}
		if errors.Is(err, ErrWithdrawalRequestNotFound) {
			return "Запрос не найден.", "", nil
		}
		if err != nil {
			return "", "", err
		}
		return "Отклонено.", "❌ Вывод средств отклонён.", nil

	default:
		return "", "", fmt.Errorf("unknown action %q", action)
	}
}
