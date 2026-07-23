#!/usr/bin/env bash
# wipe_keep_owner.sh — Delete ALL business data (orders, products,
# inventory, finance/transactions, employees, couriers, teams, sessions,
# logs, media) while preserving ONLY owner user row(s): their login
# (phone/email) and password_hash are left completely untouched.
#
# Usage:
#   DB_DSN="postgres://user:pass@localhost:5432/megamall" \
#   DB_HOST="localhost" \
#   bash scripts/wipe_keep_owner.sh
#
# Requires: psql
# All secrets are read from environment — never hardcode credentials.

set -euo pipefail

# ── Validate required env vars ────────────────────────────────────────────────
: "${DB_DSN:?DB_DSN is required}"

DB_HOST="${DB_HOST:-localhost}"

# ── Guard: refuse anything production-shaped ──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/dbsafety.sh
source "$SCRIPT_DIR/lib/dbsafety.sh"
refuse_if_production_env
refuse_if_production_value "DB_DSN" "$DB_DSN"
refuse_if_production_value "DB_HOST" "$DB_HOST"
refuse_if_non_local_host "DB_HOST" "$DB_HOST"

# ── Guard: confirmation prompt ────────────────────────────────────────────────
echo ""
echo "⚠️  WARNING: This will DELETE all orders, products, inventory, finance/"
echo "   transaction records, employees, couriers, teams, and logs."
echo "   Only owner user account(s) (login + password) will be kept."
echo "   This cannot be undone."
echo ""
read -r -p "Type 'yes' to confirm: " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "→ Wiping business data, keeping owner accounts only..."
psql "$DB_DSN" -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/wipe_keep_owner.sql"

echo ""
echo "✅ Wipe complete: only owner user account(s) remain."
