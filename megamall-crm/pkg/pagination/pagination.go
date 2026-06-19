package pagination

import (
	"math"
	"strconv"

	"github.com/gin-gonic/gin"
)

const (
	DefaultLimit = 20
	MaxLimit     = 100
)

// Params holds parsed pagination params from query string.
type Params struct {
	Page  int `json:"page"`
	Limit int `json:"limit"`
}

// Meta is included in paginated responses.
type Meta struct {
	Page       int `json:"page"`
	Limit      int `json:"limit"`
	Total      int `json:"total"`
	TotalPages int `json:"total_pages"`
}

// ParseFromQuery reads page/limit from gin query params with sane defaults.
// Default page = 1, default limit = DefaultLimit (20), max limit = MaxLimit (100).
func ParseFromQuery(c *gin.Context) Params {
	return ParseFromQueryWithDefaults(c, 1, DefaultLimit)
}

// ParseFromQueryWithDefaults is like ParseFromQuery but lets the caller supply
// per-endpoint defaults for page and limit. Max limit is always capped at MaxLimit.
//
// Usage: use when a specific endpoint needs a larger default limit (e.g. /hr/events
// defaults to 100 so callers that previously received an unbounded array now get
// the same data in a single page by default).
func ParseFromQueryWithDefaults(c *gin.Context, defaultPage, defaultLimit int) Params {
	page := parseIntDefault(c.Query("page"), defaultPage)
	limit := parseIntDefault(c.Query("limit"), defaultLimit)

	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = defaultLimit
	}
	if limit > MaxLimit {
		limit = MaxLimit
	}

	return Params{Page: page, Limit: limit}
}

// Offset returns the SQL offset for this page.
func (p Params) Offset() int {
	return (p.Page - 1) * p.Limit
}

// BuildMeta constructs the meta object for a paginated response.
func BuildMeta(p Params, total int) Meta {
	totalPages := int(math.Ceil(float64(total) / float64(p.Limit)))
	if totalPages < 1 {
		totalPages = 1
	}
	return Meta{
		Page:       p.Page,
		Limit:      p.Limit,
		Total:      total,
		TotalPages: totalPages,
	}
}

func parseIntDefault(s string, def int) int {
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return v
}
