package notifications

import (
	"context"
	"log"

	"github.com/google/uuid"
	"github.com/megamall/crm/pkg/pagination"
)

// PushTokenLookupFn returns the recipient's registered Expo push token, or
// "" if they have none. Injected from internal/courier (courier_push_tokens'
// natural home) to avoid notifications depending on the whole courier module
// for one lookup — same narrow-function pattern as dispatch.ReserveForCourierFn.
type PushTokenLookupFn func(ctx context.Context, userID uuid.UUID) (string, error)

// DeletePushTokenFn removes a stale token once Expo reports it unregistered.
type DeletePushTokenFn func(ctx context.Context, userID uuid.UUID) error

type Service struct {
	repo        *Repository
	push        *ExpoClient
	lookupToken PushTokenLookupFn
	deleteToken DeletePushTokenFn
}

func NewService(repo *Repository, push *ExpoClient, lookupToken PushTokenLookupFn, deleteToken DeletePushTokenFn) *Service {
	return &Service{repo: repo, push: push, lookupToken: lookupToken, deleteToken: deleteToken}
}

// Notify persists a notification for userID and best-effort pushes it to any
// registered device. Push delivery never blocks or fails the caller — it
// runs in the background and only logs on error, mirroring how
// activity.Logger.LogAsync never blocks the request that triggered it.
func (s *Service) Notify(ctx context.Context, userID uuid.UUID, typ Type, title, body string, orderID *uuid.UUID) error {
	n := &Notification{
		ID:      uuid.New(),
		UserID:  userID,
		Type:    typ,
		Title:   title,
		Body:    body,
		OrderID: orderID,
	}
	if err := s.repo.Create(ctx, n); err != nil {
		return err
	}
	go s.pushAsync(userID, title, body, orderID)
	return nil
}

func (s *Service) pushAsync(userID uuid.UUID, title, body string, orderID *uuid.UUID) {
	ctx := context.Background()
	token, err := s.lookupToken(ctx, userID)
	if err != nil {
		log.Printf("[notifications] push token lookup failed for user %s: %v", userID, err)
		return
	}
	if token == "" {
		return
	}

	var data map[string]any
	if orderID != nil {
		data = map[string]any{"order_id": orderID.String()}
	}

	notRegistered, err := s.push.Send(ctx, token, title, body, data)
	if err != nil {
		log.Printf("[notifications] push send failed for user %s: %v", userID, err)
		return
	}
	if notRegistered {
		if err := s.deleteToken(ctx, userID); err != nil {
			log.Printf("[notifications] delete stale push token failed for user %s: %v", userID, err)
		}
	}
}

func (s *Service) ListForUser(ctx context.Context, userID uuid.UUID, p pagination.Params) ([]Notification, int, error) {
	return s.repo.ListForUser(ctx, userID, p)
}

func (s *Service) UnreadCount(ctx context.Context, userID uuid.UUID) (int, error) {
	return s.repo.UnreadCount(ctx, userID)
}

func (s *Service) MarkRead(ctx context.Context, userID, id uuid.UUID) error {
	return s.repo.MarkRead(ctx, userID, id)
}

func (s *Service) MarkAllRead(ctx context.Context, userID uuid.UUID) error {
	return s.repo.MarkAllRead(ctx, userID)
}
