#!/usr/bin/env bash
# Runs ON THE PRODUCTION SERVER via `.github/workflows/setup-https.yml`
# (piped over SSH as stdin — never executed locally). Expects MODE, DOMAIN,
# and FRONTEND_ROOT in the environment.
set -Eeuo pipefail

: "${MODE:?MODE must be set (diagnose or apply)}"
: "${DOMAIN:?DOMAIN must be set}"
: "${FRONTEND_ROOT:?FRONTEND_ROOT must be set}"

diagnose() {
  echo "== whoami / sudo -l =="
  whoami
  sudo -n -l || echo "(sudo -l failed or requires a password -- non-fatal, continuing)"

  echo
  echo "== nginx installed? =="
  command -v nginx && nginx -v 2>&1 || echo "nginx not found"

  echo
  echo "== certbot installed? =="
  command -v certbot && certbot --version || echo "certbot not found"

  echo
  echo "== nginx sites-enabled =="
  sudo -n ls -la /etc/nginx/sites-enabled/ 2>&1 || ls -la /etc/nginx/sites-enabled/ 2>&1 || true

  echo
  echo "== nginx sites-available configs (contents) =="
  for f in /etc/nginx/sites-available/*; do
    echo "--- $f ---"
    sudo -n cat "$f" 2>&1 || cat "$f" 2>&1 || true
  done

  echo
  echo "== existing TLS certs =="
  sudo -n ls -la /etc/letsencrypt/live/ 2>&1 || echo "none / no permission"

  echo
  echo "== frontend root exists? =="
  ls -la "$FRONTEND_ROOT" 2>&1 || true
}

apply() {
  if ! command -v nginx >/dev/null; then
    sudo -n apt-get update
    sudo -n apt-get install -y nginx
  fi

  if ! command -v certbot >/dev/null; then
    sudo -n apt-get install -y certbot python3-certbot-nginx
  fi

  local site_conf=/etc/nginx/sites-available/megamall-crm
  sudo -n tee "$site_conf" >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    root ${FRONTEND_ROOT};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    # Media pipeline delivery routes (product images, avatars, etc.) —
    # registered by internal/media at the router root, outside /api/v1
    # (see internal/media/routes.go: RegisterDeliveryRoutes). Without this,
    # /media/public/... falls through to location / and is served the SPA's
    # index.html instead of the actual image.
    location /media/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    # Legacy /uploads/:filename delivery (receipt proofs, attachments
    # predating the media pipeline) — same "falls through to the SPA"
    # problem as /media/ above.
    location /uploads/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
NGINX

  sudo -n ln -sf "$site_conf" /etc/nginx/sites-enabled/megamall-crm
  sudo -n nginx -t
  sudo -n systemctl reload nginx

  sudo -n certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --redirect --agree-tos \
    -m mahmadnazaralif@gmail.com --non-interactive || \
  sudo -n certbot --nginx -d "$DOMAIN" --redirect --agree-tos \
    -m mahmadnazaralif@gmail.com --non-interactive

  sudo -n nginx -t
  sudo -n systemctl reload nginx

  echo "HTTPS setup complete."
}

case "$MODE" in
  diagnose) diagnose ;;
  apply) apply ;;
  *) echo "Unknown MODE: $MODE" >&2; exit 1 ;;
esac
