# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Project layout

Two independent apps in one repo:
- **Backend** (repo root): Go + Gin + GORM + PostgreSQL, module `github.com/megamall/crm`.
- **Frontend** (`web-admin/`): React 18 + Vite + Tailwind, own `package.json`/dev server.

## Commands

### Backend

```bash
make build              # production binary -> ./tmp/megamall-crm
make dev                # hot reload via Air (requires: go install github.com/air-verse/air@latest)
make test               # go test -v -race -count=1 ./...
make test-cover         # + coverage.html
make lint               # golangci-lint run ./...
make migrate            # apply pending goose migrations (uses DB_DSN from .env)
make migrate-down       # roll back last migration
make migrate-status     # show applied/pending migrations
make docker-dev-up      # postgres + redis + app, hot reload, in Docker
```

Single test: `go test ./internal/<module>/... -run TestName -v`.

**Local (non-Docker) run** — this is what actually works day to day; `.env`'s `DB_DSN` has spaces in it so `set -a; . .env` silently breaks:
```bash
go build -o ./tmp/megamall-crm ./cmd/server
goose -dir ./migrations postgres "$(grep ^DB_DSN .env | cut -d= -f2-)" up
./run_server.sh          # sources .env correctly (line-by-line export) and execs the binary
./run_seed.sh            # go run ./cmd/seed — demo users/teams for local testing
```

### Frontend (run from `web-admin/`)

```bash
npm run dev              # vite, http://localhost:5173
npm run build             # vite build
npm run preview
```

No lint/test scripts are configured for the frontend — verify changes by building and exercising the app in a browser.

## Backend architecture

### Module shape

Every domain lives in `internal/<name>/` with the same file split: `model.go` (GORM structs + `TableName()`), `dto.go` (request/response structs with `validate:"..."` tags), `repository.go` (`*gorm.DB` wrapper, raw SQL for anything non-trivial), `service.go` (business rules + RBAC), `handler.go` (Gin handlers), `routes.go` (`RegisterRoutes(rg *gin.RouterGroup)`). All modules are constructed and wired by hand in `cmd/server/main.go` — there is no DI container. New modules must be wired there (repo → service → handler → `RegisterRoutes`).

**Cross-module dependencies**: prefer a narrow injected function type (e.g. `teams.UserExistsFn func(ctx, id) (bool, error)`) over injecting another module's whole repository — this is the established pattern for small existence/lookup checks. When a module genuinely needs another's business logic (not just a lookup), inject that module's `*Service` directly (e.g. `payouts.Service` takes `*compensation.Service` to reuse its income-report RBAC and math rather than re-deriving it).

### Request/response conventions

- All responses use the `pkg/response` envelope: `{success, data, meta, error}`. Handlers call `response.OK/Created/OKWithMeta/HandleError`, never write `c.JSON` directly.
- Errors are `*pkg/errors.AppError` (`Code`, `StatusCode`, `Message`), constructed via `apperrors.BadRequest/Forbidden/NotFound/Internal(...)` and passed to `response.HandleError` (which unwraps `AppError` or falls back to logging + 500).
- Request DTOs use `validate:"..."` struct tags (not gin's `binding:"..."`); after `c.ShouldBindJSON`, handlers explicitly call `validator.Validate(req)` from `pkg/validator` and forward any resulting `*AppError`.
- Auth: JWT claims are `{user_id, role, team_id}` (`internal/auth.Claims`), role is a plain string matching the Postgres `user_role` enum (`owner`, `sales_team_lead`, `manager`, `seller`, `dispatcher`, `warehouse_manager`, `courier`). Routes are gated with `middleware.RequireRoles("owner", "sales_team_lead", ...)`; handlers read the caller via `middleware.ClaimsFromContext(c)`. Note the role string is `sales_team_lead`, not `team_lead`.

### Migrations

Goose, sequential `migrations/NNNNN_description.sql` files with `-- +goose Up` / `-- +goose Down`. Check the highest existing number before adding one — pending-but-uncommitted migrations from other in-flight work are common in this repo, so run `goose status` (or `make migrate-status`) before assuming the next free number. Adding a Postgres enum value requires `-- +goose NO TRANSACTION` (`ALTER TYPE ... ADD VALUE` cannot run inside a transaction).

### The financial ledger constraint

`financial_events` (generic ledger: `event_type` enum + `amount` + `user_id` + `order_id`) has `order_id NOT NULL` with `ON DELETE RESTRICT` (migration 00036) — every row must be tied to a real order. Anything that is period-based rather than per-order (manual business expenses, payee/payer payouts) **cannot** live in this table. The established fix is a dedicated table (`finance_business_expenses`, `payouts`) that gets UNIONed into the read side in `internal/finance/repository.go: ListFinancialEvents`, with a synthesized `event_type` literal so the existing frontend event-type badge/label maps keep working unmodified. Don't add new `financial_events` enum values to represent non-order-based money movement — follow the UNION pattern instead.

### Commission / compensation engine

`internal/compensation` is the single source of truth for how much anyone has earned. Rates (`seller_rate`, `manager_team_rate`, `manager_personal_rate`, `team_lead_pool_rate`, `company_rate`) live in `CommissionConfig` rows scoped `global`/`team`/`employee` with `effective_from/to` windowing and employee→team→global fallback (`RateResolver`); they're already owner-editable via the HR dashboard (`web-admin/src/features/hr/components/ConfigsPanel.jsx` + `POST /hr/compensation/configs`) — don't build a parallel rates UI. `OrderFinancialSnapshot` freezes the resolved rates at order-creation time for audit. Income reporting (`GetMyIncome`, `GetTeamIncome`, `GetTeamIncomeSummary`) aggregates `financial_events` by user/event type and already encodes the RBAC for "who can see whose income" — reuse it rather than re-querying `financial_events` directly from another module.

## Frontend architecture (`web-admin/src`)

- `app/router.jsx` — one `ProtectedRoute` + `Layout` subtree per role (`owner`, `sales_team_lead` at `/team-lead`, `manager`, `seller`, `dispatcher`, `warehouse_manager`, `courier`), each with its own lazy-loaded page tree and a `{ path: '*', element: <ComingSoon /> }` catch-all.
- `shared/components/Layout.jsx` — decides mobile bottom-nav visibility per role (`hasMobileNav = isOwner || isSeller || isManager || ...`) and defines each role's tab array (`OWNER_TABS`, `MANAGER_TABS`, `TEAM_LEAD_TABS`, ...) in the same file; `BottomNav` (from `features/seller/components/BottomNav.jsx`) is generic and takes a `tabs` prop. Adding bottom-nav support for a role means updating both the boolean and adding its tab array here.
- `features/<domain>/` — `api.js` (thin axios wrappers + `unwrap()` for the `{success, data}` envelope), `hooks/` (TanStack Query hooks), `pages/`, `components/`. Query keys are centralized in `shared/queryKeys.js` (`KEYS.<domain>.<name>`) — never inline a query key array.
- `shared/hooks/useCurrentUser.js` decodes the JWT client-side for `{userId, role}`; `shared/store/authStore` (zustand) holds the token.
- `Modal.jsx` (`shared/components/`) is the shared dialog primitive and already renders as a bottom sheet on mobile (`items-end` + `rounded-t-*`) / centered modal on desktop — reuse it instead of building a new sheet/drawer component.
- Currency is always shown as the "c" abbreviation in copy, never a symbol.

## Workflow rules (permanent)

### Always, before starting any task

- Check `git status`, current branch, remote, and `gh auth status`.
- Never work directly on `main` — create/use a feature branch.
- Never include unrelated files in a commit (review `git status`/`git diff` before staging).
- Give a final report only after the change is merged, deployed, and verified live — not before.
- Standing instruction from the repo owner: once a change is ready, create the PR and merge it (after CI is green) without pausing to ask for confirmation — this applies in every session, including SAFE MODE below. Still stop and report on CI failure, merge conflict, or auth problems instead of forcing past them.

### FAST MODE — small frontend-only UI changes

Applies only to small, purely visual/UI changes confined to the frontend (e.g. `web-admin/src`), with no backend, database, auth, or business-logic impact.

- Get exactly one preview approval before proceeding — do not ask again after that.
- After approval, proceed straight through: commit, push, open PR, wait for CI, merge, deploy to production, verify live. No intermediate approval checkpoints.
- Do not send repeated progress messages while this runs.
- Stop and report only on: CI failure, merge conflict, auth problem, or deploy failure. Otherwise proceed to completion silently and report once at the end.

### SAFE MODE — backend, database, auth, finance, permissions, commissions, or any destructive change

Applies to anything touching the Go backend, migrations/schema, auth, `internal/finance`, `internal/compensation`, RBAC/permissions, or any change that deletes/overwrites data.

- Audit the relevant code first and share findings before proposing changes.
- Ask clarifying questions before writing code.
- Wait for explicit approval of the implementation plan before writing/changing code.
- Once the plan is approved and CI is green, create the PR and merge it without waiting for further confirmation (see standing instruction above).
