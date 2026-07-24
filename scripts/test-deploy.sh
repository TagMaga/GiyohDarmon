#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

PROJECT="$TEST_ROOT/project"
MOCK_BIN="$TEST_ROOT/bin"
mkdir -p \
  "$MOCK_BIN" \
  "$PROJECT/megamall-crm/tmp" \
  "$PROJECT/megamall-crm/web-admin/dist"

printf 'old-backend\n' > "$PROJECT/megamall-crm/tmp/megamall-crm"
chmod 0755 "$PROJECT/megamall-crm/tmp/megamall-crm"
printf 'old-frontend\n' > "$PROJECT/megamall-crm/web-admin/dist/index.html"

cat > "$MOCK_BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  is-active|restart|status|reload) exit 0 ;;
  *) exit 1 ;;
esac
EOF

cat > "$MOCK_BIN/curl" <<'EOF'
#!/usr/bin/env bash
if grep -q 'unhealthy-backend' "$TEST_PROJECT/megamall-crm/tmp/megamall-crm"; then
  exit 22
fi
exit 0
EOF

cat > "$MOCK_BIN/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat > "$MOCK_BIN/nginx" <<'EOF'
#!/usr/bin/env bash
# -t (config test) always "passes" for these tests — the config content
# itself is exercised directly via grep assertions below.
exit 0
EOF

chmod 0755 "$MOCK_BIN/systemctl" "$MOCK_BIN/curl" "$MOCK_BIN/flock" "$MOCK_BIN/nginx"

make_artifact() {
  local revision=$1
  local backend_content=$2
  local source_dir="$TEST_ROOT/source-$revision"
  local artifact="$TEST_ROOT/$revision.tar.gz"

  mkdir -p "$source_dir/frontend"
  printf '%s\n' "$revision" > "$source_dir/REVISION"
  printf '%s\n' "$backend_content" > "$source_dir/megamall-crm"
  chmod 0755 "$source_dir/megamall-crm"
  printf '%s\n' "frontend-$revision" > "$source_dir/frontend/index.html"
  tar -C "$source_dir" -czf "$artifact" .
  printf '%s\n' "$artifact"
}

run_deploy() {
  local revision=$1
  local artifact=$2
  local new_deploy_script=${3:-}
  PATH="$MOCK_BIN:$PATH" \
  TEST_PROJECT="$PROJECT" \
  PROJECT="$PROJECT" \
  LOCK_FILE="$TEST_ROOT/deploy.lock" \
  HEALTH_ATTEMPTS=1 \
  HEALTH_DELAY=0 \
  NGINX_SITE_CONF="${NGINX_SITE_CONF:-$TEST_ROOT/nginx-site-conf-missing}" \
    bash "$REPOSITORY/deploy.sh" "$revision" "$artifact" "$new_deploy_script"
}

GOOD_REVISION=1111111111111111111111111111111111111111
GOOD_ARTIFACT=$(make_artifact "$GOOD_REVISION" healthy-backend)
run_deploy "$GOOD_REVISION" "$GOOD_ARTIFACT"
grep -q 'healthy-backend' "$PROJECT/megamall-crm/tmp/megamall-crm"
grep -q "frontend-$GOOD_REVISION" "$PROJECT/megamall-crm/web-admin/dist/index.html"
grep -q "$GOOD_REVISION" "$PROJECT/releases/CURRENT"

BAD_REVISION=2222222222222222222222222222222222222222
BAD_ARTIFACT=$(make_artifact "$BAD_REVISION" unhealthy-backend)
if run_deploy "$BAD_REVISION" "$BAD_ARTIFACT"; then
  echo "Expected unhealthy deployment to fail" >&2
  exit 1
fi

grep -q 'healthy-backend' "$PROJECT/megamall-crm/tmp/megamall-crm"
grep -q "frontend-$GOOD_REVISION" "$PROJECT/megamall-crm/web-admin/dist/index.html"

echo "Deployment success and rollback tests passed"

# ── sync_nginx_media_routes: idempotent nginx patching ──────────────────────
# Mimics a real already-provisioned site file (location / + location /api/,
# the shape scripts/setup_https_remote.sh's pre-fix template produced) to
# prove deploy.sh adds the missing /media and /uploads locations exactly
# once, without disturbing the rest of the file.
NGINX_FIXTURE="$TEST_ROOT/nginx-site-conf"
cat > "$NGINX_FIXTURE" <<'EOF'
server {
    server_name example.tj www.example.tj;

    root /var/www/megamall-crm/megamall-crm/web-admin/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    listen 443 ssl; # managed by Certbot
}
EOF

NGINX_REVISION=3333333333333333333333333333333333333333
NGINX_ARTIFACT=$(make_artifact "$NGINX_REVISION" healthy-backend)
NGINX_SITE_CONF="$NGINX_FIXTURE" run_deploy "$NGINX_REVISION" "$NGINX_ARTIFACT"

grep -q 'location /media/ {' "$NGINX_FIXTURE"
grep -q 'location /uploads/ {' "$NGINX_FIXTURE"
grep -q 'listen 443 ssl; # managed by Certbot' "$NGINX_FIXTURE"
[[ "$(grep -c 'location /api/ {' "$NGINX_FIXTURE")" -eq 1 ]]

# Re-deploying must not duplicate the blocks it already added.
NGINX_REVISION2=4444444444444444444444444444444444444444
NGINX_ARTIFACT2=$(make_artifact "$NGINX_REVISION2" healthy-backend)
NGINX_SITE_CONF="$NGINX_FIXTURE" run_deploy "$NGINX_REVISION2" "$NGINX_ARTIFACT2"

[[ "$(grep -c 'location /media/ {' "$NGINX_FIXTURE")" -eq 1 ]]
[[ "$(grep -c 'location /uploads/ {' "$NGINX_FIXTURE")" -eq 1 ]]

echo "nginx media/uploads proxy sync tests passed"

# ── Self-update: deploy.sh installs a newer copy of itself ──────────────────
# Proves the $3/NEW_DEPLOY_SCRIPT handling deploy.yml relies on to ever get
# a new deploy.sh onto the server at all (see deploy.sh's top-of-file
# comment on why this exists): the staged copy lands at $PROJECT/deploy.sh
# and the staged file itself is cleaned up, even though this run otherwise
# keeps executing the original (already-loaded) script's logic throughout.
SELFUPDATE_STAGED="$TEST_ROOT/staged-deploy.sh"
printf '#!/usr/bin/env bash\necho "this is the new deploy.sh"\n' > "$SELFUPDATE_STAGED"

SELFUPDATE_REVISION=5555555555555555555555555555555555555555
SELFUPDATE_ARTIFACT=$(make_artifact "$SELFUPDATE_REVISION" healthy-backend)
run_deploy "$SELFUPDATE_REVISION" "$SELFUPDATE_ARTIFACT" "$SELFUPDATE_STAGED"

grep -q 'this is the new deploy.sh' "$PROJECT/deploy.sh"
[[ -x "$PROJECT/deploy.sh" ]]
[[ ! -e "$SELFUPDATE_STAGED" ]]

echo "deploy.sh self-update test passed"
