package middleware

import (
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// RequestLogger logs each request with method, path, status, latency, IP.
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := c.Request.URL.RawQuery

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()
		method := c.Request.Method
		ip := c.ClientIP()

		if raw != "" {
			path = path + "?" + raw
		}

		log.Printf("[HTTP] %d | %s | %s | %s | %v",
			status, method, path, ip, latency)
	}
}
