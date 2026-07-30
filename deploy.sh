#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

PROJECT=${PROJECT:-/var/www/megamall-crm}
BACKEND_LIVE="$PROJECT/megamall-crm/tmp/megamall-crm"
FRONTEND_LIVE="$PROJECT/megamall-crm/web-admin/dist"
RELEASES="$PROJECT/releases"
LOCK_FILE=${LOCK_FILE:-/var/lock/megamall-crm-deploy.lock}
SERVICE=${SERVICE:-megamall-crm.service}
HEALTH_ATTEMPTS=${HEALTH_ATTEMPTS:-30}
HEALTH_DELAY=${HEALTH_DELAY:-1}
# Public hostname nginx serves — used to health-check through nginx itself
# (not just the backend directly). Port 80 for this host redirects to HTTPS
# (Certbot-managed) and 404s everything else, so the check must go over
# HTTPS; --resolve pins the connection to loopback while still using the
# real hostname for the Host header, TLS SNI, and certificate validation.
DOMAIN=${DOMAIN:-giyohdarmon.tj}
# The nginx site file scripts/setup_https_remote.sh creates. This script
# does NOT create it from scratch (that one-time bootstrap, including the
# Certbot-issued SSL directives, stays that script's job) — it only patches
# an already-provisioned file that's missing the /media and /uploads
# proxy locations, so every deploy self-heals the gap those routes' absence
# left in production (see "Syncing nginx" step below). If the file doesn't
# exist yet, that step is a no-op.
NGINX_SITE_CONF=${NGINX_SITE_CONF:-/etc/nginx/sites-available/megamall-crm}

# install-backup-timer: installs/refreshes the megamall-crm-backup systemd
# service+timer (pg_dump -> Telegram, see megamall-crm/docs/DB_BACKUPS.md)
# and returns immediately, bypassing the ordinary release flow below. This
# lives here, not in a standalone remote script, because deploy.sh is the
# ONLY command the deploy account's sudoers NOPASSWD grant covers
# ((root) NOPASSWD: /var/www/megamall-crm/deploy.sh *) — every other sudo
# invocation on this host requires an interactive password, so nothing else
# run over SSH from Actions can write to /etc/systemd/system or reload
# systemd. Invoked as:
#   sudo --non-interactive /var/www/megamall-crm/deploy.sh \
#     install-backup-timer /tmp/<uploaded>-backup_db_telegram.sh
# by .github/workflows/setup-db-backup.yml, which scp's the script to /tmp
# first (unprivileged, same as deploy.sh's own self-update mechanism below).
if [[ "${1:-}" == "install-backup-timer" ]]; then
  STAGED_BACKUP_SCRIPT=${2:-}
  BACKUP_SCRIPT_LIVE="$PROJECT/megamall-crm/scripts/backup_db_telegram.sh"
  BACKUP_ENV_FILE="$PROJECT/megamall-crm/.env"
  BACKUP_DIR=/var/backups/megamall-crm
  BACKUP_SERVICE_FILE=/etc/systemd/system/megamall-crm-backup.service
  BACKUP_TIMER_FILE=/etc/systemd/system/megamall-crm-backup.timer

  if [[ -z "$STAGED_BACKUP_SCRIPT" || ! -f "$STAGED_BACKUP_SCRIPT" ]]; then
    echo "install-backup-timer: staged script path missing or not found: $STAGED_BACKUP_SCRIPT" >&2
    exit 2
  fi
  if ! grep -q '^TELEGRAM_BACKUP_BOT_TOKEN=.' "$BACKUP_ENV_FILE" || \
     ! grep -q '^TELEGRAM_BACKUP_CHAT_ID=.' "$BACKUP_ENV_FILE"; then
    echo "install-backup-timer: $BACKUP_ENV_FILE is missing TELEGRAM_BACKUP_BOT_TOKEN and/or TELEGRAM_BACKUP_CHAT_ID (see .env.example)" >&2
    exit 2
  fi

  mkdir -p "$(dirname "$BACKUP_SCRIPT_LIVE")"
  install -m 0755 -o megamall -g megamall "$STAGED_BACKUP_SCRIPT" "$BACKUP_SCRIPT_LIVE"
  rm -f "$STAGED_BACKUP_SCRIPT"

  install -d -m 0700 -o megamall -g megamall "$BACKUP_DIR"

  cat > "$BACKUP_SERVICE_FILE" <<SERVICE
[Unit]
Description=megamall-crm database backup to Telegram
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$PROJECT/megamall-crm
EnvironmentFile=$BACKUP_ENV_FILE
ExecStart=$BACKUP_SCRIPT_LIVE
User=megamall
Group=megamall
SERVICE

  cat > "$BACKUP_TIMER_FILE" <<TIMER
[Unit]
Description=Run megamall-crm database backup twice daily (01:00 and 13:00 UTC)

[Timer]
OnCalendar=*-*-* 01:00:00 UTC
OnCalendar=*-*-* 13:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
TIMER

  systemctl daemon-reload
  systemctl enable --now megamall-crm-backup.timer
  echo "Backup timer installed."
  systemctl list-timers megamall-crm-backup.timer --no-pager
  exit 0
fi

REVISION=${1:-}
ARTIFACT=${2:-}
NEW_DEPLOY_SCRIPT=${3:-}

# Self-update: deploy.yml uploads the repo's current deploy.sh to /tmp/
# alongside the release artifact (the same unprivileged scp the tarball
# already uses — deploy.yml never touches $PROJECT directly) and passes
# its path here as $3. This is the only way $PROJECT/deploy.sh can ever
# change: the deploy account's one passwordless-sudo grant is scoped to
# the exact literal command `$PROJECT/deploy.sh <anything>`, so nothing
# else running on the server can overwrite that file, and there's no
# separate mechanism that syncs it. Runs first, unconditionally, using
# the root privilege this whole script already has from that same sudo
# call — no new grant needed. A bad self-update can't wedge the pipeline:
# this process keeps running the old (already-loaded) code for the rest
# of this deploy regardless of what's now on disk; only the *next*
# invocation picks up the new file.
if [[ -n "$NEW_DEPLOY_SCRIPT" && -f "$NEW_DEPLOY_SCRIPT" ]]; then
  install -m 0755 "$NEW_DEPLOY_SCRIPT" "$PROJECT/deploy.sh"
  rm -f "$NEW_DEPLOY_SCRIPT"
fi

if [[ ! "$REVISION" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Deployment revision must be a full 40-character Git commit SHA" >&2
  exit 2
fi

if [[ -z "$ARTIFACT" || ! -f "$ARTIFACT" ]]; then
  echo "Deployment artifact does not exist: $ARTIFACT" >&2
  exit 2
fi

mkdir -p "$RELEASES"
exec 9>"$LOCK_FILE"
if ! flock -w 30 9; then
  echo "Another deployment is already running" >&2
  exit 3
fi

STAGE=$(mktemp -d "$RELEASES/.stage-${REVISION}.XXXXXX")
BACKUP=$(mktemp -d "$RELEASES/rollback-${REVISION}.XXXXXX")
FRONTEND_NEXT="$PROJECT/megamall-crm/web-admin/.dist-${REVISION}"
DEPLOY_STARTED=0

cleanup() {
  rm -rf "$STAGE" "$FRONTEND_NEXT"
}

wait_for_health() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if systemctl is-active --quiet "$SERVICE" \
      && curl --fail --silent --show-error --max-time 3 \
        http://127.0.0.1:8080/api/v1/ready >/dev/null \
      && curl --fail --silent --show-error --max-time 3 \
        --resolve "$DOMAIN:443:127.0.0.1" \
        "https://$DOMAIN/api/v1/ready" >/dev/null \
      && curl --fail --silent --show-error --max-time 3 \
        --resolve "$DOMAIN:443:127.0.0.1" \
        "https://$DOMAIN/" >/dev/null; then
      return 0
    fi
    sleep "$HEALTH_DELAY"
  done
  return 1
}

# sync_nginx_media_routes idempotently patches NGINX_SITE_CONF to add the
# /media/ and /uploads/ proxy locations if they're missing, then validates
# and reloads nginx. internal/media serves product images etc. at
# /media/public|private/:key and the legacy uploader serves /uploads/:file,
# both registered at the Go router root, outside /api/v1 (see
# internal/media/routes.go and cmd/server/main.go) — nginx must proxy them
# separately from the existing /api/ location or they fall through to the
# SPA's index.html instead of reaching the backend. Backs up the file
# first and restores it if `nginx -t` rejects the patched config, so a
# malformed result never gets reloaded into the running nginx.
sync_nginx_media_routes() {
  if [[ ! -f "$NGINX_SITE_CONF" ]]; then
    echo "  $NGINX_SITE_CONF not found — nginx not provisioned yet, skipping"
    return 0
  fi
  if grep -qF 'location /media/ {' "$NGINX_SITE_CONF"; then
    echo "  already present — skipping"
    return 0
  fi

  local nginx_backup="$BACKUP/nginx-site-conf"
  cp -a "$NGINX_SITE_CONF" "$nginx_backup"

  local insert_file
  insert_file=$(mktemp)
  cat > "$insert_file" <<'NGINX_BLOCK'

    # Media pipeline delivery routes (product images, avatars, etc.) —
    # registered by internal/media at the router root, outside /api/v1
    # (see internal/media/routes.go: RegisterDeliveryRoutes).
    location /media/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Legacy /uploads/:filename delivery (receipt proofs, attachments
    # predating the media pipeline) — same "falls through to the SPA"
    # problem as /media/ above.
    location /uploads/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
NGINX_BLOCK

  awk -v insfile="$insert_file" '
    /^    location \/api\/ \{$/ { in_api = 1 }
    { print }
    in_api && /^    \}$/ {
      while ((getline line < insfile) > 0) print line
      close(insfile)
      in_api = 0
    }
  ' "$NGINX_SITE_CONF" > "$NGINX_SITE_CONF.new"
  rm -f "$insert_file"
  mv "$NGINX_SITE_CONF.new" "$NGINX_SITE_CONF"

  if nginx -t; then
    systemctl reload nginx
    echo "  added /media and /uploads proxy locations"
  else
    echo "nginx config test failed after adding /media,/uploads locations; restoring previous config" >&2
    cp -a "$nginx_backup" "$NGINX_SITE_CONF"
    return 1
  fi
}

# sync_nginx_perf_config idempotently patches NGINX_SITE_CONF to add gzip
# compression and a cache-control policy for the SPA's hashed static assets,
# then validates and reloads nginx. Mirrors sync_nginx_media_routes above —
# same backup/validate/restore-on-failure shape — because this is the only
# way to update an already-provisioned server; scripts/setup_https_remote.sh's
# apply() only writes the file from scratch the first time a host is set up.
# Keep the gzip/location content identical between the two scripts.
sync_nginx_perf_config() {
  if [[ ! -f "$NGINX_SITE_CONF" ]]; then
    echo "  $NGINX_SITE_CONF not found — nginx not provisioned yet, skipping"
    return 0
  fi
  if grep -qF 'location /assets/ {' "$NGINX_SITE_CONF"; then
    echo "  already present — skipping"
    return 0
  fi

  local nginx_backup="$BACKUP/nginx-site-conf-perf"
  cp -a "$NGINX_SITE_CONF" "$nginx_backup"

  local gzip_file assets_file
  gzip_file=$(mktemp)
  cat > "$gzip_file" <<'NGINX_BLOCK'

    # Compress text-based responses (JS/CSS/JSON/SVG/HTML). Already-compressed
    # formats (images, video, fonts in woff2) are left alone — recompressing
    # them wastes CPU for zero size benefit.
    gzip on;
    gzip_vary on;
    gzip_comp_level 6;
    gzip_min_length 256;
    gzip_proxied any;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml
        application/xml+rss
        application/vnd.ms-fontobject
        image/svg+xml
        font/ttf
        font/otf;

    # Vite emits every JS/CSS/image asset with a content hash in the
    # filename (dist/assets/*-<hash>.js), so it is safe to cache these
    # forever — a new deploy always ships new filenames, never mutates an
    # old one in place.
    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }
NGINX_BLOCK

  assets_file=$(mktemp)
  cat > "$assets_file" <<'NGINX_BLOCK'
        # index.html (and the SPA fallback that serves it for client-side
        # routes) is NOT hashed and must always be revalidated so a deploy
        # is picked up immediately instead of being served stale from cache.
        add_header Cache-Control "no-cache" always;
NGINX_BLOCK

  awk -v gzipfile="$gzip_file" -v assetsfile="$assets_file" '
    /^    index index\.html;$/ {
      print
      while ((getline line < gzipfile) > 0) print line
      close(gzipfile)
      next
    }
    /^    location \/ \{$/ { in_root = 1 }
    { print }
    in_root && /^    \}$/ {
      # insert before the closing brace we just printed
    }
    in_root && /try_files \$uri \$uri\/ \/index\.html;$/ {
      while ((getline line < assetsfile) > 0) print line
      close(assetsfile)
      in_root = 0
    }
  ' "$NGINX_SITE_CONF" > "$NGINX_SITE_CONF.new"
  rm -f "$gzip_file" "$assets_file"
  mv "$NGINX_SITE_CONF.new" "$NGINX_SITE_CONF"

  if nginx -t; then
    systemctl reload nginx
    echo "  added gzip compression and asset cache-control headers"
  else
    echo "nginx config test failed after adding perf config; restoring previous config" >&2
    cp -a "$nginx_backup" "$NGINX_SITE_CONF"
    return 1
  fi
}

rollback() {
  local failed_status=$?
  trap - ERR
  set +e

  if (( DEPLOY_STARTED == 1 )); then
    echo "Deployment failed; restoring the previous release" >&2

    if [[ -f "$BACKUP/megamall-crm" ]]; then
      install -m 0755 "$BACKUP/megamall-crm" "${BACKEND_LIVE}.rollback"
      mv -f "${BACKEND_LIVE}.rollback" "$BACKEND_LIVE"
    fi

    if [[ -d "$BACKUP/frontend" ]]; then
      if [[ -e "$FRONTEND_LIVE" ]]; then
        mv "$FRONTEND_LIVE" "$BACKUP/failed-frontend"
      fi
      mv "$BACKUP/frontend" "$FRONTEND_LIVE"
    fi

    systemctl restart "$SERVICE"
    if wait_for_health; then
      echo "Previous release restored successfully" >&2
    else
      echo "CRITICAL: rollback completed but health checks still fail" >&2
      systemctl status "$SERVICE" --no-pager -l >&2
    fi
  fi

  exit "$failed_status"
}

trap cleanup EXIT
trap rollback ERR

echo "1/7 - Validating release $REVISION"
if tar -tzf "$ARTIFACT" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Artifact contains an unsafe path" >&2
  exit 4
fi
tar -xzf "$ARTIFACT" --no-same-owner -C "$STAGE"

test -f "$STAGE/REVISION"
test "$(tr -d '\r\n' < "$STAGE/REVISION")" = "$REVISION"
test -f "$STAGE/megamall-crm"
test -f "$STAGE/frontend/index.html"
chmod 0755 "$STAGE/megamall-crm"

echo "2/7 - Preparing rollback copy"
mkdir -p "$(dirname "$BACKEND_LIVE")" "$(dirname "$FRONTEND_LIVE")"
if [[ -f "$BACKEND_LIVE" ]]; then
  cp -a "$BACKEND_LIVE" "$BACKUP/megamall-crm"
fi

cp -a "$STAGE/frontend" "$FRONTEND_NEXT"
install -m 0755 "$STAGE/megamall-crm" "${BACKEND_LIVE}.next"

echo "3/7 - Switching frontend and backend artifacts"
DEPLOY_STARTED=1
if [[ -e "$FRONTEND_LIVE" ]]; then
  mv "$FRONTEND_LIVE" "$BACKUP/frontend"
fi
mv "$FRONTEND_NEXT" "$FRONTEND_LIVE"
mv -f "${BACKEND_LIVE}.next" "$BACKEND_LIVE"

echo "4/7 - Syncing nginx media/uploads proxy config"
sync_nginx_media_routes
sync_nginx_perf_config

echo "5/7 - Restarting backend"
systemctl restart "$SERVICE"

echo "6/7 - Checking application readiness"
wait_for_health

echo "7/7 - Recording successful release"
printf '%s\n' "$REVISION" > "$RELEASES/CURRENT"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$BACKUP/DEPLOYED_AT"
rm -f "$ARTIFACT"

DEPLOY_STARTED=0
echo "Deployment completed successfully: $REVISION"
