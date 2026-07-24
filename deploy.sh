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

REVISION=${1:-}
ARTIFACT=${2:-}

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

echo "5/7 - Restarting backend"
systemctl restart "$SERVICE"

echo "6/7 - Checking application readiness"
wait_for_health

echo "7/7 - Recording successful release"
printf '%s\n' "$REVISION" > "$RELEASES/CURRENT"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$BACKUP/DEPLOYED_AT"
rm -f "$ARTIFACT"

if [[ "$0" != "$PROJECT/deploy.sh" ]]; then
  install -m 0755 "$0" "$PROJECT/deploy.sh"
fi

DEPLOY_STARTED=0
echo "Deployment completed successfully: $REVISION"
