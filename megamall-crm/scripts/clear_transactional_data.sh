#!/usr/bin/env bash
# clear_transactional_data.sh — Guarded runner for clear_transactional_data.sql.
#
# Clears all transactional/business data (orders and all their children,
# customers, financial events, cash handovers, sessions, logs) while
# preserving users, teams, hierarchy, courier profiles, warehouse tables
# (products, inventory) and config tables.
#
# Usage:
#   DB_DSN="postgres://user:pass@localhost:5432/megamall" \
#   bash scripts/clear_transactional_data.sh
#
# Why this wrapper exists: the .sql file is a bare `TRUNCATE ... CASCADE`, so
# `psql -f clear_transactional_data.sql` against the wrong DSN silently wipes
# every order in that database with no prompt and no production check. Every
# other destructive script here already routes through lib/dbsafety.sh (see
# its header — that guard exists because a scratch script once mutated the
# live production role and caused an outage). This closes the same gap for
# this one. Run the .sql directly only if you have deliberately decided to
# bypass these checks.
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

# ── Guard: show what is about to be destroyed ─────────────────────────────────
# TimeZone is a GORM-only DSN param, not a real libpq keyword — psql rejects
# it as an invalid connection option, so strip it before use (same treatment
# as backup_db_telegram.sh).
pg_conninfo="$(printf '%s' "$DB_DSN" | sed -E 's/[[:space:]]*TimeZone=[^[:space:]]*//')"

current_orders="$(psql "$pg_conninfo" -tAc "SELECT count(*) FROM orders" 2>/dev/null || echo '?')"
current_customers="$(psql "$pg_conninfo" -tAc "SELECT count(*) FROM customers" 2>/dev/null || echo '?')"

echo ""
echo "⚠️  WARNING: This will TRUNCATE all transactional data:"
echo "     orders (${current_orders} rows) and every child row that cascades from them"
echo "       — order items, timeline, assignments, comments, prepayments,"
echo "         financial_events and order financial snapshots"
echo "     customers (${current_customers} rows), cash_handovers,"
echo "     refresh_tokens, activity_logs, courier_status_logs"
echo ""
echo "   PRESERVED: users, teams, hierarchy, courier profiles,"
echo "              products, inventory, and config tables."
echo ""
echo "   This cannot be undone. Take a backup first if this data matters."
echo ""
read -r -p "Type 'yes' to confirm: " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "→ Clearing transactional data..."
psql "$pg_conninfo" -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/clear_transactional_data.sql"

echo ""
echo "✅ Transactional data cleared. Users, products and config remain."
