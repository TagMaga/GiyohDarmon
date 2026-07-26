# MegaMall CRM — End-to-End Pre-Production Audit
**Date:** 2026-07-25 (audit) / 2026-07-26 (remediation) · **Scope:** Go backend (`megamall-crm`), React admin (`web-admin`), Expo courier app (`mobile/courier-app`), migrations, CI/CD, Docker
**Method:** 5 parallel deep-dive code audits (auth/authz, financial/business logic, DB schema, web-admin frontend, mobile+DevOps) + live verification: fresh Postgres 16 instance, all 88 migrations applied cleanly, full `go test ./...` run against a real database for every buildable package.
**Prior audits reviewed:** `docs/AUDIT_2026-06-18.md`, `docs/AUDIT_2026-07-22.md` — their findings are not repeated here except where status changed.

---

## Remediation status (2026-07-26)

The four confirmed production blockers below (C1, C2, H1, H2) have been **fixed, tested, and adversarially verified** in this same change. Full detail — root cause, exact diff, tests added, and adversarial proof each fix actually closes the hole (not just that tests pass) — is in the session's final report. Summary:

| Finding | Status | Fix |
|---|---|---|
| C1 — owner withdrawal race | ✅ Fixed | `internal/budget/repository.go`: whole check-then-insert wrapped in one transaction, serialized via `pg_advisory_xact_lock`; amount must be `> 0`. |
| C2 — destructive migration `00062` Down | ✅ Fixed | Down scoped to exactly the rows Up inserted (via the still-intact `company_budget_transactions` join), verified up→seed→down→up on a disposable DB. |
| H1 — payout batch double-pay | ✅ Fixed | `internal/payouts`: validation aggregates per-payee across the batch (not per-item); a per-payee `pg_advisory_xact_lock` + fresh in-transaction re-check closes the cross-batch race. |
| H2 — avatar upload bypasses validation | ✅ Fixed | `internal/users/handler.go` now routes through `internal/uploads.Validate` (magic-byte sniff) + new `uploads.DecodeBounds` (full decode + dimension cap), server-generated filename, stored in the same directory the already-hardened `GET /uploads/:filename` route serves. |

One correction to the original audit surfaced during remediation: **H2 is not merely a latent landmine** — the courier mobile app's `src/api/auth.js` (`uploadAvatar`) does call the legacy `POST /users/me/avatar` endpoint (no current screen wires it to a button, but the client function exists and the route is live), so this endpoint is a real, reachable, authenticated attack surface today, not just a future-risk item. The fix now also makes `avatar_url` actually resolve (previously dead, per the original finding), since avatars are stored in the same directory the generic `/uploads/:filename` route already serves.

Everything else in this document (all 🟠/🟡/🟢 findings, scores, "would you deploy today") reflects the **pre-remediation** state and is preserved unchanged below for the record.

---

## 🔴 Critical

### C1. Owner withdrawal balance check is a TOCTOU race — company balance can go negative
**Location:** `internal/budget/repository.go:245-278` (`AddWithdrawal`), `internal/budget/handler.go:135`
**Why:** `AddWithdrawal` reads `CurrentBalance()`, compares `amount > balance`, then inserts — three unguarded statements, `tx=nil`, no row lock, no transaction, no DB constraint preventing negative balance (only `amount > 0` is checked, migration `00056`).
**Repro:** Balance = 1000 TJS. Owner double-clicks "Withdraw 800" (or opens two tabs). Both requests read balance=1000 before either commits, both pass the check, both insert. Final balance = 1000 − 1600 = **−600**. No idempotency key exists to catch the literal double-click either.
**Expected:** second concurrent withdrawal rejected once the first commits; company funds can never go negative.
**Actual:** both succeed silently.
**Fix:** wrap in a DB transaction; take a lock before reading balance (mirror the `pg_advisory_xact_lock` pattern already used in `internal/courier/repository.go:824` for handovers) or re-verify balance with `SELECT ... FOR UPDATE` inside the locked scope; add a client idempotency key to the withdrawal endpoint.

### C2. Migration `00062` Down destroys live production data, not just what it inserted
**Location:** `migrations/00062_migrate_manual_expenses_to_finance.sql:16-17`
**Why:** Up copies a subset of `company_budget_transactions` into `finance_business_expenses`. Down does `DELETE FROM finance_business_expenses; DELETE FROM record_edits WHERE subject_type='finance_expense';` — an unscoped truncate, not a reversal of only what Up inserted. `finance_business_expenses` is a live table used going forward.
**Repro:** Months post-cutover, ops runs `goose down` once to fix an unrelated migration bug → every real business expense entered since cutover (and its edit history) is silently deleted, with no backup step in the rollback path.
**Expected:** Down reverses only rows it created, or is marked irreversible (as migration `00081` correctly does with `SELECT 1` + a comment).
**Fix:** Scope the deletes to the original backfilled IDs, or replace with an honest no-op Down.

---

## 🟠 High

### H1. Bulk payout batch validates each line item independently — same payee can be paid twice in one request
**Location:** `internal/payouts/service.go:172-190` (`validatePayoutItems`), `CreatePayouts` (`service.go:225-320`)
**Why:** Validation checks every item against the same static `Remaining` snapshot taken once before the loop; nothing accumulates consumed amount per payee across items in the same batch, and no DB constraint rejects two items for one payee in one batch.
**Repro:** Seller X's remaining payable = 500 TJS. One `POST /payouts` batch with `items: [{payee: X, amount: 500}, {payee: X, amount: 500}]` — both pass validation independently, both insert in the same transaction. Seller X is paid 1000 for 500 owed.
**Fix:** accumulate consumed amount per `PayeeID` across the validation loop, checked against a running remainder, not a static snapshot.
*(Note: void logic itself is correctly guarded — double-void is rejected, and voided payouts correctly free up remaining balance.)*

### H2. Avatar upload endpoint bypasses the app's own hardened file-validation (stored-XSS landmine)
**Location:** `internal/users/handler.go:321-354` (`uploadAvatar`)
**Why:** Unlike the generic `/uploads` pipeline (`internal/uploads`, wired in `cmd/server/main.go:419-497`) which does magic-byte sniffing, this handler trusts the client-supplied `Content-Type` header and filename extension. `curl -F "avatar=@evil.svg;type=image/svg+xml"` saves an `.svg` with an inline `<script>` under `./uploads/avatars/`.
**Current blast radius:** contained — no static file mount currently serves `/uploads/avatars/*` (the one serving route only matches single-segment filenames and re-sniffs bytes), so this 404s today. It becomes live stored XSS the moment anyone adds a static mount for `./uploads/` (a very plausible future "avatars don't load" fix), and the returned `avatarURL` is dead/non-functional regardless.
**Fix:** route avatar uploads through `internal/uploads.Validate` like every other upload path.

### H3. Docker image runs as root with no HEALTHCHECK
**Location:** `docker/Dockerfile` (final `FROM scratch` stage), `docker-compose.yml:48-64`
**Why:** No `USER` directive — process runs as UID 0 inside the container. No `HEALTHCHECK`, unlike the `postgres`/`redis` services in the same compose file, so orchestration can't detect a hung-but-running app process.
**Fix:** add a numeric non-root user via `--chown` in the copy step (or switch to a distroless base with `USER`), and add a `HEALTHCHECK` against `/api/v1/ready`.

### H4. Courier push-notification infrastructure is entirely dead on the client
**Location:** backend has a full stack for it (`internal/courier/routes.go:46` `PUT /push-token`, `UpsertPushToken`, migration `00039`) but `mobile/courier-app` never imports `expo-notifications` or calls the endpoint anywhere.
**Why it matters:** couriers get zero push alerts for new/urgent assignments; the app relies entirely on foreground polling. `CLAUDE.md` still documents this as implemented, which will mislead future contributors.
**Fix:** either wire up `expo-notifications` end-to-end (register on login, invalidate on logout — that invalidation endpoint doesn't exist yet either) or remove the dead schema/endpoint and correct the docs.

### H5. No global React error boundary in web-admin
**Location:** `web-admin/src/main.jsx`, `app/providers.jsx`
**Why:** Zero `ErrorBoundary`/`componentDidCatch` anywhere. Any unhandled render-time exception (malformed API payload, a bad prop) unmounts the entire SPA to a blank white screen with no recovery path.
**Fix:** wrap the app (ideally per role-layout) in an error boundary with a fallback + reload action.

### H6. Access + refresh JWTs stored in plain `localStorage` in web-admin
**Location:** `shared/store/authStore.js:17-18,40`, `shared/api/client.js:22,41,80`
**Why:** No XSS sink was found in the current codebase (verified: zero `dangerouslySetInnerHTML`/`innerHTML`/`eval`), so this is not live-exploitable today — but it's a defense-in-depth gap: any future dependency-supply-chain bug or reflected XSS becomes full, persistent account takeover (both tokens readable via `localStorage`, no httpOnly boundary).
**Fix:** move the refresh token to an httpOnly `SameSite=Strict` cookie set by the backend; keep only the short-lived access token client-accessible if a full cookie migration isn't feasible now.

---

## 🟡 Medium

- **M1 — No idempotency on order creation** (`internal/orders/dto.go`): double-submit creates two real orders (two inventory reservations, two financial snapshots). No negative stock/crash results (DB `CHECK` constraints backstop inventory), but it's a real duplicate-order bug. *Fix:* add a client idempotency key + unique index, mirroring the pattern already used for payout batches.
- **M2 — No idempotency on business-expense creation** (`internal/finance/repository.go:279-289`, `AddExpense`): double-submit silently double-counts an expense, understating `computeNetProfit` → `budget.CurrentBalance`. Same fix pattern as M1.
- **M3 — No startup validation of JWT secret strength** (`config/config.go:52-57`): a copy-pasted `.env.example` placeholder (`change-me-generate-with-openssl-rand-hex-64`) boots the server fine in prod, letting anyone forge tokens for any role including owner. *Fix:* reject secrets under ~32 bytes or matching the known placeholder text at `config.Load()`.
- **M4 — CORS defaults to wildcard-with-credentials when `CORS_ORIGINS` is unset** (`pkg/middleware/cors.go:47-87`): documented as "dev only" but has no hard fail-safe against a misconfigured prod deploy shipping it. *Fix:* refuse to boot with `GIN_MODE=release` + empty `CORS_ORIGINS`.
- **M5 — Missing `CHECK` constraints on core order money columns** (`migrations/00023_create_orders.sql:48-54`): `subtotal`/`delivery_fee`/`total_amount`/`net_revenue` have no `>= 0` bound, unlike `order_items`. `net_revenue` has already been computed wrong once in production (per migration `00083`'s backfill) — a CHECK would have caught that class of bug at write time.
- **M6 — Inconsistent implicit `ON DELETE` (defaults to NO ACTION) on several FKs to `users`** in money/audit tables (`employee_compensations`, `seller_payouts`, `payouts`, `payout_batches`, worker applications, etc.) — behaviorally correct (blocks deleting a referenced user) but inconsistent with the rest of the schema's explicit style, inviting a future "helpful" CASCADE refactor. *Fix:* make `ON DELETE RESTRICT` explicit.
- **M7 — Order-audit-trail tables cascade on order deletion with no schema-level guard against a hard delete of `orders` itself** (`order_items`, `order_timeline`, `order_status_history`, etc. all `ON DELETE CASCADE` from `orders`). No repository code hard-deletes an order today (confirmed by grep), and `financial_events.order_id` is correctly hardened to `RESTRICT` (migration `00036`) — but nothing stops a future `Unscoped().Delete()` on `Order{}` (a pattern that already exists for `Product{}`) from silently erasing the delivery/operational audit trail. *Fix:* a `BEFORE DELETE` trigger requiring `deleted_at IS NOT NULL`, or an explicit documented risk acceptance like `00036`'s.
- **M8 — Mobile OTA workflow ships to production with zero test/lint gate** (`.github/workflows/courier-ota.yml`): triggers on push to `main`, runs `eas update --channel production` with no `npm test`/type-check step in between (the app has no test script at all). *Fix:* add at least `tsc --noEmit`/`expo-doctor` and a manual approval gate before the production channel publish, matching the backend `deploy.yml`'s `environment: production` gate.
- **M9 — No automated, off-host database backups** — only a manual `pg_dump` step documented in `docs/STAGING_RUNBOOK.md:498-523`, run at a human's discretion before deploys. *Fix:* scheduled backup job (cron or a GitHub Actions `schedule` workflow) with off-host storage and rotation.
- **M10 — Production health-check monitoring is real but coarse**: `production-health.yml` genuinely checks `/api/v1/ready` (DB connectivity, seeded config existence — not a placebo), but runs only every 6 hours and has no failure notification (Slack/email/issue) beyond a red CI job. An outage could run up to ~6h unnoticed. *Fix:* tighter interval + alerting step.
- **M11 — Silent-fail mutations in web-admin**: order-comment send (`OrderCommentsPanel.jsx:24-28`) and cash-handover update/delete/edit (`CashHandoversPage.jsx:680-721`) define no `onError` and never render `.error` — a failed submission looks like nothing happened, with no user-visible signal. Systemic: of 46 files using `useMutation`, only 8 define `onError`; most others are covered by caller-level try/catch or inline `.error` rendering, but these two are genuinely silent. *Fix:* toast/inline-render `.error` on both.
- **M12 — Two team-lead pages are dead/unreachable code** (`TeamLeadManagerPage.jsx`, `TeamLeadSellersPage.jsx`, still lazy-imported at `router.jsx:39-40` but their routes hard-redirect via `<Navigate>` instead of rendering them) — same class of issue the prior audit already flagged and partially fixed for `HrDashboard`. A dead frontend call to a never-existed `/hr/tariffs/active` endpoint (`features/people/api.js:152-155`) also still ships, with zero importers of its own hook. *Fix:* delete both pages, their router imports, and the dead API/hook.
- **M13 — `courier_fee_confirmed` ledger event defined but never emitted** *(carried over, still open per `docs/AUDIT_2026-07-22.md` C.2)* — decide to implement at handover-confirmation or remove the unused enum value.
- **M14 — Cash-handover retry can duplicate media uploads / lacks an idempotency key on a financial submission** (`mobile/courier-app/app/(tabs)/cash.jsx:227-249`): a network blip after a successful `submitHandover` POST, followed by the app's own "Повторить" retry button, re-runs the whole upload+submit flow with no client-generated idempotency key, risking a duplicate handover record server-side (not independently verified against backend dedup logic). *Fix:* generate a UUID once per handover attempt, send it, dedupe server-side; cache already-uploaded media IDs across retries.

---

## 🟢 Low

- **L1** — Rate limiting is in-memory/single-instance only (`pkg/middleware/rate_limit.go`); correctly applied to login/refresh (5 req/60s), but won't scale correctly across replicas. Provisioned `REDIS_URL` is configured but never actually connected to anywhere in the Go code — dead config.
- **L2** — Raw SQL string-building via `fmt.Sprintf`/`strings.Join` in `internal/finance/repository.go:560-609` builds a UNION query; all *values* are bound parameters (not currently injectable), but the pattern has no visual guard against a future contributor adding a dynamic user-driven `WHERE` clause here.
- **L3** — `internal/courier/service.go` handover confirm/dispute path (`ConfirmHandover`/`ConfirmTransaction`, lines 614-691) reads then writes without `SELECT ... FOR UPDATE`; a concurrent double-confirm race exists but is low-impact (idempotent overwrite via `Save`, worst case a duplicate activity-log row, not double-counted money).
- **L4** — `internal/inventory` reporting queries (`ListMovements`, `SalesByProduct`) aggregate the entire `order_items` table with no date/order filter pushed into the subquery — a full-table scan on every call that will get slower as the table grows.
- **L5** — `internal/schema76check` is a valuable one-time migration-ordering regression test but is not wired into any CI workflow and is skipped by a bare `go test ./...` (build-tag gated) — only runs via a manually-invoked command documented in its own file header.
- **L6** — Icon-only buttons in web-admin mostly lack `aria-label` (93 of 122 files importing icons have none) — many have adjacent visible text so it's a partial gap, worth a follow-up accessibility pass.
- **L7** — Mobile app documentation (`CLAUDE.md`) claims GPS/location tracking (`expo-location`) is implemented; no such code or permission exists in the current app — doc drift, not a functional bug (no location leak risk since nothing is collected).
- **L8** — Delivery-status "mark delivered" action (`mobile/courier-app/app/(tabs)/deliveries.jsx:76-84`) has the same retry-duplication shape as L14/C-tier handover issue, lower severity since a status transition is closer to idempotent server-side (not independently verified).

---

## What's Actually Solid (verified, not assumed)

- **Refresh-token security is genuinely strong**: SHA-256-hashed storage (never raw), rotation-with-family model, reuse detection revokes the whole family, deactivated-account checks re-verified against the DB on every access/refresh. Above-average implementation.
- **JWT validation** explicitly pins `SigningMethodHMAC`, closing the classic `alg:none` bypass.
- **RBAC/route inventory**: every non-health route in every `internal/*/routes.go` is gated by `RequireAuth`/`RequireRoles`; only `/health`, `/ready`, `/auth/login`, `/auth/refresh` are unauthenticated, and the latter two are rate-limited.
- **IDOR verified end-to-end for courier↔order access**: a courier genuinely cannot fetch or act on another courier's order (`GetOrderByIDForCourier` scopes by `courier_id`, `validateTransitionRole` re-checks ownership/assignment before any state change).
- **Order state machine**: terminal statuses (`delivered`/`returned`/`cancelled`) have empty transition maps — a cancelled order cannot later be delivered or paid.
- **Concurrent courier assignment race** is correctly closed: `AssignCourier` locks the order row and re-checks for an existing active assignment inside the same transaction.
- **Cash-handover set-membership locking** uses a deliberate `pg_advisory_xact_lock` (not a row lock) with a code comment showing the team reasoned through why a row lock would be insufficient for this specific case — correct.
- **`financial_events` idempotency is real DB-level defense**, not just app-level: a `UNIQUE(order_id, event_type)` index (migration `00070`) backstops the app-level guard.
- **Inventory cannot go negative** even under an app bug: DB `CHECK (quantity >= reserved_quantity)` and `>= 0` constraints exist as a hard backstop (migration `00018`).
- **Commission engine**: rates frozen per-order in `OrderFinancialSnapshot` for audit; `company_revenue` is a residual so the ledger balances by construction; house orders correctly skip commission attribution; employee→team→global rate resolution has no silent fallback gap (errors rather than defaulting).
- **Generic file-upload pipeline** (`internal/uploads`) does real magic-byte sniffing, re-sniffs on every serve, forces `Content-Disposition: attachment` for non-images, path-traversal-safe filename handling — the correct pattern, just not applied consistently to avatars (H2).
- **Backend `deploy.yml` genuinely gates deploy on tests**: `go test ./...` and `scripts/test-deploy.sh` run in the same job before build/package/SSH-deploy steps; a failing test fails the whole job.
- **Graceful shutdown is correctly implemented**: SIGTERM/SIGINT handled, in-flight requests drained via `srv.Shutdown(ctx)`, activity-log buffer explicitly flushed before DB close.
- **Structured logging redacts sensitive query params** and no `password`/`token`/`secret` values were found logged anywhere in the Go codebase.
- **Mobile app auth storage is correct**: tokens live exclusively in `expo-secure-store` (Keychain/Keystore), never `AsyncStorage`; no `persist` middleware on the Zustand auth store.
- **Web-admin has zero XSS sinks**: no `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` anywhere; all content renders through auto-escaping JSX.
- **Double-submit protection on money-affecting web-admin forms** (orders, receiving, writeoffs, payouts) correctly gates the submit button on `mutation.isPending`.
- **Cache-invalidation discipline** in web-admin: every audited mutation invalidates the correct query keys — no stale-data-after-edit gaps found.
- **Live verification**: all 88 migrations applied cleanly to a fresh Postgres 16 database; the full Go test suite passed for every package that could build in this sandbox (auth, compensation, customers, delivery_settings, dispatch, finance, hierarchy, inventory, logistics_settings, payouts, seed, teams, uploads, middleware, dbsafety, config) — the only build failures were `media`/`courier`/`orders`/`products`/`users`/`cmd/server`, all of which transitively depend on the `bimg`/`libvips` CGO binding, and this sandbox's package mirror could not fetch `libvips-dev`. This is an environment limitation of this audit session, not a code defect — CI (`pr-checks.yml`) does install and exercise this path.

**Correction to a sub-audit's claim:** one of the automated reports stated "this repo has no `.github/workflows` directory at all." That's wrong — it looked only inside `megamall-crm/`; the workflows live at the repo root (`.github/workflows/`, 5 files) and were independently verified here: `pr-checks.yml` does run `go test ./... -timeout 10m` as its final gate on every PR, and `deploy.yml` gates production deploys on the same suite plus `scripts/test-deploy.sh`.

---

## Scores

| Area | Score | Rationale |
|---|---|---|
| Security | 72/100 | Strong auth/RBAC/IDOR foundation; one live-adjacent stored-XSS landmine (H2), JWT-secret and CORS fail-open defaults (M3/M4), token storage lacks defense-in-depth (H6). |
| Backend | 78/100 | Order/inventory/commission core is well-engineered with real DB backstops; two genuine money-integrity bugs (C1 withdrawal race, H1 payout double-pay) are not acceptable pre-launch. |
| Frontend | 74/100 | Solid RBAC gating, no XSS sinks, good invalidation discipline; missing error boundary (H5) and several silent-fail mutations (M11) are real gaps for a live user base. |
| Database | 75/100 | Mostly excellent (explicit FK intent, correct uniqueness constraints, honest irreversible-migration pattern in most places); one destructive Down migration (C2) and missing money-column CHECKs (M5) need fixing before more migrations stack on top. |
| Performance | 78/100 | No major issues found; a couple of unbounded aggregate queries (L4) will need attention as data grows, nothing urgent at current scale. |
| UX/UI | 76/100 | Good responsive/loading-state discipline per the frontend audit; accessibility (L6) and a few dead pages (M12) are polish items, not blockers. |
| Production Readiness | 66/100 | Deploy pipeline gates on tests (good); but root-user Docker image with no healthcheck (H3), ungated mobile OTA (M8), manual-only backups (M9), and coarse alerting (M10) are real gaps for "thousands of real users tomorrow." |
| **Overall** | **74/100** | |

---

## Would you deploy this to production today?

> **Superseded by remediation (see top of document):** the answer below (**No**) was correct for the state of the code at audit time (2026-07-25). As of the 2026-07-26 remediation, C1, C2, H1, and H2 — every blocker cited below — are fixed and verified. See the session's final report for the updated conclusion (`READY FOR STAGING` / `NOT READY` / `READY FOR PRODUCTION`) and remaining open items (the 🟠/🟡/🟢 findings below, none of which were blockers).

**No.** *(as of the original audit, 2026-07-25 — see note above)*

Two findings are disqualifying on their own for a launch with real money moving through the system:

1. **C1 (owner withdrawal race)** — the company's own cash balance can go negative from an ordinary double-click, with no transaction, no lock, and no idempotency key protecting it. This is the kind of bug that turns into a real accounting incident in week one.
2. **H1 (payout batch double-payment)** — a single payout batch can pay the same seller/courier twice for the same remaining balance. Combined with C1, both of the audit's critical/high financial findings are in the same class: **money movements that aren't protected by transactions, locks, or idempotency the way the rest of the codebase generally does it well** (the courier-handover and financial-events code shows the team knows the right pattern — it just wasn't applied to withdrawals and payout-batch validation).

Also blocking, independently: **C2** (a `migrate down` that can silently erase real business-expense history) is a live landmine for any future rollback, and **H2** (avatar upload bypassing the app's own file-validation) is a stored-XSS bug waiting for someone to add a static file mount — not urgent today, but not something to ship into a codebase that will keep evolving.

None of these require a rewrite — C1, H1, and C2 are each small, targeted fixes (a transaction + lock, a running-total check, a scoped Down migration) consistent with patterns already proven elsewhere in this same codebase. Fix the four items above (C1, C2, H1, H2), then this is a reasonably strong system to launch — the architecture, RBAC, and audit-trail design underneath it are genuinely good.
