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
        http://127.0.0.1/api/v1/ready >/dev/null \
      && curl --fail --silent --show-error --max-time 3 \
        http://127.0.0.1/ >/dev/null; then
      return 0
    fi
    sleep "$HEALTH_DELAY"
  done
  return 1
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

echo "1/6 - Validating release $REVISION"
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

echo "2/6 - Preparing rollback copy"
mkdir -p "$(dirname "$BACKEND_LIVE")" "$(dirname "$FRONTEND_LIVE")"
if [[ -f "$BACKEND_LIVE" ]]; then
  cp -a "$BACKEND_LIVE" "$BACKUP/megamall-crm"
fi

cp -a "$STAGE/frontend" "$FRONTEND_NEXT"
install -m 0755 "$STAGE/megamall-crm" "${BACKEND_LIVE}.next"

echo "3/6 - Switching frontend and backend artifacts"
DEPLOY_STARTED=1
if [[ -e "$FRONTEND_LIVE" ]]; then
  mv "$FRONTEND_LIVE" "$BACKUP/frontend"
fi
mv "$FRONTEND_NEXT" "$FRONTEND_LIVE"
mv -f "${BACKEND_LIVE}.next" "$BACKEND_LIVE"

echo "4/6 - Restarting backend"
systemctl restart "$SERVICE"

echo "5/6 - Checking application readiness"
wait_for_health

echo "6/6 - Recording successful release"
printf '%s\n' "$REVISION" > "$RELEASES/CURRENT"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$BACKUP/DEPLOYED_AT"
rm -f "$ARTIFACT"

if [[ "$0" != "$PROJECT/deploy.sh" ]]; then
  install -m 0755 "$0" "$PROJECT/deploy.sh"
fi

DEPLOY_STARTED=0
echo "Deployment completed successfully: $REVISION"
