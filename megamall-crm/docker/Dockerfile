# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

# Install git for go module fetching; ca-certificates for TLS.
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

# Cache dependencies separately from source code.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build a statically-linked binary.
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
    -ldflags="-w -s -extldflags '-static'" \
    -o /build/megamall-crm \
    ./cmd/server

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM scratch

# Copy timezone data and CA certs from builder.
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

COPY --from=builder /build/megamall-crm /megamall-crm

EXPOSE 8080

ENTRYPOINT ["/megamall-crm"]
