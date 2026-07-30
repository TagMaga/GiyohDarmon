// Package telegram is a thin wrapper over the parts of Telegram's Bot API
// needed for the owner budget-withdrawal approval gate: sending a message
// with an inline Approve/Reject keyboard, editing it once decided, and
// acknowledging button presses. It is deliberately narrow — not a general
// notification system.
package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	botToken string
	http     *http.Client
}

func NewClient(botToken string) *Client {
	return &Client{
		botToken: botToken,
		http:     &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *Client) apiURL(method string) string {
	return fmt.Sprintf("https://api.telegram.org/bot%s/%s", c.botToken, method)
}

func (c *Client) call(ctx context.Context, method string, payload any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal %s payload: %w", method, err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL(method), bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build %s request: %w", method, err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("call %s: %w", method, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read %s response: %w", method, err)
	}

	var apiResp struct {
		OK          bool            `json:"ok"`
		Description string          `json:"description"`
		Result      json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		return fmt.Errorf("decode %s response: %w", method, err)
	}
	if !apiResp.OK {
		return fmt.Errorf("telegram %s failed: %s", method, apiResp.Description)
	}
	if out != nil && len(apiResp.Result) > 0 {
		if err := json.Unmarshal(apiResp.Result, out); err != nil {
			return fmt.Errorf("decode %s result: %w", method, err)
		}
	}
	return nil
}

type inlineKeyboardButton struct {
	Text         string `json:"text"`
	CallbackData string `json:"callback_data"`
}

type inlineKeyboardMarkup struct {
	InlineKeyboard [][]inlineKeyboardButton `json:"inline_keyboard"`
}

// ApprovalButtons builds the standard two-button Approve/Reject keyboard for
// a pending request, encoding the request ID and action into callback_data
// (max 64 bytes per Telegram's limit — a UUID + short prefix comfortably fits).
func ApprovalButtons(requestID string) inlineKeyboardMarkup {
	return inlineKeyboardMarkup{
		InlineKeyboard: [][]inlineKeyboardButton{
			{
				{Text: "✅ Подтвердить", CallbackData: "budget_wd:" + requestID + ":approve"},
				{Text: "❌ Отклонить", CallbackData: "budget_wd:" + requestID + ":reject"},
			},
		},
	}
}

type sendMessageResult struct {
	MessageID int64 `json:"message_id"`
}

// SendMessage sends text with the given inline keyboard to chatID and returns
// the resulting Telegram message ID (needed later to edit it in place).
func (c *Client) SendMessage(ctx context.Context, chatID int64, text string, keyboard inlineKeyboardMarkup) (int64, error) {
	payload := map[string]any{
		"chat_id":      chatID,
		"text":         text,
		"parse_mode":   "HTML",
		"reply_markup": keyboard,
	}
	var result sendMessageResult
	if err := c.call(ctx, "sendMessage", payload, &result); err != nil {
		return 0, err
	}
	return result.MessageID, nil
}

// EditMessageText replaces the text of a previously-sent message and removes
// its keyboard (used once a request has been approved/rejected/expired, so
// the buttons can't be pressed again).
func (c *Client) EditMessageText(ctx context.Context, chatID, messageID int64, text string) error {
	payload := map[string]any{
		"chat_id":    chatID,
		"message_id": messageID,
		"text":       text,
		"parse_mode": "HTML",
	}
	return c.call(ctx, "editMessageText", payload, nil)
}

// AnswerCallbackQuery acknowledges a button press so Telegram stops showing
// the client-side loading spinner on the tapped button. text (optional) shows
// as a small toast to the user who tapped it.
func (c *Client) AnswerCallbackQuery(ctx context.Context, callbackQueryID, text string) error {
	payload := map[string]any{
		"callback_query_id": callbackQueryID,
		"text":              text,
	}
	return c.call(ctx, "answerCallbackQuery", payload, nil)
}

// SetWebhook registers url with Telegram as this bot's webhook endpoint,
// authenticated by secretToken (echoed back in every webhook call's
// X-Telegram-Bot-Api-Secret-Token header). Intended to be run once from an
// operator tool/script, not on every server start.
func (c *Client) SetWebhook(ctx context.Context, url, secretToken string) error {
	payload := map[string]any{
		"url":          url,
		"secret_token": secretToken,
	}
	return c.call(ctx, "setWebhook", payload, nil)
}
