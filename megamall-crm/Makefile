.PHONY: help build run dev test lint migrate migrate-down migrate-status \
        docker-up docker-down docker-dev-up docker-dev-down clean tidy

# ── Config ────────────────────────────────────────────────────────────────────
BINARY     = megamall-crm
BUILD_DIR  = ./tmp
CMD        = ./cmd/server
DB_DSN    ?= $(shell grep ^DB_DSN .env 2>/dev/null | cut -d= -f2-)

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Build ─────────────────────────────────────────────────────────────────────
build: ## Build production binary
	@mkdir -p $(BUILD_DIR)
	CGO_ENABLED=0 go build -ldflags="-w -s" -o $(BUILD_DIR)/$(BINARY) $(CMD)

run: build ## Build and run
	$(BUILD_DIR)/$(BINARY)

tidy: ## go mod tidy + verify
	go mod tidy
	go mod verify

# ── Development ───────────────────────────────────────────────────────────────
dev: ## Run with Air hot reload (requires Air installed)
	air -c .air.toml

docker-dev-up: ## Start dev stack (postgres + redis + app with hot reload)
	docker compose -f docker-compose.dev.yml up --build

docker-dev-down: ## Stop dev stack
	docker compose -f docker-compose.dev.yml down

# ── Production Docker ─────────────────────────────────────────────────────────
docker-up: ## Start production stack
	docker compose up --build -d

docker-down: ## Stop production stack
	docker compose down

# ── Migrations ────────────────────────────────────────────────────────────────
migrate: ## Run all pending migrations
	@which goose > /dev/null || go install github.com/pressly/goose/v3/cmd/goose@latest
	goose -dir ./migrations postgres "$(DB_DSN)" up

migrate-down: ## Roll back last migration
	goose -dir ./migrations postgres "$(DB_DSN)" down

migrate-status: ## Show migration status
	goose -dir ./migrations postgres "$(DB_DSN)" status

migrate-reset: ## Roll back ALL migrations (destructive!)
	goose -dir ./migrations postgres "$(DB_DSN)" reset

# ── Test ─────────────────────────────────────────────────────────────────────
test: ## Run all tests
	go test -v -race -count=1 ./...

test-cover: ## Run tests with coverage report
	go test -race -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: coverage.html"

# ── Lint ─────────────────────────────────────────────────────────────────────
lint: ## Run golangci-lint
	@which golangci-lint > /dev/null || \
		curl -sSfL https://raw.githubusercontent.com/golangci-lint/master/install.sh | sh -s -- -b $(shell go env GOPATH)/bin
	golangci-lint run ./...

# ── Cleanup ───────────────────────────────────────────────────────────────────
clean: ## Remove build artifacts
	rm -rf $(BUILD_DIR) coverage.out coverage.html
