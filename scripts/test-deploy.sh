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
  is-active|restart|status) exit 0 ;;
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

chmod 0755 "$MOCK_BIN/systemctl" "$MOCK_BIN/curl" "$MOCK_BIN/flock"

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
  PATH="$MOCK_BIN:$PATH" \
  TEST_PROJECT="$PROJECT" \
  PROJECT="$PROJECT" \
  LOCK_FILE="$TEST_ROOT/deploy.lock" \
  HEALTH_ATTEMPTS=1 \
  HEALTH_DELAY=0 \
    bash "$REPOSITORY/deploy.sh" "$revision" "$artifact"
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
