#!/usr/bin/env bash
# scripts/lib/dbsafety.sh — shared production-refusal guard for scratch/dev
# shell scripts.
#
# A prior scratch test pointed a connection string at the live production
# PostgreSQL role and mutated its password directly, causing an outage.
# Every scratch/dev script in this repo must source this file and call
# refuse_if_production_value on every host/database/user/URL/DSN it is
# about to use — before doing anything destructive or state-changing — and
# refuse_if_production_env once, unconditionally.
#
# This mirrors pkg/dbsafety.RefuseProduction's denylist (a human-run script
# often needs to reach a real dev/staging host by name, so — like
# RefuseProduction, and unlike the stricter allowlist-only
# pkg/dbsafety.AssertNotProduction used by the automated Go test harness —
# this is denylist-based, not an allowlist of "known disposable" hosts).
# Keep the denylist here in sync with deniedSubstrings in pkg/dbsafety/dbsafety.go.

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
