#!/usr/bin/env bash
# wipe_products_orders_transactions.sh — Delete ALL products, orders, and
# financial/transaction records (see the .sql file for the exact table
# list). Employees, teams, hierarchy, couriers, payouts, and compensation
# records are left untouched.
#
# This script is intentionally NOT gated by scripts/lib/dbsafety.sh's
# production-refusal guard: unlike the other scratch/dev scripts in this
# repo, this one may be intentionally pointed at production. That makes the
# confirmation step below the only safety net — read it carefully.
#
# Usage:
#   DB_DSN="postgres://user:pass@host:5432/megamall" \
#   bash scripts/wipe_products_orders_transactions.sh
#
# Requires: psql
# All secrets are read from environment — never hardcode credentials.

set -euo pipefail

: "${DB_DSN:?DB_DSN is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "⚠️  WARNING: This will PERMANENTLY DELETE, on the database this DB_DSN"
echo "   points at:"
echo "     - all products, inventory, batches, and product/courier movement"
echo "       history"
echo "     - the entire pharmacy consignment domain"
echo "     - all orders and their line items, timeline, comments, attachments"
echo "     - all financial/transaction ledgers: financial_events, cash"
echo "       handovers, company budget transactions, business expenses,"
echo "       dispatcher settlements, budget withdrawal requests"
echo ""
echo "   PRESERVED: all users/employees (every role), teams, hierarchy,"
echo "   courier profiles, payouts, payout batches, employee compensations,"
echo "   customers, activity logs, avatars, and user documents."
echo ""
echo "   This cannot be undone. Make sure you have a fresh backup first."
echo ""
read -r -p "Type 'DELETE PRODUCTS ORDERS TRANSACTIONS' to confirm: " confirm
if [ "$confirm" != "DELETE PRODUCTS ORDERS TRANSACTIONS" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "→ Wiping products, orders, and transaction records..."
psql "$DB_DSN" -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/wipe_products_orders_transactions.sql"

echo ""
echo "✅ Wipe complete: products, orders, and transaction/financial records removed."
echo "   Employees, teams, couriers, payouts, and compensation history are intact."
