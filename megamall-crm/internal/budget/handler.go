package budget

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
	"github.com/megamall/crm/pkg/pagination"
	"github.com/megamall/crm/pkg/response"
)

type Handler struct {
	repo *Repository
}

func NewHandler(repo *Repository) *Handler { return &Handler{repo: repo} }

// GET /owner/budget/summary?from=&to=
func (h *Handler) GetSummary(c *gin.Context) {
	var from, to *time.Time
	if f := c.Query("from"); f != "" {
		t, err := time.Parse("2006-01-02", f)
		if err != nil {
			response.Error(c, apperrors.BadRequest("invalid from date"))
			return
		}
		from = &t
	}
	if t := c.Query("to"); t != "" {
		parsed, err := time.Parse("2006-01-02", t)
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
		t, err := time.Parse("2006-01-02", f)
		if err != nil {
			response.Error(c, apperrors.BadRequest("invalid from date"))
			return
		}
		p.From = &t
	}
	if to := c.Query("to"); to != "" {
		t, err := time.Parse("2006-01-02", to)
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
	Amount float64 `json:"amount" binding:"required,gt=0"`
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
	Amount float64 `json:"amount" binding:"required,gt=0"`
	Note   string  `json:"note"`
}

// POST /owner/budget/withdrawal — owner withdrawal
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
}

type transactionUpdateRequest struct {
	Amount float64 `json:"amount" binding:"required,gt=0"`
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
