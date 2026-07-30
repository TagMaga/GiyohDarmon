package telegram

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/response"
)

// CallbackHandlerFn processes one "budget_wd:<requestID>:<approve|reject>"
// button press from an already-authorized Telegram user (allowlist + chat
// checks happen in Handler before this is called). It returns the text to
// show the tapper as a callback-query toast, and the text the message should
// be edited to afterward. An empty editedText with no error means the press
// was valid but too late (e.g. already decided) — not an error, just a no-op.
type CallbackHandlerFn func(ctx context.Context, requestID, action string, telegramUserID int64) (toast, editedText string, err error)

// Handler is the inbound webhook side: Telegram calls back into this
// application when a button is pressed.
type Handler struct {
	client         *Client
	webhookSecret  string
	allowedUserIDs map[int64]bool
	onCallback     CallbackHandlerFn
}

func NewHandler(client *Client, webhookSecret string, allowedUserIDs []int64, onCallback CallbackHandlerFn) *Handler {
	allowed := make(map[int64]bool, len(allowedUserIDs))
	for _, id := range allowedUserIDs {
		allowed[id] = true
	}
	return &Handler{
		client:         client,
		webhookSecret:  webhookSecret,
		allowedUserIDs: allowed,
		onCallback:     onCallback,
	}
}

func (h *Handler) RegisterRoutes(g *gin.RouterGroup) {
	g.POST("/webhook", h.Webhook)
}

type update struct {
	CallbackQuery *callbackQuery `json:"callback_query"`
}

type callbackQuery struct {
	ID   string `json:"id"`
	From struct {
		ID int64 `json:"id"`
	} `json:"from"`
	Message struct {
		MessageID int64 `json:"message_id"`
		Chat      struct {
			ID int64 `json:"id"`
		} `json:"chat"`
	} `json:"message"`
	Data string `json:"data"`
}

// Webhook receives every Telegram update. Only callback_query updates
// (button presses) are meaningful here; everything else is accepted and
// ignored (Telegram expects a 200 regardless, or it will retry).
func (h *Handler) Webhook(c *gin.Context) {
	if h.webhookSecret == "" || c.GetHeader("X-Telegram-Bot-Api-Secret-Token") != h.webhookSecret {
		response.Error(c, apperrors.Unauthorized("invalid webhook secret"))
		return
	}

	var upd update
	if err := c.ShouldBindJSON(&upd); err != nil {
		// Malformed body from something other than Telegram itself — still
		// 200 so a misbehaving retry doesn't loop forever, just do nothing.
		c.Status(http.StatusOK)
		return
	}
	if upd.CallbackQuery == nil || upd.CallbackQuery.Data == "" {
		c.Status(http.StatusOK)
		return
	}

	cq := upd.CallbackQuery
	requestID, action, ok := parseCallbackData(cq.Data)
	if !ok {
		c.Status(http.StatusOK)
		return
	}

	if !h.allowedUserIDs[cq.From.ID] {
		_ = h.client.AnswerCallbackQuery(c.Request.Context(), cq.ID, "Нет прав на подтверждение/отклонение.")
		c.Status(http.StatusOK)
		return
	}

	toast, editedText, err := h.onCallback(c, requestID, action, cq.From.ID)
	if err != nil {
		_ = h.client.AnswerCallbackQuery(c.Request.Context(), cq.ID, "Ошибка при обработке запроса.")
		c.Status(http.StatusOK)
		return
	}
	_ = h.client.AnswerCallbackQuery(c.Request.Context(), cq.ID, toast)
	if editedText != "" {
		_ = h.client.EditMessageText(c.Request.Context(), cq.Message.Chat.ID, cq.Message.MessageID, editedText)
	}
	c.Status(http.StatusOK)
}

// parseCallbackData splits "budget_wd:<uuid>:<approve|reject>" into its parts.
func parseCallbackData(data string) (requestID, action string, ok bool) {
	parts := strings.Split(data, ":")
	if len(parts) != 3 || parts[0] != "budget_wd" {
		return "", "", false
	}
	if parts[2] != "approve" && parts[2] != "reject" {
		return "", "", false
	}
	return parts[1], parts[2], true
}

// ParseUserID is exposed for callers that need to validate a raw Telegram
// user ID string (e.g. an admin CLI), matching the same parsing config.go
// uses for TELEGRAM_ALLOWED_USER_IDS.
func ParseUserID(s string) (int64, error) {
	return strconv.ParseInt(strings.TrimSpace(s), 10, 64)
}
