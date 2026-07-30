#!/usr/bin/env bash
# Runs ON THE PRODUCTION SERVER via `.github/workflows/setup-db-backup.yml`
# (piped over SSH as stdin — never executed locally). Expects MODE and
# PROJECT in the environment. Installs a systemd service + timer that runs
# megamall-crm/scripts/backup_db_telegram.sh twice a day (01:00 and 13:00
# UTC) to send a DB dump to Telegram for disaster recovery.
set -Eeuo pipefail

: "${MODE:?MODE must be set (diagnose or apply)}"
: "${PROJECT:?PROJECT must be set}"

BACKEND_DIR="$PROJECT/megamall-crm"
SERVICE_FILE=/etc/systemd/system/megamall-crm-backup.service
TIMER_FILE=/etc/systemd/system/megamall-crm-backup.timer

diagnose() {
  echo "== pg_dump / curl available? =="
  command -v pg_dump && pg_dump --version || echo "pg_dump not found"
  command -v curl && curl --version | head -1 || echo "curl not found"

  echo
  echo "== backup script present? =="
  ls -la "$BACKEND_DIR/scripts/backup_db_telegram.sh" 2>&1 || true

  echo
  echo "== .env has the backup Telegram vars? (names only, no values) =="
  grep -o '^TELEGRAM_BACKUP_[A-Z_]*=' "$BACKEND_DIR/.env" 2>&1 || echo "not found in .env"

  echo
  echo "== existing units =="
  sudo -n systemctl status megamall-crm-backup.timer 2>&1 || true
  sudo -n systemctl list-timers megamall-crm-backup.timer 2>&1 || true
}

apply() {
  if ! grep -q '^TELEGRAM_BACKUP_BOT_TOKEN=' "$BACKEND_DIR/.env" 2>/dev/null || \
     ! grep -q '^TELEGRAM_BACKUP_CHAT_ID=' "$BACKEND_DIR/.env" 2>/dev/null; then
    echo "REFUSING: $BACKEND_DIR/.env is missing TELEGRAM_BACKUP_BOT_TOKEN and/or TELEGRAM_BACKUP_CHAT_ID." >&2
    echo "Add both (see .env.example) before running apply." >&2
    exit 1
  fi

  sudo -n install -d -m 0700 /var/backups/megamall-crm

  sudo -n tee "$SERVICE_FILE" >/dev/null <<SERVICE
[Unit]
Description=megamall-crm database backup to Telegram
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${BACKEND_DIR}
EnvironmentFile=${BACKEND_DIR}/.env
ExecStart=${BACKEND_DIR}/scripts/backup_db_telegram.sh
# Runs as the same user the app runs as (not root) — reads only .env and
# writes only to /var/backups/megamall-crm.
User=deploy
Group=deploy
SERVICE

  sudo -n tee "$TIMER_FILE" >/dev/null <<TIMER
[Unit]
Description=Run megamall-crm database backup twice daily (01:00 and 13:00 UTC)

[Timer]
OnCalendar=*-*-* 01:00:00 UTC
OnCalendar=*-*-* 13:00:00 UTC
# Catch up on the next boot if the server was down at a scheduled time.
Persistent=true

[Install]
WantedBy=timers.target
TIMER

  sudo -n chown deploy:deploy /var/backups/megamall-crm
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable --now megamall-crm-backup.timer

  echo "Backup timer installed."
  sudo -n systemctl list-timers megamall-crm-backup.timer
}

case "$MODE" in
  diagnose) diagnose ;;
  apply) apply ;;
  *) echo "Unknown MODE: $MODE" >&2; exit 1 ;;
esac
