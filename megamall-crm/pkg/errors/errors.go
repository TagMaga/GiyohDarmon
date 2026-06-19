package errors

import (
	"errors"
	"fmt"
	"net/http"
)

// Code represents a machine-readable error code.
type Code string

const (
	CodeBadRequest      Code = "BAD_REQUEST"
	CodeUnauthorized    Code = "UNAUTHORIZED"
	CodeForbidden       Code = "FORBIDDEN"
	CodeNotFound        Code = "NOT_FOUND"
	CodeConflict        Code = "CONFLICT"
	CodeUnprocessable   Code = "UNPROCESSABLE"
	CodeInternal        Code = "INTERNAL_ERROR"
	CodeInvalidToken    Code = "INVALID_TOKEN"
	CodeTokenExpired    Code = "TOKEN_EXPIRED"
	CodeTokenReused     Code = "TOKEN_REUSED"
	CodeInvalidPassword Code = "INVALID_PASSWORD"
	CodeUserInactive    Code = "USER_INACTIVE"
)

// AppError is the canonical error type returned from all service/handler layers.
type AppError struct {
	Code       Code   `json:"code"`
	Message    string `json:"message"`
	StatusCode int    `json:"-"`
	Err        error  `json:"-"`
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

func (e *AppError) Unwrap() error {
	return e.Err
}

// New creates a new AppError.
func New(code Code, statusCode int, message string) *AppError {
	return &AppError{Code: code, StatusCode: statusCode, Message: message}
}

// Wrap wraps an underlying error.
func Wrap(code Code, statusCode int, message string, err error) *AppError {
	return &AppError{Code: code, StatusCode: statusCode, Message: message, Err: err}
}

// Common constructors

func BadRequest(message string) *AppError {
	return New(CodeBadRequest, http.StatusBadRequest, message)
}

func Unauthorized(message string) *AppError {
	return New(CodeUnauthorized, http.StatusUnauthorized, message)
}

func Forbidden(message string) *AppError {
	return New(CodeForbidden, http.StatusForbidden, message)
}

func NotFound(resource string) *AppError {
	return New(CodeNotFound, http.StatusNotFound, fmt.Sprintf("%s not found", resource))
}

func Conflict(message string) *AppError {
	return New(CodeConflict, http.StatusConflict, message)
}

func Internal(err error) *AppError {
	return Wrap(CodeInternal, http.StatusInternalServerError, "internal server error", err)
}

func Unprocessable(message string) *AppError {
	return New(CodeUnprocessable, http.StatusUnprocessableEntity, message)
}

// Is checks if an error is an AppError with a specific code.
func Is(err error, code Code) bool {
	var appErr *AppError
	if errors.As(err, &appErr) {
		return appErr.Code == code
	}
	return false
}

// AsAppError extracts AppError from error chain.
func AsAppError(err error) (*AppError, bool) {
	var appErr *AppError
	ok := errors.As(err, &appErr)
	return appErr, ok
}
