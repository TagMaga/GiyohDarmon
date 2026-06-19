# Megamall CRM — Phase 1 Setup

## First-time setup (requires internet access to proxy.golang.org)

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env: set DB_DSN, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET

# 2. Resolve dependencies and generate go.sum
go mod tidy

# 3. Start the dev stack (Postgres + Redis + hot reload)
make docker-dev-up
```

## Running migrations

Migrations are managed by [Goose](https://github.com/pressly/goose) and run **separately** from the server binary.

```bash
# Install goose CLI once
go install github.com/pressly/goose/v3/cmd/goose@latest

# Run all pending migrations
make migrate

# Check migration status
make migrate-status
```

## Development

```bash
make dev          # hot reload via Air (requires Air: go install github.com/air-verse/air@latest)
make test         # run tests
make lint         # golangci-lint
make build        # production binary → ./tmp/megamall-crm
```

## API

Base URL: `http://localhost:8080/api/v1`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | public | health check |
| POST | `/auth/login` | public | get token pair |
| POST | `/auth/refresh` | public | rotate refresh token |
| POST | `/auth/logout` | bearer | revoke all sessions |
| GET/POST | `/users` | owner | list / create users |
| GET/PATCH/DELETE | `/users/:id` | owner | get / update / delete user |
| PATCH | `/users/:id/password` | self or owner | change password |
| GET/POST | `/teams` | owner/manager/tl | list / create teams |
| GET/PATCH/DELETE | `/teams/:id` | owner | get / update / delete team |
| POST | `/hierarchy/assign` | owner | assign user to team/parent |
| GET | `/hierarchy/user/:user_id` | owner/manager/tl | get user's chain |
| GET | `/hierarchy/team/:team_id/members` | owner/manager/tl | get team members |

## JWT Claims

```json
{
  "user_id": "uuid",
  "role":    "owner | sales_team_lead | manager | seller | dispatcher | warehouse_manager | courier",
  "team_id": "uuid | omitted if unassigned"
}
```

Access token TTL: 15 minutes. Refresh token TTL: 7 days with family rotation.
