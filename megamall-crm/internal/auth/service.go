package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"golang.org/x/crypto/bcrypt"
)

// Claims is the JWT payload. Minimal by design — only what middleware needs.
type Claims struct {
	UserID uuid.UUID  `json:"user_id"`
	Role   string     `json:"role"`
	TeamID *uuid.UUID `json:"team_id,omitempty"`
	jwt.RegisteredClaims
}

// UserByPhoneFn looks up a user by phone number.
type UserByPhoneFn func(ctx context.Context, phone string) (*users.User, error)

// TeamForUserFn resolves the team_id from a user's hierarchy entry.
type TeamForUserFn func(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error)

// RoleResolverFn resolves the role for a user ID — used during token refresh.
type RoleResolverFn func(ctx context.Context, userID uuid.UUID) (users.Role, error)

// Service handles authentication: login, token issuance, refresh, logout.
type Service struct {
	repo         *Repository
	cfg          config.JWTConfig
	userByPhone  UserByPhoneFn
	teamForUser  TeamForUserFn
	roleResolver RoleResolverFn // injected after construction to avoid circular dep
}

func NewService(
	repo *Repository,
	cfg config.JWTConfig,
	userByPhone UserByPhoneFn,
	teamForUser TeamForUserFn,
) *Service {
	return &Service{
		repo:        repo,
		cfg:         cfg,
		userByPhone: userByPhone,
		teamForUser: teamForUser,
	}
}

// SetRoleResolver injects the user role lookup used during token refresh.
// Called from main.go after all services are constructed.
func (s *Service) SetRoleResolver(fn RoleResolverFn) {
	s.roleResolver = fn
}

// Login validates credentials and issues a token pair.
func (s *Service) Login(ctx context.Context, req LoginRequest, ip, userAgent string) (*TokenPairResponse, error) {
	u, err := s.userByPhone(ctx, req.Phone)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.Unauthorized("invalid phone or password")
	}
	if !u.IsActive {
		return nil, &apperrors.AppError{
			Code:       apperrors.CodeUserInactive,
			StatusCode: 401,
			Message:    "account is inactive",
		}
	}

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)); err != nil {
		return nil, apperrors.Unauthorized("invalid phone or password")
	}

	teamID, err := s.teamForUser(ctx, u.ID)
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("resolve team: %w", err))
	}

	familyID := uuid.New()
	return s.issueTokenPair(ctx, u.ID, u.Role, teamID, familyID, ip, userAgent)
}

// Refresh rotates a refresh token and issues a new pair.
// Token family reuse detection: if the presented token is already revoked,
// the entire family is revoked to protect against token theft.
func (s *Service) Refresh(ctx context.Context, rawToken, ip, userAgent string) (*TokenPairResponse, error) {
	hash := hashToken(rawToken)

	existing, err := s.repo.GetByHash(ctx, hash)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if existing == nil {
		return nil, &apperrors.AppError{
			Code:       apperrors.CodeInvalidToken,
			StatusCode: 401,
			Message:    "refresh token not found",
		}
	}

	// Reuse detection: token was already revoked — revoke entire family.
	if existing.RevokedAt != nil {
		_ = s.repo.RevokeFamily(ctx, existing.FamilyID)
		return nil, &apperrors.AppError{
			Code:       apperrors.CodeTokenReused,
			StatusCode: 401,
			Message:    "refresh token already used — all sessions revoked",
		}
	}

	if time.Now().UTC().After(existing.ExpiresAt) {
		return nil, &apperrors.AppError{
			Code:       apperrors.CodeTokenExpired,
			StatusCode: 401,
			Message:    "refresh token expired",
		}
	}

	// Revoke the consumed token before issuing a replacement.
	if err := s.repo.RevokeToken(ctx, existing.ID); err != nil {
		return nil, apperrors.Internal(err)
	}

	// Resolve current role and team (may have changed since last login).
	if s.roleResolver == nil {
		return nil, apperrors.Internal(fmt.Errorf("role resolver not configured"))
	}
	role, err := s.roleResolver(ctx, existing.UserID)
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("resolve role: %w", err))
	}

	teamID, err := s.teamForUser(ctx, existing.UserID)
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("resolve team: %w", err))
	}

	// Continue the same token family (rotation, not new session).
	return s.issueTokenPair(ctx, existing.UserID, role, teamID, existing.FamilyID, ip, userAgent)
}

// Logout revokes all active refresh tokens for the user (all devices).
func (s *Service) Logout(ctx context.Context, userID uuid.UUID) error {
	if err := s.repo.RevokeAllForUser(ctx, userID); err != nil {
		return apperrors.Internal(err)
	}
	return nil
}

// ValidateAccessToken parses and validates a signed JWT access token.
func (s *Service) ValidateAccessToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(s.cfg.AccessSecret), nil
	})
	if err != nil {
		if strings.Contains(err.Error(), "token is expired") || strings.Contains(err.Error(), "expired") {
			return nil, &apperrors.AppError{
				Code:       apperrors.CodeTokenExpired,
				StatusCode: 401,
				Message:    "access token expired",
			}
		}
		return nil, &apperrors.AppError{
			Code:       apperrors.CodeInvalidToken,
			StatusCode: 401,
			Message:    "invalid access token",
		}
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, &apperrors.AppError{
			Code:       apperrors.CodeInvalidToken,
			StatusCode: 401,
			Message:    "malformed token claims",
		}
	}
	return claims, nil
}

// issueTokenPair creates and persists a new access + refresh token pair.
func (s *Service) issueTokenPair(
	ctx context.Context,
	userID uuid.UUID,
	role users.Role,
	teamID *uuid.UUID,
	familyID uuid.UUID,
	ip, userAgent string,
) (*TokenPairResponse, error) {
	now := time.Now().UTC()
	accessExp := now.Add(s.cfg.AccessTokenTTL)

	claims := Claims{
		UserID: userID,
		Role:   string(role),
		TeamID: teamID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(accessExp),
		},
	}

	accessToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).
		SignedString([]byte(s.cfg.AccessSecret))
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("sign access token: %w", err))
	}

	rawRefresh, err := generateSecureToken()
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("generate refresh token: %w", err))
	}

	ipCopy := ip
	uaCopy := userAgent
	refreshRecord := &RefreshToken{
		ID:         uuid.New(),
		UserID:     userID,
		TokenHash:  hashToken(rawRefresh),
		FamilyID:   familyID,
		DeviceInfo: &uaCopy,
		IPAddress:  &ipCopy,
		ExpiresAt:  now.Add(s.cfg.RefreshTokenTTL),
	}

	if err := s.repo.Save(ctx, refreshRecord); err != nil {
		return nil, apperrors.Internal(fmt.Errorf("save refresh token: %w", err))
	}

	return &TokenPairResponse{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		TokenType:    "Bearer",
		ExpiresIn:    int(s.cfg.AccessTokenTTL.Seconds()),
	}, nil
}

// hashToken returns the hex-encoded SHA-256 of the raw token.
func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// generateSecureToken returns a 32-byte cryptographically random hex string.
func generateSecureToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
