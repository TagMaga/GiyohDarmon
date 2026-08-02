package response

import (
	"log"
	"net/http"
	"reflect"

	"github.com/gin-gonic/gin"
	apperrors "github.com/megamall/crm/pkg/errors"
)

// Envelope is the standard API response shape: { success, data, meta, error }
type Envelope struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Meta    interface{} `json:"meta,omitempty"`
	Error   *ErrorBody  `json:"error,omitempty"`
}

type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// OK writes a 200 success response.
func OK(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Envelope{Success: true, Data: normalizeCollections(data)})
}

// OKWithMeta writes a 200 success response with meta (pagination, etc).
func OKWithMeta(c *gin.Context, data interface{}, meta interface{}) {
	c.JSON(http.StatusOK, Envelope{Success: true, Data: normalizeCollections(data), Meta: meta})
}

// Created writes a 201 response.
func Created(c *gin.Context, data interface{}) {
	c.JSON(http.StatusCreated, Envelope{Success: true, Data: normalizeCollections(data)})
}

// NoContent writes a 204 response.
func NoContent(c *gin.Context) {
	c.Status(http.StatusNoContent)
}

// Error writes an error response from an AppError.
func Error(c *gin.Context, err *apperrors.AppError) {
	// AppErrors built via apperrors.Internal() carry the real underlying
	// error (e.g. a DB error) but always return the same generic message to
	// the client, by design. Without this, that underlying error was never
	// logged anywhere: callers that pass an already-wrapped AppError here
	// skip HandleError's log.Printf below, since it only fires for errors
	// that aren't already an AppError.
	if err.Code == apperrors.CodeInternal {
		log.Printf("[INTERNAL ERROR] %s: %v", c.Request.URL.Path, err.Unwrap())
	}
	c.JSON(err.StatusCode, Envelope{
		Success: false,
		Error: &ErrorBody{
			Code:    string(err.Code),
			Message: err.Message,
		},
	})
}

// HandleError converts any error to the appropriate response.
func HandleError(c *gin.Context, err error) {
	if appErr, ok := apperrors.AsAppError(err); ok {
		Error(c, appErr)
		return
	}
	// Unknown error — internal
	log.Printf("[INTERNAL ERROR] %v", err)
	Error(c, apperrors.Internal(err))
}

// normalizeCollections walks data and rewrites any nil slice — at the top
// level or nested inside structs/slices/pointers — into an empty, non-nil
// slice, so the JSON encoder emits `[]` instead of `null`.
//
// Repository code builds response DTOs with `var rows []T; db.Find(&rows)`.
// GORM never allocates the destination slice when a query matches zero
// rows, so "empty list" and "nothing was ever populated" are
// indistinguishable at the Go level: both are a nil slice, which
// encoding/json serializes as `null`. Every handler response goes through
// response.OK/Created/OKWithMeta, so normalizing here — once — closes the
// whole class of "Cannot read properties of null (reading 'map')" frontend
// crashes at the source, instead of patching each repository method or each
// frontend call site as it's discovered.
//
// []byte fields are left untouched: they carry raw payloads (e.g. jsonb
// metadata), not collections, and JSON-encode nil vs empty differently on
// purpose.
func normalizeCollections(data interface{}) interface{} {
	v := reflect.ValueOf(data)
	if !v.IsValid() {
		return data
	}
	// Build an addressable copy so nested slice fields can be mutated via
	// reflection even when data was passed by value (a bare struct or
	// slice, not a pointer).
	copyPtr := reflect.New(v.Type())
	copyPtr.Elem().Set(v)
	normalizeValue(copyPtr.Elem())
	return copyPtr.Elem().Interface()
}

func normalizeValue(v reflect.Value) {
	switch v.Kind() {
	case reflect.Ptr:
		if !v.IsNil() {
			normalizeValue(v.Elem())
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			f := v.Field(i)
			if !f.CanSet() {
				continue
			}
			normalizeValue(f)
		}
	case reflect.Slice:
		if v.Type().Elem().Kind() == reflect.Uint8 {
			return // []byte payload, not a collection
		}
		if v.IsNil() {
			v.Set(reflect.MakeSlice(v.Type(), 0, 0))
			return
		}
		for i := 0; i < v.Len(); i++ {
			normalizeValue(v.Index(i))
		}
	}
}
