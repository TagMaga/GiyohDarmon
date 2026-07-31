package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const expoPushSendURL = "https://exp.host/--/api/v2/push/send"

// ExpoClient is a thin wrapper over Expo's push notification HTTP API —
// narrow and single-purpose, same shape as internal/telegram.Client.
type ExpoClient struct {
	http *http.Client
}

func NewExpoClient() *ExpoClient {
	return &ExpoClient{http: &http.Client{Timeout: 10 * time.Second}}
}

type expoMessage struct {
	To    string         `json:"to"`
	Title string         `json:"title"`
	Body  string         `json:"body"`
	Data  map[string]any `json:"data,omitempty"`
}

type expoTicket struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
	Details struct {
		Error string `json:"error,omitempty"`
	} `json:"details,omitempty"`
}

// Send pushes a single title/body notification to a single Expo push token.
// deviceNotRegistered reports true when Expo says the token is no longer
// valid (app uninstalled, device reset) — the caller should delete it.
func (c *ExpoClient) Send(ctx context.Context, token, title, body string, data map[string]any) (deviceNotRegistered bool, err error) {
	if !strings.HasPrefix(token, "ExponentPushToken") {
		// Defensive: never call Expo with something that isn't an Expo token.
		return false, nil
	}

	payload, err := json.Marshal([]expoMessage{{To: token, Title: title, Body: body, Data: data}})
	if err != nil {
		return false, fmt.Errorf("marshal expo push payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, expoPushSendURL, bytes.NewReader(payload))
	if err != nil {
		return false, fmt.Errorf("build expo push request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return false, fmt.Errorf("call expo push: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, fmt.Errorf("read expo push response: %w", err)
	}

	var out struct {
		Data []expoTicket `json:"data"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return false, fmt.Errorf("decode expo push response: %w", err)
	}
	if len(out.Data) == 0 {
		return false, fmt.Errorf("expo push: empty ticket list")
	}

	ticket := out.Data[0]
	if ticket.Status == "error" {
		if ticket.Details.Error == "DeviceNotRegistered" {
			return true, nil
		}
		return false, fmt.Errorf("expo push error: %s", ticket.Message)
	}
	return false, nil
}
