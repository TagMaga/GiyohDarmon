package notifications

import (
	"time"

	"github.com/google/uuid"
)

type NotificationResponse struct {
	ID        uuid.UUID  `json:"id"`
	Type      Type       `json:"type"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	OrderID   *uuid.UUID `json:"order_id,omitempty"`
	Read      bool       `json:"read"`
	CreatedAt time.Time  `json:"created_at"`
}

func ToResponse(n *Notification) NotificationResponse {
	return NotificationResponse{
		ID:        n.ID,
		Type:      n.Type,
		Title:     n.Title,
		Body:      n.Body,
		OrderID:   n.OrderID,
		Read:      n.ReadAt != nil,
		CreatedAt: n.CreatedAt,
	}
}

type UnreadCountResponse struct {
	Count int `json:"count"`
}
