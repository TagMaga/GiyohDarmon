# MegaMall CRM — Documentation Index

Two client apps share one Go backend:

- **Website** (`web-admin/`) — React SPA for owner, sales team lead, manager, seller, dispatcher, warehouse manager. → [WEB_ADMIN.md](WEB_ADMIN.md)
- **Courier app** (`mobile/courier-app/`) — Expo/React Native app for the courier role. → [`mobile/courier-app/DOCUMENTATION.md`](../../mobile/courier-app/DOCUMENTATION.md)
- **Backend** (repo root, `internal/`) — Go + Gin + GORM + PostgreSQL, serves both. → [API_REFERENCE.md](API_REFERENCE.md)

## Where to start

| I want to... | Read |
|---|---|
| Understand the website's routing, roles, and pages | [WEB_ADMIN.md](WEB_ADMIN.md) |
| Understand the courier app's screens and flows | [`mobile/courier-app/DOCUMENTATION.md`](../../mobile/courier-app/DOCUMENTATION.md) |
| Look up an API endpoint and which roles can call it | [API_REFERENCE.md](API_REFERENCE.md) |
| Learn backend module conventions (file layout, RBAC pattern, migrations, the financial ledger, the compensation engine) | [`../CLAUDE.md`](../CLAUDE.md) |
| Set up a staging environment | [STAGING_RUNBOOK.md](STAGING_RUNBOOK.md) |
| See the historical Phase 6 API notes | [API_PHASE_6.md](API_PHASE_6.md) |
| See the 2026-06-18 full-system audit & modernization plan | [AUDIT_2026-06-18.md](AUDIT_2026-06-18.md) |

## Snapshot

- Roles: `owner`, `sales_team_lead`, `manager`, `seller`, `dispatcher`, `warehouse_manager`, `courier`.
- Backend modules: `auth`, `users`, `teams`, `hierarchy`, `compensation` (HR/commission engine), `products`, `inventory`, `customers`, `orders`, `dispatch`, `courier`, `delivery_settings`, `finance`, `budget`, `logistics`, `logistics_settings`, `payouts`, plus support modules `activity`, `courier_tariffs`, `uploads`, `health`.
- Website feature domains (`web-admin/src/features/`): `budget`, `courier`, `dispatcher`, `finance`, `hr`, `logistics`, `manager`, `orders`, `owner`, `people`, `seller`, `team-lead`, `warehouse`.
- Courier app: 5 tabs — Dashboard, Deliveries, Claimable, Cash, Profile — talking to `/api/v1/courier/*`.

[WEB_ADMIN.md](WEB_ADMIN.md) and [`mobile/courier-app/DOCUMENTATION.md`](../../mobile/courier-app/DOCUMENTATION.md) were generated from a full read of the current codebase (routers, layouts, every `api.js`, every backend `routes.go`) as of 2026-07-09, and note a handful of unrouted/dead files found along the way — treat those notes as a cleanup opportunity, not a defect in the docs.
