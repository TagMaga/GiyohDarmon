package validator

import (
	"fmt"
	"reflect"
	"strings"
	"sync"

	"github.com/go-playground/validator/v10"
	apperrors "github.com/megamall/crm/pkg/errors"
)

var (
	instance *validator.Validate
	once     sync.Once
)

// Get returns the singleton validator instance.
func Get() *validator.Validate {
	once.Do(func() {
		instance = validator.New(validator.WithRequiredStructEnabled())
		// Register custom tag name function to use json tags in error messages.
		instance.RegisterTagNameFunc(func(fld reflect.StructField) string {
			name := strings.SplitN(fld.Tag.Get("json"), ",", 2)[0]
			if name == "-" {
				return ""
			}
			return name
		})
	})
	return instance
}

// Validate validates a struct and returns an AppError if invalid.
func Validate(s interface{}) *apperrors.AppError {
	err := Get().Struct(s)
	if err == nil {
		return nil
	}

	var errs validator.ValidationErrors
	if ok := isValidationErrors(err, &errs); ok {
		messages := make([]string, 0, len(errs))
		for _, e := range errs {
			messages = append(messages, fieldError(e))
		}
		return apperrors.BadRequest(strings.Join(messages, "; "))
	}

	return apperrors.BadRequest(err.Error())
}

func isValidationErrors(err error, target *validator.ValidationErrors) bool {
	if ve, ok := err.(validator.ValidationErrors); ok {
		*target = ve
		return true
	}
	return false
}

func fieldError(e validator.FieldError) string {
	switch e.Tag() {
	case "required":
		return fmt.Sprintf("%s is required", e.Field())
	case "min":
		return fmt.Sprintf("%s must be at least %s characters", e.Field(), e.Param())
	case "max":
		return fmt.Sprintf("%s must be at most %s characters", e.Field(), e.Param())
	case "email":
		return fmt.Sprintf("%s must be a valid email", e.Field())
	case "e164":
		return fmt.Sprintf("%s must be a valid phone number in E.164 format", e.Field())
	case "oneof":
		return fmt.Sprintf("%s must be one of: %s", e.Field(), e.Param())
	case "uuid4":
		return fmt.Sprintf("%s must be a valid UUID", e.Field())
	default:
		return fmt.Sprintf("%s failed validation: %s", e.Field(), e.Tag())
	}
}
