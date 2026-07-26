# Staging Deployment Plan

**Deploying:** commit `1225768` on `claude/complete-e2e-security-audit-1rl7kl` (frozen — no further code changes per this session's instructions)
**Target:** Staging only. **Production deployment is explicitly out of scope for this plan** and must not happen until `STAGING_VALIDATION_CHECKLIST.md` is fully signed off.
**Companion documents:** `docs/FINAL_PRODUCTION_AUDIT.md` (what changed and why), `docs/STAGING_RUNBOOK.md` (general environment setup reference), `docs/STAGING_VALIDATION_CHECKLIST.md` (post-deploy manual verification — execute immediately after this plan's "Success criteria" step).

---

## 0. Pre-deployment checks

Do these before touching any staging infrastructure.

- [ ] Confirm `git log -1` on the deploy target matches commit `1225768` exactly (`git rev-parse HEAD`).
- [ ] Confirm CI is green on this commit (`pr-checks.yml`'s `build-and-test` job, which runs `go test ./... -timeout 10m` against a real disposable database — this is the one full verification this session's sandboxed environment could not run end-to-end due to a missing `libvips` system library; CI has it and must be green before proceeding).
- [ ] Confirm no uncommitted or stray changes exist on the deploy host (`git status --short` clean after checkout).
- [ ] Confirm the migration head: `goose -dir ./migrations postgres "$DB_DSN" status` shows nothing pending beyond migration `00088` (the highest migration at this freeze point) and that migration `00062`'s edited Down block (see below) is the version actually on disk — do not deploy from a stale checkout.
- [ ] Confirm staging `.env` (or environment variables) are fully populated per `docs/STAGING_RUNBOOK.md` §2 — in particular `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are real generated secrets (`openssl rand -hex 64`), not the `.env.example` placeholder text, and `CORS_ORIGINS` is set explicitly (not empty) since `GIN_MODE=release` is used in staging.
- [ ] Confirm staging has its own isolated database — **never** point staging at the production `DB_DSN`.
- [ ] Notify whoever owns staging that a deploy is starting, and that a manual validation pass will follow (expect staging to be in a "just deployed, being verified" state for the duration of the checklist).
- [ ] Freeze other staging deploys until this one is validated (avoid two people/pipelines mutating staging's DB state mid-checklist).

## 1. Full database backup

Take this **before running any migration**, even though the only schema change since the last known-good staging state is a Down-block edit to an already-applied migration (which by itself changes no data) — the backup exists to cover the deploy as a whole, not just this one edit.

```bash
# Adjust connection details to staging's actual DB_DSN.
pg_dump -h <staging-db-host> -U megamall -d megamall_crm_staging \
  --format=custom --file="megamall_staging_pre_deploy_$(date +%Y%m%d_%H%M%S).dump"
```

- [ ] Verify the dump file is non-trivially sized (not a near-empty file from a failed connection).
- [ ] Copy the dump to off-host storage (S3/GCS/equivalent) immediately — a dump sitting only on the DB host does not survive a host failure.
- [ ] Record the dump's filename/location somewhere the team performing the checklist can find it (needed for rollback, step 9).
- [ ] Optional but recommended: do a quick `pg_restore --list` against the dump to confirm it's readable, without actually restoring it.

## 2. Migration execution

At freeze point, the only migration-related change this session made is to migration `00062`'s **Down** block (scoped to delete only what its Up inserted, instead of an unconditional table wipe — see `FINAL_PRODUCTION_AUDIT.md`'s remediation section for the full rationale on why editing an already-applied migration's Down was judged safe here). **No new migration file was added**; there is nothing new to apply going forward from `00088`.

- [ ] Confirm goose's tracking table has no content-checksum that would flag the edited `00062` file (confirmed during this session: `goose_db_version` in this project stores no checksum, only `version_id`/`is_applied`/`tstamp` — an edited Down script does not trigger any mismatch).
- [ ] Run migrations exactly as the existing `migrate` service does:
```bash
goose -dir ./migrations postgres "$DB_DSN" up
```
or, if using `docker-compose.yml`'s `migrate` service, simply let `docker compose up` bring it up first (it's gated `depends_on: postgres: condition: service_healthy`, and `app` is gated on `migrate: condition: service_completed_successfully`).
- [ ] Confirm output ends at `version: 88` with no errors.
- [ ] **Do not** run `goose down` as part of this deploy. If a rollback is ever needed later, re-read `FINAL_PRODUCTION_AUDIT.md`'s note on migration `00062` first — its Down is now scoped correctly, but rolling back past it is still a decision that deserves a human looking at the data first, not a reflexive action.

## 3. Backend deployment

- [ ] Build the backend image from `docker/Dockerfile` (multi-stage, `CGO_ENABLED=0`, statically linked) at the frozen commit. If not using Docker, build the binary directly: `CGO_ENABLED=0 go build -ldflags="-w -s" -o ./tmp/megamall-crm ./cmd/server`.
- [ ] Deploy so that the new binary/image only receives traffic after migrations (step 2) have completed successfully — do not let old and new backend versions run concurrently against a mid-migration database (not a concern here since this migration set has no schema changes beyond the Down-block edit, but keep this ordering as standing practice).
- [ ] Roll the backend (blue-green, rolling restart, or single-instance restart — whatever staging's normal process is).
- [ ] Confirm the process starts cleanly in logs (no panic, no failed config validation, no "failed to connect to database" on boot).

## 4. Frontend deployment

- [ ] Build: `cd web-admin && npm ci && npm run build` (already verified to complete cleanly at this freeze point in-session).
- [ ] Deploy the `web-admin/dist` output to wherever staging serves static assets (confirm this matches production's actual serving mechanism — nginx, CDN, etc. — so staging is a faithful rehearsal).
- [ ] Confirm the deployed frontend's API base URL points at the staging backend, not production.
- [ ] Hard-refresh (bypass cache) and confirm the app loads with no console errors before proceeding to health checks.

## 5. Health checks

- [ ] `GET /api/v1/health` → 200. This checks DB connectivity and migration version — confirm the returned migration version matches `88`.
- [ ] `GET /api/v1/ready` → 200 (not 503). This is a deeper check: DB reachable, an owner user exists, all 5 commission configs are seeded, and the delivery-settings singleton row exists. A 503 here means something is missing from staging's seed data, not just a connectivity blip — do not proceed past this step on a 503.
- [ ] If using `docker-compose.yml`, confirm `postgres` and `redis` both report `healthy` via `docker compose ps`.

## 6. API verification

Quick, scripted smoke checks before the full manual checklist (these are meant to catch gross deployment failures — wrong build, wrong env vars, wrong DB — in under a minute, not to replace `STAGING_VALIDATION_CHECKLIST.md`):

- [ ] `POST /api/v1/auth/login` with a known staging test account → 200 with a token.
- [ ] `GET /api/v1/owner/budget/summary` (authenticated as owner) → 200 with a `balance` field.
- [ ] `GET /api/v1/uploads/some-nonexistent-file` → 404 (confirms the upload-serving route is wired and doesn't 500).
- [ ] Confirm CORS: an `OPTIONS` preflight from the actual staging frontend origin succeeds; a request from an arbitrary/unexpected origin is rejected (this validates the `CORS_ORIGINS` pre-deployment check actually took effect).
- [ ] Confirm rate limiting is active on `/api/v1/auth/login` (6 rapid failed attempts from the same IP should start getting rate-limited — this is a pre-existing control, not something changed this session, but worth reconfirming post-deploy).

## 7. Database verification

- [ ] `SELECT version_id FROM goose_db_version ORDER BY id DESC LIMIT 1;` → `88`.
- [ ] Row counts on core tables are non-zero and sane relative to pre-deploy (`users`, `orders`, `company_budget_transactions`, `cash_handovers`, `payouts`) — a suspiciously-empty table after a "successful" migration run is a red flag, not a green light.
- [ ] Confirm no unexpected schema drift: `\d company_budget_transactions`, `\d cash_handovers` match what the migrations define (no manual hotfixes lingering on staging from a prior ad-hoc session).
- [ ] Spot-check the invariant this session's fixes protect, directly in SQL, before any human clicks anything:
```sql
-- Company balance must never be negative — a true statement even before
-- the validation checklist below exercises it through the UI/API.
SELECT COALESCE(SUM(CASE WHEN transaction_type='manual_income' THEN amount
                         WHEN transaction_type='owner_withdrawal' THEN -amount ELSE 0 END), 0) AS manual_net
FROM company_budget_transactions;
-- Combine with GET /owner/budget/summary's live Finance-profit term; the
-- resulting balance must be >= 0 on a freshly-migrated, freshly-seeded
-- staging DB (it should be, since nothing has run against it yet).
```

## 8. Log verification

- [ ] Confirm structured request logging is active and **not** logging sensitive values — spot-check a login request's log line for the absence of the plaintext password/token (pre-existing control, reconfirm post-deploy).
- [ ] Confirm no repeating error-level log lines in the first few minutes after deploy (a crash-loop masked by a container auto-restart looks fine from the outside but floods logs).
- [ ] Confirm the activity log (`activity_logs` table) is receiving entries as the smoke-test actions in step 6 and the validation checklist are performed (`SELECT count(*) FROM activity_logs WHERE created_at > '<deploy time>';` should be increasing, not stuck at 0).

## 9. Rollback procedure

Trigger rollback if: health checks fail and don't recover within a few minutes, the API smoke checks in step 6 fail, or a **blocker** item is found during `STAGING_VALIDATION_CHECKLIST.md` that indicates the deployed code (not just test data) is broken.

1. **Stop traffic to the new backend/frontend** — revert the load balancer/router to the previous known-good version (or `docker compose` back to the previous image tag) before touching the database.
2. **Database:** Since this deploy applies no schema-changing migration (only an edited Down block on an already-applied migration, which by itself changed nothing on disk until now), a data rollback is only needed if the validation checklist's *actions* (real budget/payout/handover writes performed during testing) need to be undone — restore from the pre-deploy dump taken in step 1:
```bash
pg_restore -h <staging-db-host> -U megamall -d megamall_crm_staging --clean --if-exists \
  megamall_staging_pre_deploy_<timestamp>.dump
```
3. **Backend/frontend:** redeploy the previous commit's build artifacts (keep the previous image tag / build output available specifically so this step doesn't require a fresh build under pressure).
4. Re-run health checks (step 5) against the rolled-back deployment before declaring the rollback complete.
5. Document what triggered the rollback, referencing the specific checklist item number if applicable, before attempting a second deploy.

## 10. Success criteria before approving Production

All of the following must be true — this is a strict AND, not "most of them":

- [ ] Steps 0-8 above completed with no unresolved failures.
- [ ] Every item in `docs/STAGING_VALIDATION_CHECKLIST.md` is executed and its summary sign-off table shows **no blocker items**, or any exception is explicitly documented and accepted in writing by whoever owns that risk (not silently skipped).
- [ ] Staging has run for a reasonable soak period (recommend at least 24-48 hours, or a full business day of real/simulated usage) with no crash-loop, no memory growth indicating a leak, and no error-log accumulation beyond expected volume.
- [ ] At least one person other than the author of this session's fixes has independently reviewed the diff (`git diff bd9d120..1225768`) or the `FINAL_PRODUCTION_AUDIT.md` remediation sections, per the "second pair of eyes" recommendation already on record from this session's own verdict.
- [ ] Explicit, named sign-off recorded (who approved, when) before any production deployment step begins — this document and the validation checklist do not themselves constitute approval.

**This plan does not authorize a production deployment.** Production deployment requires a separate, explicit go-ahead after every item above is satisfied.
