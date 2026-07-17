#!/usr/bin/env bash
# scripts/lib/dbsafety.sh — shared production-refusal guard for scratch/dev
# shell scripts.
#
# A prior scratch test pointed a connection string at the live production
# PostgreSQL role and mutated its password directly, causing an outage.
# Every scratch/dev script in this repo must source this file and call
# refuse_if_production_value AND refuse_if_non_local_host on every
# host/database/user/URL/DSN it is about to use — before doing anything
# destructive or state-changing — and refuse_if_production_env once,
# unconditionally.
#
# This mirrors pkg/dbsafety.RefuseProduction (a human-run script often needs
# to reach a real dev/staging host by name, so — like RefuseProduction, and
# unlike the stricter allowlist-only pkg/dbsafety.AssertNotProduction used
# by the automated Go test harness — this is denylist-based, not an
# allowlist of "known disposable" hosts). A denylist alone can't catch
# every production host though, so refuse_if_non_local_host additionally
# requires an explicit DBSAFETY_CONFIRM_REMOTE_HOST match for any non-
# loopback host. Keep the denylist here in sync with deniedSubstrings in
# pkg/dbsafety/dbsafety.go.

_DBSAFETY_DENYLIST=(prod production live megamall.com megamall.tj)

# refuse_if_production_value <label> <value>
# Case-insensitively checks value against the denylist; exits the calling
# script if matched. Never logs the full value if it might be a DSN
# containing a password — callers pass a label, this only echoes back
# whatever value they passed, so callers of this function with a raw DSN
# should prefer passing the parsed host/dbname/user instead where possible.
refuse_if_production_value() {
  local label="$1"
  local value="${2:-}"
  local lower needle
  lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  for needle in "${_DBSAFETY_DENYLIST[@]}"; do
    if [[ "$lower" == *"$needle"* ]]; then
      echo "REFUSING: $label matches a production-shaped pattern (\"$needle\") — this script must never target production." >&2
      exit 90
    fi
  done
}

# refuse_if_non_local_host <label> <url-or-host-value>
# A denylist alone can't catch every production host — a bare IP or an
# unfamiliar hostname simply won't match _DBSAFETY_DENYLIST. So any host
# that isn't loopback must be explicitly confirmed via
# DBSAFETY_CONFIRM_REMOTE_HOST=<that exact host>, forcing a deliberate,
# per-run decision rather than letting an unrecognized remote host
# (potentially production) pass through silently by default. Accepts either
# a bare host or a full URL/DSN host fragment (scheme/port/path stripped).
refuse_if_non_local_host() {
  local label="$1"
  local raw="${2:-}"
  local host confirm
  host="${raw#*://}"
  host="${host%%/*}"
  host="${host%%:*}"
  host="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"

  case "$host" in
    localhost|127.0.0.1|::1|"") return 0 ;;
  esac

  confirm="$(printf '%s' "${DBSAFETY_CONFIRM_REMOTE_HOST:-}" | tr '[:upper:]' '[:lower:]')"
  if [[ "$confirm" != "$host" ]]; then
    echo "REFUSING: $label targets non-local host \"$host\" — set DBSAFETY_CONFIRM_REMOTE_HOST=\"$host\" to confirm this is an intentional, non-production target." >&2
    exit 90
  fi
}

# refuse_if_production_env — refuses outright if common environment markers
# indicate this process is running in a production context, regardless of
# what host/DB/URL was passed.
refuse_if_production_env() {
  local var val
  for var in APP_ENV ENVIRONMENT NODE_ENV; do
    val="$(printf '%s' "${!var:-}" | tr '[:upper:]' '[:lower:]')"
    if [[ "$val" == "production" || "$val" == "prod" ]]; then
      echo "REFUSING: $var=\"${!var}\" indicates a production runtime." >&2
      exit 90
    fi
  done
  if [[ "${GIN_MODE:-}" == "release" ]]; then
    echo "REFUSING: GIN_MODE=release indicates a production runtime." >&2
    exit 90
  fi
}
