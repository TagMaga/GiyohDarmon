package users

import (
	"time"

	"github.com/google/uuid"
)

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
)

// AllRoles lists all valid roles for validation.
var AllRoles = []Role{
	RoleOwner, RoleSalesTeamLead, RoleManager, RoleSeller,
	RoleDispatcher, RoleWarehouseManager, RoleCourier,
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
	ID                          uuid.UUID `gorm:"type:uuid;primaryKey"`
	Phone                       string    `gorm:"uniqueIndex;not null"`
	Email                       *string   `gorm:"uniqueIndex"`
	PasswordHash                string    `gorm:"not null"`
	FullName                    string    `gorm:"not null"`
	Surname                     *string   `gorm:"column:surname"`
	TelegramChatID              *string   `gorm:"column:telegram_chat_id"`
	Role                        Role      `gorm:"type:user_role;not null"`
	IsActive                    bool      `gorm:"default:true;not null"`
	AvatarURL                   *string
	CourierOrderIntakeEnabled   bool `gorm:"default:true;not null"`
	CourierOrderIntakeReason    *string
	CourierOrderIntakeUpdatedAt *time.Time
	CourierOrderIntakeUpdatedBy *uuid.UUID
	CreatedAt                   time.Time  `gorm:"autoCreateTime"`
	UpdatedAt                   time.Time  `gorm:"autoUpdateTime"`
	DeletedAt                   *time.Time `gorm:"index"`
}

func (User) TableName() string { return "users" }
