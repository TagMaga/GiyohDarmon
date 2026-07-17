#!/usr/bin/env bash
# reset_db.sh — Drop, recreate, migrate, and seed the megamall-crm database.
#
# Usage:
#   DB_DSN="postgres://user:pass@localhost:5432/megamall" \
#   DB_NAME="megamall" \
#   DB_USER="postgres" \
#   DB_HOST="localhost" \
#   DB_PORT="5432" \
#   bash scripts/reset_db.sh
#
# Requires: psql, goose (go install github.com/pressly/goose/v3/cmd/goose@latest)
# All secrets are read from environment — never hardcode credentials.

set -euo pipefail

# ── Validate required env vars ────────────────────────────────────────────────
: "${DB_DSN:?DB_DSN is required}"
: "${DB_NAME:?DB_NAME is required}"

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-./migrations}"

# ── Guard: refuse anything production-shaped ──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/dbsafety.sh
source "$SCRIPT_DIR/lib/dbsafety.sh"
refuse_if_production_env
refuse_if_production_value "DB_DSN" "$DB_DSN"
refuse_if_production_value "DB_NAME" "$DB_NAME"
refuse_if_production_value "DB_HOST" "$DB_HOST"
refuse_if_production_value "DB_USER" "$DB_USER"

# ── Guard: confirmation prompt ────────────────────────────────────────────────
echo ""
echo "⚠️  WARNING: This will DESTROY the database '${DB_NAME}' on ${DB_HOST}:${DB_PORT}"
echo "   All data will be permanently deleted."
echo ""
read -r -p "Type 'yes' to confirm: " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# ── Drop and recreate ─────────────────────────────────────────────────────────
echo ""
echo "→ Dropping database '${DB_NAME}'..."
PGPASSWORD="${DB_PASSWORD:-}" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -c "DROP DATABASE IF EXISTS ${DB_NAME};" \
  postgres

echo "→ Creating database '${DB_NAME}'..."
PGPASSWORD="${DB_PASSWORD:-}" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -c "CREATE DATABASE ${DB_NAME};" \
  postgres

# ── Run migrations ────────────────────────────────────────────────────────────
echo "→ Running migrations..."
goose -dir "$MIGRATIONS_DIR" postgres "$DB_DSN" up

# ── Run seed ──────────────────────────────────────────────────────────────────
echo "→ Seeding demo data..."
go run ./cmd/seed

echo ""
echo "✅ Reset complete: database '${DB_NAME}' is clean and seeded."
