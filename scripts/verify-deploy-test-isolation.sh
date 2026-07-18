#!/usr/bin/env bash
# Regression guard for the deploy.yml / pr-checks.yml test-isolation contract:
#
#   - deploy.yml must never need a database: no TEST_ADMIN_DSN, no postgres
#     service container, and every package it runs WITHOUT a -run filter
#     must have zero test files that call testutil.NewTestDB (the
#     TEST_ADMIN_DSN-backed disposable-DB helper).
#   - pr-checks.yml must keep running the complete DB-backed suite against
#     its disposable Postgres service container.
#
# Incident this guards against (2026-07-18): PR #42 added DB-backed
# integration tests to internal/courier and internal/users, both of which
# deploy.yml ran bare (unfiltered, no -run) in its "Run database-independent
# backend tests" step. The production deploy job failed at that step because
# TEST_ADMIN_DSN isn't set there by design — no deploy was attempted, so
# production was unaffected, but it should have been caught before merge.
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DEPLOY_YML=".github/workflows/deploy.yml"
PR_CHECKS_YML=".github/workflows/pr-checks.yml"
BACKEND_DIR="megamall-crm"

fail() { echo "FAIL: $*" >&2; exit 1; }

# 1. deploy.yml must never reference TEST_ADMIN_DSN or provision a database.
#    (Comment-only lines are excluded — this file's own explanatory comments
#    mention TEST_ADMIN_DSN by name precisely to say it ISN'T used here.)
grep -vE '^\s*#' "$DEPLOY_YML" | grep -q "TEST_ADMIN_DSN" && \
  fail "$DEPLOY_YML references TEST_ADMIN_DSN outside a comment — it must never require a database"
grep -vE '^\s*#' "$DEPLOY_YML" | grep -qE '^\s*services:' && \
  fail "$DEPLOY_YML defines a services: block — it must never provision a database"

# 2. pr-checks.yml must still run the complete DB-backed suite via its
#    disposable Postgres service container.
grep -q "TEST_ADMIN_DSN" "$PR_CHECKS_YML" || \
  fail "$PR_CHECKS_YML no longer sets TEST_ADMIN_DSN — DB-backed tests would have no database"
grep -qE '^\s*postgres:' "$PR_CHECKS_YML" || \
  fail "$PR_CHECKS_YML no longer runs a postgres service container"
grep -q 'go test ./... ' "$PR_CHECKS_YML" || \
  fail "$PR_CHECKS_YML no longer runs the full test suite (go test ./...)"

# 3. Every package deploy.yml runs bare (no -run filter, in the
#    "Run database-independent backend tests" step) must have zero test
#    files that call testutil.NewTestDB (the TEST_ADMIN_DSN-backed helper).
BARE_STEP=$(sed -n '/name: Run database-independent backend tests/,/- name:/p' "$DEPLOY_YML" | grep -vE '^\s*#')
[ -n "$BARE_STEP" ] || fail "could not find the 'Run database-independent backend tests' step in $DEPLOY_YML"
if echo "$BARE_STEP" | grep -q -- '-run'; then
  fail "the bare 'Run database-independent backend tests' step now contains -run — update this script's assumptions"
fi
BARE_PACKAGES=$(echo "$BARE_STEP" | grep -oE '\./(internal|pkg)/[a-zA-Z0-9_]+' | sort -u)
[ -n "$BARE_PACKAGES" ] || fail "found no packages in the bare step — update this script's assumptions"

# internal/courier and internal/users specifically must never be run bare —
# they carry DB-backed media_integration_test.go files (this is the exact
# regression from the incident above).
for pkg in ./internal/courier ./internal/users; do
  if echo "$BARE_PACKAGES" | grep -qxF "$pkg"; then
    fail "$pkg must not be run bare in deploy.yml (it has DB-backed integration tests) — use a dedicated -run-filtered step, e.g. 'Run courier no-DB tests' / 'Run users no-DB tests'"
  fi
done

while IFS= read -r pkg; do
  dir="$BACKEND_DIR/${pkg#./}"
  [ -d "$dir" ] || fail "package directory $dir (from deploy.yml) does not exist"
  if grep -lE 'testutil\.NewTestDB' "$dir"/*_test.go 2>/dev/null; then
    fail "$dir has a DB-backed test file (testutil.NewTestDB) but is run bare in deploy.yml's 'Run database-independent backend tests' step"
  fi
done <<< "$BARE_PACKAGES"

echo "OK: deploy.yml test-isolation contract holds for: $(echo "$BARE_PACKAGES" | tr '\n' ' ')"
