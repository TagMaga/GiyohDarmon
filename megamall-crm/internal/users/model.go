package users

import (
	"time"

	"github.com/google/uuid"
)

// Status constants matching the PostgreSQL user_status ENUM (migration 00055).
type Status string

const (
	StatusOnline     Status = "online"
	StatusAway       Status = "away"
	StatusOffline    Status = "offline"
	StatusVacation   Status = "vacation"
	StatusSick       Status = "sick"
	StatusTerminated Status = "terminated"
)

var AllStatuses = []Status{
	StatusOnline, StatusAway, StatusOffline, StatusVacation, StatusSick, StatusTerminated,
}

func (s Status) IsValid() bool {
	for _, v := range AllStatuses {
		if s == v {
			return true
		}
	}
	return false
}

// Role constants matching the PostgreSQL user_role ENUM.
type Role string

const (
	RoleOwner            Role = "owner"
	RoleSalesTeamLead    Role = "sales_team_lead"
	RoleManager          Role = "manager"
	RoleSeller           Role = "seller"
	RoleDispatcher       Role = "dispatcher"
	RoleWarehouseManager Role = "warehouse_manager"
	RoleCourier          Role = "courier"
	RoleITSpecialist     Role = "it_specialist"
)

// AllRoles lists all valid roles for validation.
var AllRoles = []Role{
	RoleOwner, RoleSalesTeamLead, RoleManager, RoleSeller,
	RoleDispatcher, RoleWarehouseManager, RoleCourier, RoleITSpecialist,
}

// IsValid returns true if the role is a known role.
func (r Role) IsValid() bool {
	for _, v := range AllRoles {
		if r == v {
			return true
		}
	}
	return false
}

// User is the domain model. Maps to the users table.
type User struct {
	ID             uuid.UUID `gorm:"type:uuid;primaryKey"`
	Phone          string    `gorm:"uniqueIndex;not null"`
	Email          *string   `gorm:"uniqueIndex"`
	PasswordHash   string    `gorm:"not null"`
	FullName       string    `gorm:"not null"`
	Surname        *string   `gorm:"column:surname"`
	TelegramChatID *string   `gorm:"column:telegram_chat_id"`
	Role           Role      `gorm:"type:user_role;not null"`
	IsActive       bool      `gorm:"default:true;not null"`
	AvatarURL      *string
	// AvatarMediaAssetID is non-nil once the avatar was uploaded through
	// internal/media (category avatar, private visibility) rather than the
	// legacy POST /users/me|:id/avatar path — see migration 00077. When
	// set, AvatarURL in API responses is replaced with a freshly-minted
	// signed URL at serialization time (see ToResponse/mediabridge's
	// SignedURLFn) — never a persisted one, since signed URLs expire after
	// MediaConfig.SignedURLTTL. AvatarWidth/AvatarHeight are dimensions,
	// not URLs, so they're safe to denormalize permanently.
	AvatarMediaAssetID          *uuid.UUID `gorm:"column:avatar_media_asset_id;type:uuid"`
	AvatarWidth                 *int       `gorm:"column:avatar_width"`
	AvatarHeight                *int       `gorm:"column:avatar_height"`
	Status                      Status     `gorm:"type:user_status;not null;default:'offline'"`
	HireDate                    *time.Time `gorm:"column:hire_date;type:date"`
	DateOfBirth                 *time.Time `gorm:"column:date_of_birth;type:date"`
	Address                     *string    `gorm:"column:address"`
	CourierOrderIntakeEnabled   bool       `gorm:"default:true;not null"`
	CourierOrderIntakeReason    *string
	CourierOrderIntakeUpdatedAt *time.Time
	CourierOrderIntakeUpdatedBy *uuid.UUID
	CreatedAt                   time.Time  `gorm:"autoCreateTime"`
	UpdatedAt                   time.Time  `gorm:"autoUpdateTime"`
	DeletedAt                   *time.Time `gorm:"index"`
}

func (User) TableName() string { return "users" }

// UserDocument stores HR document metadata for an employee. The actual file
// is saved either by the legacy shared /uploads endpoint (FileURL only,
// MediaAssetID nil) or through internal/media (category user_document,
// private visibility, owner-only RBAC) — see migration 00080. When
// MediaAssetID is set, FileURL in API responses is replaced with a
// freshly-minted signed URL at serialization time (see ToDocumentResponse/
// mediabridge's SignedURLFn) — never a persisted one, since signed URLs
// expire after MediaConfig.SignedURLTTL. Width/Height are dimensions, not
// URLs, so they're safe to denormalize permanently (usually unset for
// non-image documents like PDFs, which are never rasterized).
type UserDocument struct {
	ID                 uuid.UUID  `gorm:"type:uuid;primaryKey"`
	UserID             uuid.UUID  `gorm:"type:uuid;not null;index"`
	FileURL            string     `gorm:"column:file_url;not null"`
	OriginalFilename   string     `gorm:"column:original_filename;not null"`
	ContentType        *string    `gorm:"column:content_type"`
	SizeBytes          *int64     `gorm:"column:size_bytes"`
	DocumentType       string     `gorm:"column:document_type;not null;default:'other'"`
	ExpiresAt          *time.Time `gorm:"column:expires_at;type:date"`
	VerificationStatus string     `gorm:"column:verification_status;not null;default:'uploaded'"`
	UploadedBy         *uuid.UUID `gorm:"type:uuid;column:uploaded_by"`
	MediaAssetID       *uuid.UUID `gorm:"column:media_asset_id;type:uuid"`
	Width              *int       `gorm:"column:width"`
	Height             *int       `gorm:"column:height"`
	CreatedAt          time.Time  `gorm:"autoCreateTime"`
}

func (UserDocument) TableName() string { return "user_documents" }

// UserHistory stores owner-visible profile changes such as job position changes.
type UserHistory struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null;index"`
	FieldName string     `gorm:"column:field_name;not null"`
	OldValue  *string    `gorm:"column:old_value"`
	NewValue  *string    `gorm:"column:new_value"`
	ChangedBy *uuid.UUID `gorm:"type:uuid;column:changed_by"`
	CreatedAt time.Time  `gorm:"autoCreateTime"`
}

func (UserHistory) TableName() string { return "user_history" }
