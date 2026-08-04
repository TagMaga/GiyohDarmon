# Database backups → Telegram

The production Postgres database is dumped and sent to a Telegram chat twice
a day (01:00 and 13:00 UTC) as a disaster-recovery copy. If production data
is ever lost or corrupted, restore from the most recent `.dump` file posted
in that chat.

## How it works

- `megamall-crm/scripts/backup_db_telegram.sh` — runs `pg_dump --format=custom`
  against `DB_DSN` (from `.env`), uploads the result to Telegram via
  `sendDocument`, keeps the last `BACKUP_KEEP` (default 14) copies locally
  under `/var/backups/megamall-crm`, and posts a Telegram text alert if the
  dump fails or exceeds Telegram's 50MB bot upload limit.
- A systemd timer (`megamall-crm-backup.timer`) runs that script at 01:00 and
  13:00 UTC. It's installed by `scripts/setup_backup_remote.sh`, run on the
  server via the `setup-db-backup.yml` GitHub Actions workflow — the same
  pattern `setup-https.yml` uses for the nginx/TLS setup.
- This is independent of the app process: it runs even if the API server is
  down, as long as Postgres itself is up.

## One-time setup

1. **Create a dedicated Telegram bot** via [@BotFather](https://t.me/BotFather)
   (don't reuse the budget-approval bot — keep backup access separate) and
   note its token.
2. **Get the target chat ID** — add the bot to the chat that should receive
   backups and fetch the chat ID (e.g. via `getUpdates` on the bot token, or
   any of the standard "get my chat id" bots).
3. On the production server, add to `megamall-crm/.env`:
   ```
   TELEGRAM_BACKUP_BOT_TOKEN=<bot token>
   TELEGRAM_BACKUP_CHAT_ID=<chat id>
   ```
4. Run the **"Set up database backup-to-Telegram timer"** workflow
   (`workflow_dispatch`) with `mode=diagnose` first to confirm `pg_dump`,
   `curl`, and the `.env` vars are all in place, then run it again with
   `mode=apply` to install and enable the timer.

## Verifying

```bash
# On the server
sudo systemctl list-timers megamall-crm-backup.timer
sudo systemctl status megamall-crm-backup.service
sudo journalctl -u megamall-crm-backup.service -n 50

# Or trigger a backup immediately, out of schedule
sudo systemctl start megamall-crm-backup.service
```

A successful run posts the `.dump` file to the configured Telegram chat with
a caption showing current row totals (`orders`, `users`, `products` —
excluding soft-deleted rows), the file size, and the timestamp, so
whoever's watching that chat can eyeball "does this look like a normal day"
without opening the dump.

The caption's timestamp is rendered in `Asia/Dushanbe` (override with
`BACKUP_DISPLAY_TZ`) so it matches the clock of whoever is reading the chat —
it previously printed UTC, which read five hours behind. The **filename**
(`megamall_crm_20260804T062400Z.dump`) stays UTC, where the explicit `Z`
suffix keeps it unambiguous and lexically sortable. So a dump whose filename
says `T062400Z` is captioned `11:24`; both describe the same moment. A failed run posts a "⚠️ ..." text alert to the
same chat instead. All operator-facing text is in Russian, matching the
rest of the product.

## Restoring from a backup

```bash
# Download the .dump file from Telegram onto the target machine, then:
pg_restore --clean --if-exists -d "<DB_DSN as a psql-style connection string>" backup_file.dump
```

`--clean --if-exists` drops existing objects before recreating them, so this
is destructive to whatever's currently in the target database — always
restore into a fresh/empty database (or one you intend to fully overwrite),
never directly onto a database with data you still need.

## Growing past Telegram's 50MB limit

Telegram bots cannot upload files over 50MB. When the dump crosses that
(check the byte size in each backup's caption), `backup_db_telegram.sh` will
start failing with a text alert instead of silently truncating anything —
the local copy under `/var/backups/megamall-crm` is still written first, so
nothing is lost, but the offsite (Telegram) copy stops arriving. At that
point, switch the offsite leg to object storage (S3/B2/etc.) and use
Telegram only for a pass/fail notification.
