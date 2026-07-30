#!/usr/bin/env bash
# backup_db_telegram.sh — dump the production database and send it to a
# Telegram chat as a disaster-recovery copy.
#
# Runs on the production server (via the megamall-crm-backup systemd timer,
# see scripts/setup_backup_remote.sh), twice a day. Intentionally does NOT
# source lib/dbsafety.sh — every other script there refuses to run against
# production; this one exists specifically to read production and must be
# allowed to.
#
# Requires in the environment (systemd's EnvironmentFile=.env supplies these,
# same file the app server reads):
#   DB_DSN                    — libpq keyword/value string (see .env.example)
#   TELEGRAM_BACKUP_BOT_TOKEN — token for a bot dedicated to backups
#   TELEGRAM_BACKUP_CHAT_ID   — chat the dump is delivered to
#
# Optional:
#   BACKUP_DIR      — local retention directory (default /var/backups/megamall-crm)
#   BACKUP_KEEP     — how many local dumps to retain (default 14)

set -Eeuo pipefail

: "${DB_DSN:?DB_DSN is required}"
: "${TELEGRAM_BACKUP_BOT_TOKEN:?TELEGRAM_BACKUP_BOT_TOKEN is required}"
: "${TELEGRAM_BACKUP_CHAT_ID:?TELEGRAM_BACKUP_CHAT_ID is required}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/megamall-crm}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
TELEGRAM_API="https://api.telegram.org/bot${TELEGRAM_BACKUP_BOT_TOKEN}"
# Telegram bots can't upload files over 50MB.
TELEGRAM_MAX_BYTES=$((50 * 1000 * 1000))

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_name="megamall_crm_${timestamp}.dump"
tmp_file="$(mktemp)"

cleanup() { rm -f "$tmp_file"; }
trap cleanup EXIT

notify_failure() {
  local reason="$1"
  curl -fsS --max-time 30 \
    --data-urlencode "chat_id=${TELEGRAM_BACKUP_CHAT_ID}" \
    --data-urlencode "text=⚠️ megamall-crm DB backup FAILED (${timestamp} UTC): ${reason}" \
    "${TELEGRAM_API}/sendMessage" >/dev/null || true
}
trap 'notify_failure "unexpected error at line $LINENO"' ERR

# TimeZone is a GORM-only DSN param, not a real libpq keyword — pg_dump
# rejects it as an invalid connection option, so strip it before use.
pg_conninfo="$(printf '%s' "$DB_DSN" | sed -E 's/[[:space:]]*TimeZone=[^[:space:]]*//')"

echo "→ Dumping database..."
pg_dump "$pg_conninfo" --format=custom --file="$tmp_file"

dump_size=$(stat -c%s "$tmp_file" 2>/dev/null || stat -f%z "$tmp_file")
echo "→ Dump size: ${dump_size} bytes"

mkdir -p "$BACKUP_DIR"
install -m 0600 "$tmp_file" "${BACKUP_DIR}/${dump_name}"

if (( dump_size > TELEGRAM_MAX_BYTES )); then
  notify_failure "dump is ${dump_size} bytes, over Telegram's 50MB upload limit — kept locally at ${BACKUP_DIR}/${dump_name} only"
  echo "Dump exceeds Telegram's upload limit; kept local copy only." >&2
  exit 1
fi

echo "→ Sending to Telegram..."
response="$(curl -fsS --max-time 120 \
  -F "chat_id=${TELEGRAM_BACKUP_CHAT_ID}" \
  -F "caption=megamall-crm DB backup — ${timestamp} UTC (${dump_size} bytes)" \
  -F "document=@${BACKUP_DIR}/${dump_name};filename=${dump_name}" \
  "${TELEGRAM_API}/sendDocument")"

if ! grep -q '"ok":true' <<<"$response"; then
  notify_failure "Telegram sendDocument rejected the upload: ${response}"
  echo "Telegram upload failed: ${response}" >&2
  exit 1
fi

echo "→ Pruning local backups older than the last ${BACKUP_KEEP}..."
# shellcheck disable=SC2012
ls -1t "${BACKUP_DIR}"/megamall_crm_*.dump 2>/dev/null | tail -n "+$((BACKUP_KEEP + 1))" | while read -r old; do
  rm -f -- "$old"
done

echo "✅ Backup complete: ${dump_name}"
