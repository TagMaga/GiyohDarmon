# Megamall CRM — Staging Launch Runbook

Copy-paste ready. Every command is verified against the actual project.

---

## 1. Prerequisites

| Tool | Minimum version | Install |
|------|----------------|---------|
| Go | 1.25 | https://go.dev/dl |
| Node.js | 22 | https://nodejs.org |
| PostgreSQL | 15 | https://postgresql.org/download |
| Goose | latest | `go install github.com/pressly/goose/v3/cmd/goose@latest` |
| nginx | 1.24+ | `apt install nginx` / `brew install nginx` |

Docker / Docker Compose are **optional** — they are only needed if you run the database or Redis via containers instead of a managed service. The application binary itself does not require Docker.

Verify your tools before starting:

```bash
go version
node --version
psql --version
goose --version
```

---

## 2. Environment Setup

```bash
cp .env.staging.example .env
```

Open `.env` and fill in every `CHANGE_ME` value. Required variables:

| Variable | Example | Notes |
|----------|---------|-------|
| `DB_DSN` | `host=db.example.com port=5432 user=megamall_app password=… dbname=megamall_crm_staging sslmode=require TimeZone=UTC` | Must use `sslmode=require` in staging/production |
| `JWT_ACCESS_SECRET` | *(generated below)* | Must be ≥ 32 chars, never reuse dev value |
| `JWT_REFRESH_SECRET` | *(generated below)* | Must differ from `JWT_ACCESS_SECRET` |
| `CORS_ORIGINS` | `https://staging.yourdomain.com` | No trailing slash, no wildcard |
| `GIN_MODE` | `release` | Disables debug output |
| `SEED_MODE` | `staging` | |
| `SEED_DEFAULT_PASSWORD` | *(chosen by you)* | Must not be `password123` |
| `SEED_OWNER_PASSWORD` | *(chosen by you)* | Must not be `password123`; defaults to `SEED_DEFAULT_PASSWORD` if omitted |

Generate secrets:

```bash
# Run twice — once for each secret
openssl rand -hex 64
```

Paste the two outputs into `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.

---

## 3. Database Setup

### 3a. Create the database

```bash
createdb megamall_crm_staging
```

Or, if connecting to a remote host:

```bash
createdb -h your-db-host -U postgres megamall_crm_staging
```

### 3b. Run all migrations

```bash
export DB_DSN="host=your-db-host port=5432 user=megamall_app password=YOUR_PW dbname=megamall_crm_staging sslmode=require TimeZone=UTC"

goose -dir ./migrations postgres "$DB_DSN" up
```

### 3c. Verify migration status

```bash
goose -dir ./migrations postgres "$DB_DSN" status
```

Expected output — the last applied migration must be version **38**:

```
Applied At                  | Migration
---------------------------------+------------------------------------------
...                         | 00038_add_composite_indexes.sql ✓
```

If any migration shows `Pending`, re-run `goose up`.

---

## 4. Seeding

**Staging** — seeds all 7 demo users (owner, team lead, manager, seller, dispatcher, warehouse manager, courier):

```bash
SEED_MODE=staging \
SEED_DEFAULT_PASSWORD='YourSecureP@ss1' \
SEED_OWNER_PASSWORD='0wnerSecureP@ss1' \
go run ./cmd/seed
```

**Production** — seeds the owner account only:

```bash
SEED_MODE=production \
SEED_OWNER_PASSWORD='0wnerSecureP@ss1' \
go run ./cmd/seed
```

**Rules the seeder enforces:**

- `password123` is rejected in staging and production — the command will fail with a clear error.
- In production mode, no team members, teams, or hierarchies are seeded. Only the owner account is created.
- The seeder is idempotent — safe to run multiple times. Existing accounts are skipped.

Demo phone numbers (staging only):

| Role | Phone |
|------|-------|
| owner | +992900000001 |
| sales_team_lead | +992900000002 |
| manager | +992900000003 |
| seller | +992900000004 |
| dispatcher | +992900000005 |
| warehouse_manager | +992900000006 |
| courier | +992900000007 |

---

## 5. Backend Build and Run

### 5a. Run tests

```bash
go test ./...
```

All packages must pass. The test suite covers pagination, rate limiting, CORS, seed config, and order logic.

### 5b. Build the binary

```bash
mkdir -p ./tmp
go build -o ./tmp/megamall-crm ./cmd/server
```

### 5c. Start the server

```bash
./tmp/megamall-crm
```

The server reads configuration from the `.env` file in the working directory (or environment variables). With `GIN_MODE=release` there is no debug route listing — that is expected.

### 5d. Verify health

```bash
# Lightweight ping — always 200 if the process is up
curl -s http://localhost:8080/api/v1/health | jq .

# Deep readiness — 200 only when all seed data is present
curl -s http://localhost:8080/api/v1/ready | jq .
```

Expected health response:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "database": "connected",
    "migration_version": "38",
    "timestamp": "2026-06-11T10:00:00Z"
  }
}
```

Expected ready response (all checks `true`):

```json
{
  "success": true,
  "data": {
    "ready": true,
    "checks": {
      "database": true,
      "owner_user": true,
      "default_warehouse": true,
      "default_product": true,
      "commission_configs": true,
      "commission_seller_rate": true,
      "commission_manager_team_rate": true,
      "commission_manager_personal_rate": true,
      "commission_team_lead_pool_rate": true,
      "commission_company_rate": true,
      "delivery_tariff": true
    }
  }
}
```

If `ready=false`, the failing check names pinpoint what is missing from seed data.

---

## 6. Frontend Build

```bash
cd web-admin
npm install
npm run build
```

Output is written to `web-admin/dist/`. This directory contains `index.html` and hashed JS/CSS chunks. The build produces ~17 chunks (main entry ≈ 25 KB / 7.4 KB gzip) due to route-level code splitting.

Verify the build succeeded:

```bash
ls web-admin/dist/
# Must contain: index.html  assets/
```

---

## 7. Reverse Proxy

### nginx

```nginx
# /etc/nginx/sites-available/megamall-crm

server {
    listen 80;
    server_name staging.yourdomain.com;
    # Redirect all HTTP to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name staging.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/staging.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/staging.yourdomain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Serve the React SPA
    root /var/www/megamall-crm/dist;
    index index.html;

    # SPA fallback — all non-file requests go to index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy all API calls to the backend
    location /api/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

Enable and reload:

```bash
ln -s /etc/nginx/sites-available/megamall-crm /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

Copy the built frontend:

```bash
rsync -av web-admin/dist/ /var/www/megamall-crm/dist/
```

### Caddy (alternative)

```caddyfile
staging.yourdomain.com {
    root * /var/www/megamall-crm/dist
    encode gzip

    handle /api/* {
        reverse_proxy localhost:8080
    }

    handle {
        try_files {path} /index.html
        file_server
    }
}
```

HTTPS is automatic with Caddy. No `ssl_certificate` lines needed.

---

## 8. Smoke Test

Run these commands in order. Replace `BASE` with your domain or `http://localhost:8080` for local staging.

```bash
BASE=https://staging.yourdomain.com
```

### Step 1 — Login as owner

```bash
OWNER_TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+992900000001","password":"YOUR_OWNER_PASSWORD"}' \
  | jq -r '.data.access_token')
echo "Owner token: ${OWNER_TOKEN:0:20}..."
```

### Step 2 — Login as seller

```bash
SELLER_TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+992900000004","password":"YOUR_DEFAULT_PASSWORD"}' \
  | jq -r '.data.access_token')
```

### Step 3 — Seller creates an order

First, get the IDs needed:

```bash
# Get default customer list (create one if empty)
curl -s "$BASE/api/v1/customers" \
  -H "Authorization: Bearer $SELLER_TOKEN" | jq '.data[0].id'

# Get warehouses
WAREHOUSE_ID=$(curl -s "$BASE/api/v1/warehouses" \
  -H "Authorization: Bearer $SELLER_TOKEN" | jq -r '.data[0].id')

# Get a product
PRODUCT_ID=$(curl -s "$BASE/api/v1/products" \
  -H "Authorization: Bearer $SELLER_TOKEN" | jq -r '.data.items[0].id')
```

Create the order:

```bash
ORDER=$(curl -s -X POST "$BASE/api/v1/orders" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"customer_id\": \"CUSTOMER_UUID\",
    \"order_type\": \"delivery\",
    \"warehouse_id\": \"$WAREHOUSE_ID\",
    \"items\": [{
      \"product_id\": \"$PRODUCT_ID\",
      \"quantity\": 1,
      \"unit_price\": 100.00
    }]
  }")

ORDER_ID=$(echo "$ORDER" | jq -r '.data.id')
echo "Order created: $ORDER_ID"
```

### Step 4 — Login as dispatcher and confirm

```bash
DISPATCHER_TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+992900000005","password":"YOUR_DEFAULT_PASSWORD"}' \
  | jq -r '.data.access_token')

curl -s -X POST "$BASE/api/v1/dispatch/orders/$ORDER_ID/confirm" \
  -H "Authorization: Bearer $DISPATCHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.success'
```

### Step 5 — Dispatcher assigns courier

```bash
COURIER_ID=$(curl -s "$BASE/api/v1/dispatch/couriers/overview" \
  -H "Authorization: Bearer $DISPATCHER_TOKEN" | jq -r '.data[0].courier_id')

curl -s -X POST "$BASE/api/v1/dispatch/orders/$ORDER_ID/assign" \
  -H "Authorization: Bearer $DISPATCHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"courier_id\": \"$COURIER_ID\"}" | jq '.success'
```

### Step 6 — Courier marks delivered

```bash
COURIER_TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+992900000007","password":"YOUR_DEFAULT_PASSWORD"}' \
  | jq -r '.data.access_token')

curl -s -X POST "$BASE/api/v1/courier/orders/$ORDER_ID/start" \
  -H "Authorization: Bearer $COURIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.success'

curl -s -X POST "$BASE/api/v1/courier/orders/$ORDER_ID/delivered" \
  -H "Authorization: Bearer $COURIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.success'
```

### Step 7 — Courier submits cash handover

```bash
HANDOVER=$(curl -s -X POST "$BASE/api/v1/courier/cash/handover" \
  -H "Authorization: Bearer $COURIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')

HANDOVER_ID=$(echo "$HANDOVER" | jq -r '.data.id')
echo "Handover: $HANDOVER_ID"
```

### Step 8 — Dispatcher confirms handover

```bash
curl -s -X POST "$BASE/api/v1/dispatch/cash/handovers/$HANDOVER_ID/confirm" \
  -H "Authorization: Bearer $DISPATCHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actual_returned": 0}' | jq '.success'
```

### Step 9 — Owner checks finance summary

```bash
TODAY=$(date +%Y-%m-%d)
curl -s "$BASE/api/v1/finance/summary?from=2026-01-01&to=$TODAY" \
  -H "Authorization: Bearer $OWNER_TOKEN" | jq '.data.orders.delivered_count'
# Must be ≥ 1
```

### Step 10 — Team lead checks income

```bash
TL_TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+992900000002","password":"YOUR_DEFAULT_PASSWORD"}' \
  | jq -r '.data.access_token')

curl -s "$BASE/api/v1/hr/income/me" \
  -H "Authorization: Bearer $TL_TOKEN" | jq '.success'
```

### Step 11 — Manager checks income

```bash
MGR_TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+992900000003","password":"YOUR_DEFAULT_PASSWORD"}' \
  | jq -r '.data.access_token')

curl -s "$BASE/api/v1/hr/income/me" \
  -H "Authorization: Bearer $MGR_TOKEN" | jq '.success'
```

### Step 12 — Warehouse manager checks inventory

```bash
WH_TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+992900000006","password":"YOUR_DEFAULT_PASSWORD"}' \
  | jq -r '.data.access_token')

curl -s "$BASE/api/v1/inventory" \
  -H "Authorization: Bearer $WH_TOKEN" | jq '.data.total'
# Must be ≥ 1
```

---

## 9. Rollback Plan

### Before any deploy — take a backup

```bash
export PGPASSWORD=YOUR_DB_PASSWORD
pg_dump -h your-db-host -U megamall_app megamall_crm_staging \
  > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Roll back one migration

```bash
goose -dir ./migrations postgres "$DB_DSN" down
```

To roll back to a specific version:

```bash
goose -dir ./migrations postgres "$DB_DSN" down-to 37
```

### Restore from backup

```bash
dropdb -h your-db-host -U postgres megamall_crm_staging
createdb -h your-db-host -U postgres megamall_crm_staging
psql -h your-db-host -U megamall_app megamall_crm_staging < backup_YYYYMMDD_HHMMSS.sql
```

### Frontend rollback

Keep the previous build directory before deploying:

```bash
# Before deploy
cp -r /var/www/megamall-crm/dist /var/www/megamall-crm/dist.prev

# To rollback
rsync -av --delete /var/www/megamall-crm/dist.prev/ /var/www/megamall-crm/dist/
```

No nginx reload needed — nginx serves files directly.

### Backend binary rollback

Keep the previous binary before deploying:

```bash
# Before deploy
cp /var/www/megamall-crm/megamall-crm /var/www/megamall-crm/megamall-crm.prev

# To rollback: stop the current process, restore binary, restart
systemctl stop megamall-crm
cp /var/www/megamall-crm/megamall-crm.prev /var/www/megamall-crm/megamall-crm
systemctl start megamall-crm
```

---

## 10. Troubleshooting

### CORS blocked — browser shows "blocked by CORS policy"

**Cause:** `CORS_ORIGINS` does not match the frontend origin exactly.

Check:
- No trailing slash: `https://staging.yourdomain.com` not `https://staging.yourdomain.com/`
- Protocol must match: `https://` not `http://`
- No wildcard (`*`) — the backend enforces an allowlist

Fix:
```bash
# In .env
CORS_ORIGINS=https://staging.yourdomain.com
# Restart the backend process after changing .env
```

---

### `/ready` returns `false`

**Cause:** Seed data is missing.

```bash
curl -s http://localhost:8080/api/v1/ready | jq '.data.checks'
```

The failing check names tell you exactly what is missing:

| Failing check | Fix |
|--------------|-----|
| `owner_user` | Re-run `go run ./cmd/seed` |
| `default_warehouse` | Re-run `go run ./cmd/seed` |
| `default_product` | Re-run `go run ./cmd/seed` |
| `commission_*` | Re-run `go run ./cmd/seed` |
| `delivery_tariff` | Re-run `go run ./cmd/seed` |
| `database` | Check `DB_DSN` and PostgreSQL connectivity |

---

### Migration version mismatch

**Symptom:** `/health` returns `"migration_version": "37"` when 38 is expected.

```bash
goose -dir ./migrations postgres "$DB_DSN" status
goose -dir ./migrations postgres "$DB_DSN" up
```

---

### Seed fails — "SEED_DEFAULT_PASSWORD is required for SEED_MODE=staging"

**Cause:** Missing or empty environment variable.

```bash
# Correct usage
SEED_MODE=staging \
SEED_DEFAULT_PASSWORD='YourSecureP@ss1' \
SEED_OWNER_PASSWORD='0wnerP@ss1' \
go run ./cmd/seed
```

The seeder also rejects `password123` in staging/production. Choose a different password.

---

### Login returns 429 Too Many Requests

**Cause:** Rate limiter — 5 attempts per 60 seconds per IP per endpoint.

Wait for the `Retry-After` header duration (in seconds), then retry:

```bash
curl -v -X POST .../auth/login ... 2>&1 | grep Retry-After
```

In staging, if you hit the limit while testing, wait 60 seconds or restart the backend (the in-memory store resets on restart).

---

### Frontend cannot reach the backend — network errors in browser console

Check in order:

1. Is the backend running?
   ```bash
   curl -s http://localhost:8080/api/v1/health
   ```

2. Does the nginx `proxy_pass` point to the correct port?
   ```nginx
   proxy_pass http://127.0.0.1:8080;
   ```

3. Is `VITE_API_URL` (or equivalent) in the frontend config pointing to the correct base URL? Check `web-admin/.env` or `web-admin/vite.config.js`.

4. Is HTTPS working end-to-end? The browser will block mixed-content (HTTPS page calling HTTP API).

---

### nginx returns 404 on SPA page refresh

**Cause:** nginx is trying to serve a static file for `/orders/123` — which doesn't exist on disk.

Fix — the `try_files` directive must include the SPA fallback:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

After adding this, reload nginx:

```bash
nginx -t && systemctl reload nginx
```

---

## Appendix — Quick reference

```bash
# Rebuild + redeploy backend
go test ./... && \
go build -o ./tmp/megamall-crm ./cmd/server && \
systemctl restart megamall-crm

# Rebuild + redeploy frontend
cd web-admin && npm run build && \
rsync -av --delete dist/ /var/www/megamall-crm/dist/

# Tail backend logs (systemd)
journalctl -u megamall-crm -f

# Check migration version live
curl -s http://localhost:8080/api/v1/health | jq '.data.migration_version'
```
