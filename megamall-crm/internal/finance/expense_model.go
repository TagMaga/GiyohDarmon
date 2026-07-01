package finance

// expense_model.go — Business expenses (salaries, rent, marketing, taxes, other).
//
// These belong to Finance's P&L, not to Company Budget. Amount and note are the
// only editable fields; category is fixed at creation (edits go through
// record_edits, see repository.go).

import (
	"time"

	"github.com/google/uuid"
)

type ExpenseCategory string

const (
	ExpenseCategorySalary    ExpenseCategory = "salary"
	ExpenseCategoryRent      ExpenseCategory = "rent"
	ExpenseCategoryMarketing ExpenseCategory = "marketing"
	ExpenseCategoryTaxes     ExpenseCategory = "taxes"
	ExpenseCategoryOther     ExpenseCategory = "other"
)

func IsValidExpenseCategory(c ExpenseCategory) bool {
	switch c {
	case ExpenseCategorySalary, ExpenseCategoryRent, ExpenseCategoryMarketing, ExpenseCategoryTaxes, ExpenseCategoryOther:
		return true
	default:
		return false
	}
}

// BusinessExpense is a single business-expense row.
type BusinessExpense struct {
	ID        uuid.UUID       `gorm:"type:uuid;primaryKey"`
	Category  ExpenseCategory `gorm:"type:finance_expense_category;column:category;not null"`
	Amount    float64         `gorm:"type:numeric(14,2);not null"`
	Note      string          `gorm:"not null;default:''"`
	CreatedBy *uuid.UUID      `gorm:"type:uuid;column:created_by"`
	CreatedAt time.Time       `gorm:"autoCreateTime"`
}

func (BusinessExpense) TableName() string { return "finance_business_expenses" }

// RecordEdit is a single amount/note change to a finance expense or budget transaction.
type RecordEdit struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	SubjectType string    `gorm:"column:subject_type;not null"`
	SubjectID   uuid.UUID `gorm:"type:uuid;column:subject_id;not null"`
	EditedBy    uuid.UUID `gorm:"type:uuid;column:edited_by;not null"`
	OldAmount   float64   `gorm:"type:numeric(14,2);column:old_amount;not null"`
	NewAmount   float64   `gorm:"type:numeric(14,2);column:new_amount;not null"`
	OldNote     string    `gorm:"column:old_note;not null;default:''"`
	NewNote     string    `gorm:"column:new_note;not null;default:''"`
	EditedAt    time.Time `gorm:"column:edited_at;autoCreateTime"`
}

func (RecordEdit) TableName() string { return "record_edits" }

const recordSubjectFinanceExpense = "finance_expense"

// RecordEditRow is the read model enriched with the editor's name.
type RecordEditRow struct {
	ID         uuid.UUID `gorm:"column:id"          json:"id"`
	SubjectID  uuid.UUID `gorm:"column:subject_id"  json:"subject_id"`
	EditedBy   uuid.UUID `gorm:"column:edited_by"   json:"edited_by"`
	EditorName string    `gorm:"column:editor_name" json:"editor_name"`
	OldAmount  float64   `gorm:"column:old_amount"  json:"old_amount"`
	NewAmount  float64   `gorm:"column:new_amount"  json:"new_amount"`
	OldNote    string    `gorm:"column:old_note"    json:"old_note"`
	NewNote    string    `gorm:"column:new_note"    json:"new_note"`
	EditedAt   time.Time `gorm:"column:edited_at"   json:"edited_at"`
}

// BusinessExpenseRow is the read model for the paginated expense list, enriched
// with the creator's name.
type BusinessExpenseRow struct {
	ID            uuid.UUID `gorm:"column:id"              json:"id"`
	Category      string    `gorm:"column:category"        json:"category"`
	Amount        float64   `gorm:"column:amount"          json:"amount"`
	Note          string    `gorm:"column:note"            json:"note"`
	CreatedByName *string   `gorm:"column:created_by_name" json:"created_by_name"`
	IsEdited      bool      `gorm:"column:is_edited"        json:"is_edited"`
	EditCount     int       `gorm:"column:edit_count"       json:"edit_count"`
	LastEditedAt  *time.Time `gorm:"column:last_edited_at"  json:"last_edited_at,omitempty"`
	CreatedAt     time.Time `gorm:"column:created_at"      json:"created_at"`
}
