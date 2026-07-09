# MegaMall CRM

A logistics/sales CRM: a Go backend serving two clients — a React web admin panel and an Expo courier mobile app.

```
megamall-crm/          Go + Gin + GORM + PostgreSQL backend, and the web-admin/ React frontend
mobile/courier-app/    Expo / React Native app for the courier role
```

## Documentation

Full technical docs live in [`megamall-crm/docs/`](megamall-crm/docs/README.md):

- [Website (web-admin)](megamall-crm/docs/WEB_ADMIN.md) — roles, routing, layouts, per-feature page & API inventory
- [Courier app](mobile/courier-app/DOCUMENTATION.md) — screens, auth flow, business rules, API surface
- [API reference](megamall-crm/docs/API_REFERENCE.md) — every backend endpoint with role gating
- [Backend conventions](megamall-crm/CLAUDE.md) — module layout, RBAC pattern, migrations, financial ledger, compensation engine
- [Staging runbook](megamall-crm/docs/STAGING_RUNBOOK.md) — deploying a staging environment

## Quick start

**Backend** (from `megamall-crm/`):
```bash
go build -o ./tmp/megamall-crm ./cmd/server
goose -dir ./migrations postgres "$(grep ^DB_DSN .env | cut -d= -f2-)" up
./run_server.sh
```

**Web admin** (from `megamall-crm/web-admin/`):
```bash
npm run dev   # http://localhost:5173
```

**Courier app** (from `mobile/courier-app/`):
```bash
npx expo start
```

See [`megamall-crm/CLAUDE.md`](megamall-crm/CLAUDE.md) and [`mobile/courier-app/CLAUDE.md`](mobile/courier-app/CLAUDE.md) for full command references.
