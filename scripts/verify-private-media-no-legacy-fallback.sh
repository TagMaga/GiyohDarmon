#!/usr/bin/env bash
# Regression guard for the private-media security model:
#
#   - Only PUBLIC categories (currently just product_image) may fall back
#     to the legacy, unauthenticated /uploads endpoint.
#   - PRIVATE categories (avatar, order_attachment, prepayment_proof,
#     cash_handover_proof, user_document) must NEVER be newly uploaded
#     through that endpoint, in web-admin or the courier mobile app. If the
#     secure media pipeline is unavailable, private uploads must throw/show
#     a clear error and stop.
#
# Incident this guards against (2026-07-18): shared/api/mediaUpload.js's
# smartUpload (and its per-app mobile/legacy-avatar equivalents) treated
# ANY POST /media 404 as "pipeline disabled, fall back to legacy" without
# distinguishing category — every private category ended up able to fall
# back to public, unauthenticated storage, and HR/passport .doc/.docx
# documents did so unconditionally, by design, regardless of pipeline
# state. This is the same class of exposure as the 2026-07-16 P0 incident
# (a private order attachment leaked through /uploads; see
# /root/megamall-audits/megamall-p0-stage1-containment-report-20260716.md
# on the production host) — that incident is why the media pipeline was
# built in the first place, so this is a hard regression to keep closed.
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

WEB_SRC="megamall-crm/web-admin/src"
MOBILE_DIR="mobile/courier-app"

fail() { echo "FAIL: $*" >&2; exit 1; }

PRIVATE_CATEGORIES='avatar|order_attachment|prepayment_proof|cash_handover_proof|user_document'

# 1. smartUpload (shared/api/mediaUpload.js) — the generic PUBLIC-only
#    helper — must never be called with a private-category literal.
if grep -rnE "smartUpload\([^)]*'(${PRIVATE_CATEGORIES})'" "$WEB_SRC" --include='*.js' --include='*.jsx'; then
  fail "smartUpload() called with a private-category literal above — private categories must call uploadToMedia directly and propagate errors (never fall back to legacy /uploads)"
fi

# 2. uploadFileLegacy (shared/api/legacyUpload.js) has zero legitimate
#    callers today (product_image uses its own bespoke implementation in
#    warehouse/api.js, not this shared helper) — it must not be imported
#    by any of the private-category call sites fixed in this incident.
PRIVATE_FILES=(
  "$WEB_SRC/features/seller/api.js"
  "$WEB_SRC/features/people/api.js"
  "$WEB_SRC/features/people/pages/TeamDirectoryPage.jsx"
  "$WEB_SRC/features/dispatcher/api.js"
  "$WEB_SRC/features/seller/pages/CreateOrder.jsx"
)
for f in "${PRIVATE_FILES[@]}"; do
  [ -f "$f" ] || fail "expected file $f does not exist — update this script if it moved"
  if grep -qE "uploadFileLegacy|legacyUpload" "$f"; then
    fail "$f imports/references the legacy upload helper — private-category uploads must never use it"
  fi
done

# 3. Courier mobile app: cash-handover proofs (PRIVATE) must never call the
#    legacy /uploads endpoint. media.js should contain no reference to it
#    at all (securePrivateUpload only calls POST /media).
if grep -q "'/uploads'" "$MOBILE_DIR/src/api/media.js"; then
  fail "$MOBILE_DIR/src/api/media.js still references the legacy /uploads endpoint"
fi
if grep -rn "uploadFileLegacy" "$MOBILE_DIR/src" "$MOBILE_DIR/app" 2>/dev/null; then
  fail "the courier mobile app still references uploadFileLegacy above — cash-handover proofs are a private category"
fi

echo "OK: no private category can fall back to the legacy /uploads endpoint"
