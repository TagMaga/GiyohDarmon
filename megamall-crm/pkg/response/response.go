package response

import (
	"log"
	"net/http"

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
	c.JSON(http.StatusOK, Envelope{Success: true, Data: data})
}

// OKWithMeta writes a 200 success response with meta (pagination, etc).
func OKWithMeta(c *gin.Context, data interface{}, meta interface{}) {
	c.JSON(http.StatusOK, Envelope{Success: true, Data: data, Meta: meta})
}

// Created writes a 201 response.
func Created(c *gin.Context, data interface{}) {
	c.JSON(http.StatusCreated, Envelope{Success: true, Data: data})
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
