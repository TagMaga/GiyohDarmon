package users

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12
const documentStatusUploaded = "uploaded"
const documentStatusVerified = "verified"
const documentStatusRejected = "rejected"

// SessionRevokerFn revokes all active sessions (refresh tokens) for a user.
// Injected after construction (avoids a circular import on internal/auth) and
// called whenever a user is deactivated or deleted, so their existing tokens
// stop working immediately instead of remaining valid until they expire.
type SessionRevokerFn func(ctx context.Context, userID uuid.UUID) error

// Service encapsulates all user business logic.
type Service struct {
	repo           *Repository
	sessionRevoker SessionRevokerFn
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// SetSessionRevoker injects the session-revocation hook. Called from main.go
// after all services are constructed.
func (s *Service) SetSessionRevoker(fn SessionRevokerFn) {
	s.sessionRevoker = fn
}

func (s *Service) Create(ctx context.Context, req CreateUserRequest) (*User, error) {
	if !req.Role.IsValid() {
		return nil, apperrors.BadRequest(fmt.Sprintf("invalid role: %s", req.Role))
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		return nil, apperrors.Internal(fmt.Errorf("hash password: %w", err))
	}

	u := &User{
		ID:           uuid.New(),
		Phone:        req.Phone,
		Email:        req.Email,
		PasswordHash: string(hash),
		FullName:     req.FullName,
		Role:         req.Role,
		IsActive:     true,
		Status:       StatusOffline,
		HireDate:     req.HireDate,
		DateOfBirth:  req.DateOfBirth,
		Address:      req.Address,
	}

	if err := s.repo.Create(ctx, u); err != nil {
		if strings.Contains(err.Error(), "phone already registered") {
			return nil, apperrors.Conflict("phone number is already registered")
		}
		if strings.Contains(err.Error(), "email already registered") {
			return nil, apperrors.Conflict("email address is already registered")
		}
		return nil, apperrors.Internal(err)
	}

	return u, nil
}

func (s *Service) GetByID(ctx context.Context, id uuid.UUID) (*User, error) {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}
	return u, nil
}

func (s *Service) CanViewUser(ctx context.Context, actorID uuid.UUID, actorRole string, targetID uuid.UUID) (bool, error) {
	if actorID == targetID || actorRole == string(RoleOwner) {
		return true, nil
	}

	if actorRole != string(RoleManager) && actorRole != string(RoleSalesTeamLead) {
		return false, nil
	}

	ok, err := s.repo.ShareTeam(ctx, actorID, targetID)
	if err != nil {
		return false, apperrors.Internal(err)
	}
	return ok, nil
}

// List returns users matching filter. Non-owner callers (manager, sales_team_lead)
// are scoped to their own hierarchy team — they can never list users outside it.
func (s *Service) List(ctx context.Context, actorID uuid.UUID, actorRole string, filter ListUsersFilter, p pagination.Params) ([]User, int, error) {
	if actorRole != string(RoleOwner) {
		teamID, err := s.repo.GetTeamIDForUser(ctx, actorID)
		if err != nil {
			return nil, 0, apperrors.Internal(err)
		}
		if teamID == nil {
			return []User{}, 0, nil
		}
		filter.TeamID = teamID
	}

	list, total, err := s.repo.List(ctx, filter, p)
	if err != nil {
		return nil, 0, apperrors.Internal(err)
	}
	return list, total, nil
}

func (s *Service) Update(ctx context.Context, id uuid.UUID, req UpdateUserRequest, actorIDs ...uuid.UUID) (*User, error) {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}

	before := *u
	if req.Phone != nil {
		u.Phone = *req.Phone
	}
	if req.FullName != nil {
		u.FullName = *req.FullName
	}
	if req.Role != nil {
		if !req.Role.IsValid() {
			return nil, apperrors.BadRequest(fmt.Sprintf("invalid role: %s", *req.Role))
		}
		u.Role = *req.Role
	}
	if req.IsActive != nil {
		u.IsActive = *req.IsActive
	}
	if req.AvatarURL != nil {
		u.AvatarURL = req.AvatarURL
	}
	if req.Status != nil {
		if !req.Status.IsValid() {
			return nil, apperrors.BadRequest(fmt.Sprintf("invalid status: %s", *req.Status))
		}
		u.Status = *req.Status
	}
	if req.HireDate != nil {
		u.HireDate = req.HireDate
	}
	if req.DateOfBirth != nil {
		u.DateOfBirth = req.DateOfBirth
	}
	if req.Address != nil {
		u.Address = req.Address
	}
	if req.NewPassword != nil && *req.NewPassword != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.NewPassword), bcryptCost)
		if err != nil {
			return nil, apperrors.Internal(fmt.Errorf("hash password: %w", err))
		}
		u.PasswordHash = string(hash)
	}
	u.UpdatedAt = time.Now().UTC()

	if err := s.repo.Update(ctx, u); err != nil {
		if strings.Contains(err.Error(), "phone already registered") {
			return nil, apperrors.Conflict("phone number is already registered")
		}
		if strings.Contains(err.Error(), "email already registered") {
			return nil, apperrors.Conflict("email address is already registered")
		}
		return nil, apperrors.Internal(err)
	}

	if err := s.recordProfileHistory(ctx, &before, u, req, actorIDs...); err != nil {
		return nil, err
	}

	// Deactivation must revoke existing sessions immediately — otherwise a
	// deactivated user's already-issued tokens keep working. It must also
	// clear this user as anyone else's hierarchy parent, so they stop
	// appearing as a manager in someone's upward chain while deactivated.
	if before.IsActive && !u.IsActive {
		if s.sessionRevoker != nil {
			if err := s.sessionRevoker(ctx, u.ID); err != nil {
				return nil, apperrors.Internal(fmt.Errorf("revoke sessions: %w", err))
			}
		}
		if err := s.repo.ClearAsHierarchyParent(ctx, u.ID); err != nil {
			return nil, apperrors.Internal(err)
		}
	}

	return u, nil
}

func (s *Service) recordProfileHistory(ctx context.Context, before *User, after *User, req UpdateUserRequest, actorIDs ...uuid.UUID) error {
	var changedBy *uuid.UUID
	if len(actorIDs) > 0 {
		changedBy = &actorIDs[0]
	}
	changes := make([]UserHistory, 0, 8)
	add := func(field string, oldValue *string, newValue *string) {
		if stringPtrValue(oldValue) == stringPtrValue(newValue) {
			return
		}
		changes = append(changes, UserHistory{
			ID:        uuid.New(),
			UserID:    after.ID,
			FieldName: field,
			OldValue:  oldValue,
			NewValue:  newValue,
			ChangedBy: changedBy,
		})
	}

	if req.FullName != nil {
		add("full_name", stringPtr(before.FullName), stringPtr(after.FullName))
	}
	if req.Phone != nil {
		add("phone", stringPtr(before.Phone), stringPtr(after.Phone))
	}
	if req.Role != nil {
		add("role", stringPtr(string(before.Role)), stringPtr(string(after.Role)))
	}
	if req.IsActive != nil {
		add("is_active", stringPtr(fmt.Sprintf("%t", before.IsActive)), stringPtr(fmt.Sprintf("%t", after.IsActive)))
	}
	if req.AvatarURL != nil {
		add("avatar_url", before.AvatarURL, after.AvatarURL)
	}
	if req.Status != nil {
		add("status", stringPtr(string(before.Status)), stringPtr(string(after.Status)))
	}
	if req.HireDate != nil {
		add("hire_date", datePtrValue(before.HireDate), datePtrValue(after.HireDate))
	}
	if req.DateOfBirth != nil {
		add("date_of_birth", datePtrValue(before.DateOfBirth), datePtrValue(after.DateOfBirth))
	}
	if req.Address != nil {
		add("address", before.Address, after.Address)
	}
	// Password resets are never diffed by value — only that a reset happened
	// and who did it. before/after here are both password hashes, which must
	// never appear in the audit trail even hashed.
	if req.NewPassword != nil && *req.NewPassword != "" {
		changes = append(changes, UserHistory{
			ID:        uuid.New(),
			UserID:    after.ID,
			FieldName: "password_reset",
			ChangedBy: changedBy,
		})
	}

	for i := range changes {
		if err := s.repo.CreateHistory(ctx, &changes[i]); err != nil {
			return apperrors.Internal(err)
		}
	}
	return nil
}

func stringPtr(value string) *string {
	v := value
	return &v
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func datePtrValue(value *time.Time) *string {
	if value == nil {
		return nil
	}
	return stringPtr(value.Format("2006-01-02"))
}

func normalizedDocumentType(value *string) string {
	if value == nil {
		return "other"
	}
	switch strings.TrimSpace(*value) {
	case "passport", "contract", "certificate", "diploma", "medical", "other":
		return strings.TrimSpace(*value)
	default:
		return "other"
	}
}

// PatchMe updates only the fields a user is allowed to edit for themselves.
func (s *Service) PatchMe(ctx context.Context, id uuid.UUID, req PatchMeRequest) (*User, error) {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}
	if req.FullName != nil {
		fullName := strings.TrimSpace(*req.FullName)
		if fullName == "" {
			return nil, apperrors.BadRequest("full_name is required")
		}
		u.FullName = fullName
	}
	if req.DateOfBirth != nil {
		u.DateOfBirth = req.DateOfBirth
	}
	if req.TelegramChatID != nil {
		u.TelegramChatID = req.TelegramChatID
	}
	u.UpdatedAt = time.Now().UTC()
	if err := s.repo.Update(ctx, u); err != nil {
		return nil, apperrors.Internal(err)
	}
	return u, nil
}

func (s *Service) ChangePassword(ctx context.Context, id uuid.UUID, req ChangePasswordRequest) error {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return apperrors.Internal(err)
	}
	if u == nil {
		return apperrors.NotFound("user")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		return &apperrors.AppError{
			Code:       apperrors.CodeInvalidPassword,
			StatusCode: 400,
			Message:    "current password is incorrect",
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcryptCost)
	if err != nil {
		return apperrors.Internal(fmt.Errorf("hash password: %w", err))
	}

	if err := s.repo.UpdatePassword(ctx, id, string(hash)); err != nil {
		return apperrors.Internal(err)
	}

	return nil
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		if err.Error() == "user not found" {
			return apperrors.NotFound("user")
		}
		return apperrors.Internal(err)
	}
	if s.sessionRevoker != nil {
		if err := s.sessionRevoker(ctx, id); err != nil {
			return apperrors.Internal(fmt.Errorf("revoke sessions: %w", err))
		}
	}
	if err := s.repo.ClearAsHierarchyParent(ctx, id); err != nil {
		return apperrors.Internal(err)
	}
	return nil
}

func (s *Service) ListDocuments(ctx context.Context, userID uuid.UUID) ([]UserDocument, error) {
	u, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}
	if u.Role == RoleOwner {
		return []UserDocument{}, nil
	}
	docs, err := s.repo.ListDocuments(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return docs, nil
}

func (s *Service) CreateDocument(ctx context.Context, userID uuid.UUID, uploadedBy uuid.UUID, req CreateUserDocumentRequest) (*UserDocument, error) {
	u, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}
	if u.Role == RoleOwner {
		return nil, apperrors.BadRequest("owner documents are not supported")
	}
	fileURL := strings.TrimSpace(req.FileURL)
	filename := strings.TrimSpace(req.OriginalFilename)
	if fileURL == "" || filename == "" {
		return nil, apperrors.BadRequest("file_url and original_filename are required")
	}
	doc := &UserDocument{
		ID:                 uuid.New(),
		UserID:             userID,
		FileURL:            fileURL,
		OriginalFilename:   filename,
		ContentType:        req.ContentType,
		SizeBytes:          req.SizeBytes,
		DocumentType:       normalizedDocumentType(req.DocumentType),
		ExpiresAt:          req.ExpiresAt,
		VerificationStatus: documentStatusUploaded,
		UploadedBy:         &uploadedBy,
	}
	if err := s.repo.CreateDocument(ctx, doc); err != nil {
		return nil, apperrors.Internal(err)
	}
	if err := s.createHistory(ctx, userID, "document_uploaded", nil, stringPtr(doc.OriginalFilename), &uploadedBy); err != nil {
		return nil, err
	}
	return doc, nil
}

func (s *Service) UpdateDocumentStatus(ctx context.Context, userID uuid.UUID, documentID uuid.UUID, actorID uuid.UUID, req UpdateUserDocumentStatusRequest) (*UserDocument, error) {
	nextStatus := strings.TrimSpace(req.VerificationStatus)
	if nextStatus != documentStatusUploaded && nextStatus != documentStatusVerified && nextStatus != documentStatusRejected {
		return nil, apperrors.BadRequest("invalid document status")
	}
	current, err := s.repo.GetDocument(ctx, userID, documentID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if current == nil {
		return nil, apperrors.NotFound("user document")
	}
	if current.VerificationStatus == nextStatus {
		return current, nil
	}
	updated, err := s.repo.UpdateDocumentStatus(ctx, userID, documentID, nextStatus)
	if err != nil {
		if err.Error() == "user document not found" {
			return nil, apperrors.NotFound("user document")
		}
		return nil, apperrors.Internal(err)
	}
	field := "document_status"
	if nextStatus == documentStatusVerified {
		field = "document_verified"
	}
	if nextStatus == documentStatusRejected {
		field = "document_rejected"
	}
	if err := s.createHistory(ctx, userID, field, stringPtr(current.VerificationStatus), stringPtr(updated.OriginalFilename), &actorID); err != nil {
		return nil, err
	}
	return updated, nil
}

func (s *Service) DeleteDocument(ctx context.Context, userID uuid.UUID, documentID uuid.UUID, actorIDs ...uuid.UUID) error {
	doc, err := s.repo.GetDocument(ctx, userID, documentID)
	if err != nil {
		return apperrors.Internal(err)
	}
	if err := s.repo.DeleteDocument(ctx, userID, documentID); err != nil {
		if err.Error() == "user document not found" {
			return apperrors.NotFound("user document")
		}
		return apperrors.Internal(err)
	}
	if doc != nil {
		var changedBy *uuid.UUID
		if len(actorIDs) > 0 {
			changedBy = &actorIDs[0]
		}
		if err := s.createHistory(ctx, userID, "document_deleted", stringPtr(doc.OriginalFilename), nil, changedBy); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) ListHistory(ctx context.Context, userID uuid.UUID) ([]UserHistory, error) {
	u, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	if u == nil {
		return nil, apperrors.NotFound("user")
	}
	history, err := s.repo.ListHistory(ctx, userID)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return history, nil
}

func (s *Service) ListAllHistory(ctx context.Context) ([]UserHistory, error) {
	history, err := s.repo.ListAllHistory(ctx)
	if err != nil {
		return nil, apperrors.Internal(err)
	}
	return history, nil
}

func (s *Service) createHistory(ctx context.Context, userID uuid.UUID, field string, oldValue *string, newValue *string, changedBy *uuid.UUID) error {
	if err := s.repo.CreateHistory(ctx, &UserHistory{
		ID:        uuid.New(),
		UserID:    userID,
		FieldName: field,
		OldValue:  oldValue,
		NewValue:  newValue,
		ChangedBy: changedBy,
	}); err != nil {
		return apperrors.Internal(err)
	}
	return nil
}
