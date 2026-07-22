# Web-Admin — Technical Documentation

The **website** is `web-admin/` — a single React SPA that serves every non-courier role in the business: owner, sales team lead, manager, seller, dispatcher, and warehouse manager. There is no separate marketing site or public page; `/login` is the only unauthenticated route and everything else is role-gated.

This document covers architecture, routing, per-role page/API inventory, and cross-cutting conventions. For the backend API itself see [API_REFERENCE.md](API_REFERENCE.md). For the mobile courier app see [`mobile/courier-app/DOCUMENTATION.md`](../../mobile/courier-app/DOCUMENTATION.md).

## Stack

| Concern | Library |
|---|---|
| Build tool | Vite 5 |
| UI framework | React 18 |
| Routing | react-router-dom 6 (`createBrowserRouter`) |
| Server state / caching | `@tanstack/react-query` 5 |
| Client/global state | zustand 4 (auth store only) |
| HTTP | axios |
| Auth decode | `jwt-decode` (client-side JWT read for `{userId, role}`) |
| Icons | `lucide-react` |
| Charts | `recharts` |
| Styling | Tailwind CSS 3 |

No form library (react-hook-form/formik) — forms are plain controlled components. No lint/test scripts are configured; verify changes by building and exercising the app in a browser.

### Commands (run from `web-admin/`)

```bash
npm run dev       # vite dev server, http://localhost:5173
npm run build     # production build
npm run preview   # preview a production build locally
```

## Architecture overview

```
src/
  app/router.jsx           one ProtectedRoute + layout subtree per role
  pages/                    a few top-level pages not owned by a specific feature
                            (Login, OwnerDashboard, SellerDashboard, DispatcherDashboard)
  shared/
    api/                    base axios client, auth.js, payoutsApi.js
    components/             Layout, Sidebar, Modal, ProtectedRoute, RootRedirect, ComingSoon...
    hooks/                  useCurrentUser, etc.
    store/                  authStore (zustand)
    queryKeys.js            centralized TanStack Query key registry
  features/<domain>/
    api.js                  axios wrappers + local unwrap() for the {success, data} envelope
    hooks/                  TanStack Query hooks built on api.js
    pages/                  route-level screens
    components/             page-local building blocks
```

Thirteen feature domains exist: `budget`, `courier`, `dispatcher`, `finance`, `hr`, `logistics`, `manager`, `orders`, `owner`, `people`, `seller`, `team-lead`, `warehouse`.

### Auth & session

- JWT claims are `{user_id, role, team_id}`. `shared/hooks/useCurrentUser.js` decodes the access token client-side to get `{userId, role}` without a round trip.
- `shared/store/authStore.js` (zustand, persisted to `localStorage['megamall-crm-auth']`) holds the token pair and user.
- `shared/api/client.js` is the single axios instance (`baseURL: '/api/v1'`, 12s timeout):
  - Request interceptor reads the persisted auth state and attaches `Authorization: Bearer <token>`.
  - Response interceptor handles `401`s with token refresh (`POST /auth/refresh`), deduped in-tab via an in-memory promise and coordinated across tabs via a `localStorage` lock (`REFRESH_LOCK_KEY`, 10s TTL) so refresh-token rotation across multiple open tabs doesn't look like token reuse to the backend.
  - A `404` on `users/me` is treated as "account deleted" and forces logout.
  - On unrecoverable auth failure, `clearAuthAndRedirect()` clears storage/store and force-navigates to `/login` via `history.replaceState` + a synthetic `popstate` (no full page reload).
- `shared/api/auth.js`: `login(phone, password)` → `POST /auth/login`; `getHealth`/`getReady` for `/health`, `/ready`.
- `shared/api/payoutsApi.js`: the generalized payout ledger shared by seller/manager/team-lead — `fetchMyPayouts`, `fetchPayables`, `fetchPayeePayoutHistory`, `createPayouts`, `voidPayout`.

**Minor known duplication**: nearly every feature's `api.js` re-implements its own tiny `unwrap()` helper to pull `.data` out of the `{success, data}` envelope, rather than importing one shared helper. Harmless, but worth consolidating if touching many `api.js` files at once.

### Routing (`src/app/router.jsx`)

- `/login` → `pages/Login.jsx`, public.
- `/` → `shared/components/RootRedirect.jsx`, sends the user to `ROLE_HOME[role]`.
- Each role subtree is wrapped in `<ProtectedRoute allowedRole="...">` — redirects unauthenticated users to `/login`, and wrong-role users to their own home.
- `ROLE_HOME`: `owner→/owner`, `sales_team_lead→/team-lead`, `manager→/manager`, `seller→/seller`, `dispatcher→/dispatcher`, `warehouse_manager→/warehouse`, `courier→/courier`.
- Every page component is lazy-loaded (`lazy()` + `<Suspense>`).
- Each role tree ends in a `{ path: '*', element: <ComingSoon/> }` catch-all.
- Global catch-all `*` → redirect to `/`.

### Layout & navigation

Two layout systems coexist:

1. **Shared legacy `Layout.jsx`** (`shared/components/Layout.jsx`) — used by `owner`, `dispatcher`, `warehouse_manager`, `courier`. Renders a desktop `Sidebar` + `<Outlet/>`, and on mobile a floating pill `BottomNav` for roles where `hasMobileNav` is true (owner, warehouse; seller/manager branches here are vestigial since those roles use their own layout below). Dispatcher is special-cased: any `/dispatcher/*` path renders a bare `<Outlet/>` with no sidebar/bottom-nav, because `DispatcherBoardV3` owns its own full-screen chrome.
2. **Dedicated per-role layouts** — `seller` (`SellerLayout.jsx`), `sales_team_lead` (`TeamLeadLayout.jsx`), `manager` (`ManagerLayout.jsx`) each bypass `Layout.jsx` entirely with their own dark sidebar (desktop) + `BottomNav` variant (mobile), because their tab sets/branding diverge from the generic shell.

`Sidebar.jsx` defines one `NAV` array per role (desktop); mobile tab arrays are defined inline in `Layout.jsx` or the dedicated layout file per role. `courier`'s desktop nav is empty (`NAV.courier = []`) — the courier role's web experience is a single-page dashboard (`features/courier/pages/CourierDashboard.jsx`) with its own internal tab bar, not the shared chrome. In practice couriers use the [mobile app](../../mobile/courier-app/DOCUMENTATION.md) day-to-day; the web `/courier` route exists as a fallback/admin view.

`shared/components/Modal.jsx` is the one shared dialog primitive — renders as a bottom sheet on mobile (`items-end` + rounded top corners) and a centered modal on desktop. Reused everywhere rather than each feature building its own sheet.

Currency is always rendered as the literal string "c" in the UI, never a currency symbol.

---

## Role-by-role reference

### Owner (`/owner`, layout: shared `Layout.jsx`)

The owner sees everything: company-wide finance, budget, logistics, warehouse, and a "Ещё" (More) sheet for less-frequent screens.

Bottom-nav tabs: Главная, Заказы, Финансы, Склад, **Ещё** (opens `OwnerMoreSheet` → Бюджет компании, Логистика, Команда, Профиль).

| Route | Page | Notes |
|---|---|---|
| `/owner` | `pages/OwnerDashboard.jsx` | KPIs, order stats, seller leaderboard, team performance, finance-daily trend (`features/owner/api.js`: `GET /orders/stats`, `GET /finance/daily`, `GET /finance/sellers`, `GET /finance/teams`) |
| `/owner/teams` | `features/people/pages/TeamsHub.jsx` | Teams + employees hub |
| `/owner/teams/:teamName` | `features/people/pages/TeamProfilePage.jsx` | Single team profile |
| `/owner/team-directory` | `features/people/pages/TeamDirectoryPage.jsx` | Full employee directory; create employee/team |
| `/owner/finance` | `features/finance/pages/OwnerFinancePage.jsx` | Company P&L: cash flow, commissions breakdown, financial-events table |
| `/owner/budget` | `features/budget/pages/BudgetCompanyPage.jsx` | Company budget ledger (income/withdrawal, not tied to orders) |
| `/owner/orders` | `features/orders/pages/OwnerOrdersPage.jsx` | All-orders table with filters/analytics/KPI bar |
| `/owner/orders/create` | `features/seller/pages/CreateOrder.jsx` | Shared with seller — owner can create an order directly |
| `/owner/logistics` | `features/logistics/pages/LogisticsPage.jsx` | Courier roster, performance, cash-handover center |
| `/owner/logistics/couriers/:id` | `features/logistics/pages/CourierProfilePage.jsx` | Single courier's orders + performance |
| `/owner/warehouse` | `features/owner/pages/OwnerWarehousePage.jsx` | Read-oriented warehouse summary for the owner |
| `/owner/reports` | `features/owner/pages/OwnerReportsPage.jsx` | Reports |
| `/owner/settings` | `features/owner/pages/OwnerSettingsPage.jsx` | Settings |
| `/owner/profile`, `/owner/profile/info` | `OwnerProfilePage.jsx` (layout) → `OwnerProfileInfoPage.jsx` | Personal info + password change |

### Sales Team Lead (`/team-lead`, layout: `TeamLeadLayout.jsx`)

Bottom-nav tabs: Главная, Заказы, **+** (create order FAB), Финансы, Профиль. Team management lives under Profile, not its own tab.

| Route | Page |
|---|---|
| `/team-lead` | `TeamLeadDashboardPage.jsx` |
| `/team-lead/income` | `TeamLeadIncomePage.jsx` |
| `/team-lead/orders` | `TeamLeadOrdersPage.jsx` |
| `/team-lead/orders/create` | `features/seller/pages/CreateOrder.jsx` (shared) |
| `/team-lead/reports` | `TeamLeadReportsPage.jsx` |
| `/team-lead/team` | `TeamLeadTeamPage.jsx` |
| `/team-lead/team/:payeeId` | `TeamLeadSellerFinanceDetailPage.jsx` |
| `/team-lead/finance` | `TeamLeadFinancePage.jsx` |
| `/team-lead/profile`, `/profile/info` | `TeamLeadProfilePage.jsx` → `features/seller/pages/SellerProfileInfoPage.jsx` (shared) |

`team-lead` has no `api.js` of its own — it reuses `shared/api/payoutsApi.js` (payables, payout creation/void), `orders/api.js` (via `useOwnerOrders`), and `people/api.js` (via `useTeams`). `TeamLeadManagerPage.jsx` and `TeamLeadSellersPage.jsx` exist as files but are **not routed** (superseded by `TeamLeadTeamPage`).

### Manager (`/manager`, layout: `ManagerLayout.jsx`)

Bottom-nav tabs: Главная, Заказы (команда), **+** (create personal order FAB), Доходы, Профиль.

| Route | Page |
|---|---|
| `/manager` | `ManagerDashboardPage.jsx` |
| `/manager/income` | `ManagerIncomePage.jsx` |
| `/manager/orders` | `ManagerOrdersPage.jsx` (team orders) |
| `/manager/sellers` | `ManagerSellersPage.jsx` |
| `/manager/my-orders` | `ManagerMyOrdersPage.jsx` (manager's own personal orders) |
| `/manager/my-orders/create` | `features/seller/pages/CreateOrder.jsx` |
| `/manager/my-orders/:id/edit` | `features/seller/pages/EditOrder.jsx` |
| `/manager/profile`, `/profile/info`, `/profile/team` | `ManagerProfilePage.jsx` → `SellerProfileInfoPage.jsx` (shared) / `ManagerProfileTeamPage.jsx` |

`manager` also has no own `api.js`; its hooks wrap `orders/api.js` (`useOwnerOrders` for team/personal orders, filtered by params) and `people/api.js` (`useTeams`).

### Seller (`/seller`, layout: `SellerLayout.jsx`)

Bottom-nav tabs: Главная, Заказы, **+** (create order FAB), Доход, Профиль.

| Route | Page |
|---|---|
| `/seller` | `pages/SellerDashboard.jsx` (layout) → `features/seller/pages/SellerHome.jsx` |
| `/seller/orders` | `SellerOrders.jsx` |
| `/seller/orders/create` | `CreateOrder.jsx` — cart builder: `ProductPicker`, `QuantitySelector`, `CartItemRow`, `CartTotalsBreakdown`, `DeliveryModeSelector`, `PaymentModeSelector`, `PhoneSearchField` |
| `/seller/orders/:id/edit` | `EditOrder.jsx` |
| `/seller/income` | `SellerIncomePage.jsx` |
| `/seller/profile`, `/profile/info`, `/profile/team` | `SellerProfilePage.jsx` → `SellerProfileInfoPage.jsx` / `SellerTeamPage.jsx` |

`seller/api.js` is the order-creation workhorse: `createOrder`, `fetchCustomers`/`createCustomer`, `fetchProducts`, `fetchDeliverySettings`/`updateDeliverySettings`, `fetchCities`, `fetchInventory`, `addPrepayment`, `updateOrder`, plus self-profile endpoints (`fetchMe`/`patchMe`/`uploadMyAvatar`/`changePassword`) and income endpoints (`fetchMyCompensation`, `fetchMyTeamRank`, `fetchMyTeam`, `fetchMyPayouts`). `SellerProfileInfoPage.jsx` is intentionally shared across seller/team-lead/manager rather than forked three ways.

### Dispatcher (`/dispatcher`, no shared chrome)

The dispatcher board is the most complex screen in the app — a full-screen Kanban workspace, not a sidebar+content layout.

| Route | Page | Notes |
|---|---|---|
| `/dispatcher` | `DispatcherBoardV3.jsx` | Current/active board |
| `/dispatcher/v2` | `pages/DispatcherDashboard.jsx` | Prior iteration, still reachable |
| `/dispatcher/cash` | `DispatcherCashPage.jsx` | Cash settlement + handover review |
| `/dispatcher/legacy` | `DispatcherBoard.jsx` | Original board, kept for fallback |
| `/dispatcher/*` | redirect → `/dispatcher` | |

Key components: `KanbanBoard`/`KanbanOrderCard`, `OrderDrawer` (detail + actions), `AssignCourierModal`, `CancelModal`, `IssueModal`, `RejectPrepaymentModal`, `ScheduleModal`, `UnassignModal`, `CommentsDrawer`, `CommandPalette` (keyboard-driven quick actions), `CourierSidebarPanel`/`CourierOverview`, `CashHandovers`, `CreateOfficeOrderModal`. A `v2/` subfolder (`DispatcherWorkspace`, `DispatcherKPIs`, `DispatcherCourierRail`, `DispatcherOrderPanel`, ...) backs the `/dispatcher/v2` route.

`dispatcher/api.js` is the largest `api.js` in the codebase — order lifecycle actions (`confirmOrder`, `assignCourier`, `reassignCourier`, `unassignCourier`, `scheduleOrder`, `markIssue`, `markReturn`, `cancelOrder`, `resolveIssue`), prepayment verification (`verifyPrepayment`/`rejectPrepayment`), cash (`fetchCashSettlement`, `fetchCashTransactions`, handover confirm/reject), courier admin (`updateCourier`, `setCourierAccountActive`, `updateCourierOrderIntake`, tariff CRUD), and city management (`fetchCities`/`createCity`). See [`internal/dispatch`](#dispatch) in the API reference for the backend side.

### Warehouse Manager (`/warehouse`, layout: shared `Layout.jsx`)

Bottom-nav tabs: Главная, Товары, Приёмка, Движ. (movements), Профиль.

| Route | Page |
|---|---|
| `/warehouse` | `WarehouseDashboard.jsx` |
| `/warehouse/inventory` | `WarehouseInventoryPage.jsx` (also serves `/warehouse/products`, redirected) |
| `/warehouse/movements` | `WarehouseMovementsPage.jsx` |
| `/warehouse/receiving` | `WarehouseReceivingPage.jsx` (also serves `/warehouse/writeoffs`, redirected) |
| `/warehouse/profile` | `WarehouseProfilePage.jsx` |

`WarehouseProductsPage.jsx` and `WarehouseWriteoffsPage.jsx` exist as files but are **unrouted** — their functionality now lives inside `WarehouseInventoryPage`/`WarehouseReceivingPage` via redirect. `warehouse/api.js` includes UUID-validating sanitizer helpers (`cleanParams`/`cleanPayload`/`requireUUID`) since product/inventory IDs flow through many forms: `fetchProducts`/`createProduct`/`updateProduct`/`addProductImage`, `importProducts` (CSV/dry-run), `fetchInventory`/`fetchInventoryByProduct`, `fetchMovements`, `fetchBatches`, `createAdjustment`/`createReceiving`/`updateReceiving`/`createWriteoff`.

### Courier (`/courier`, web fallback)

Single route `/courier` → `features/courier/pages/CourierDashboard.jsx`, which renders its own internal tab bar (`CourierBottomTabbar.jsx`) switching between `CourierHomeView`, `CourierOrdersView`, `CourierMarketView` (claimable orders), `CourierCashView` — mirroring the mobile app's four tabs in a single page. `courier/api.js` maps 1:1 to the same `/courier/*` backend endpoints the mobile app uses (see [courier module](#courier) below and the [mobile app doc](../../mobile/courier-app/DOCUMENTATION.md)). This is a secondary surface — couriers are expected to use the phone app day to day.

---

## Cross-cutting features without their own route

- **`hr` feature**: not directly routed (its `HrDashboard.jsx` page is unrouted, superseded by the People Hub and owner Settings/Reports). It's consumed as a hooks/api library by `people`, `seller`, `team-lead`, `manager` for the compensation engine — tariffs, commission configs (global/team/employee), income reports, preview calculator.
- **`people` feature**: the owner's staff/teams management surface (`TeamsHub`, `TeamDirectoryPage`, `TeamProfilePage`) — largest `api.js`, covering users, teams, hierarchy assignment, compensation configs, avatars/documents, and courier payout-rate CRUD.

## Query key convention

`shared/queryKeys.js` centralizes all TanStack Query keys under a `KEYS` object with per-domain namespaces (`dispatcher`, `seller`, `customers`, `users`, `hr`, `people`, `warehouse`, `settings`, `courier`, `finance`, `orders`, `logistics`, `payouts`). Never inline a query key array — add a new key under the relevant domain in this file instead.

## Known dead code (safe to ignore or clean up separately)

- `features/team-lead/pages/TeamLeadManagerPage.jsx`, `TeamLeadSellersPage.jsx` — unrouted.
- `features/warehouse/pages/WarehouseProductsPage.jsx`, `WarehouseWriteoffsPage.jsx` — unrouted.
- `features/dispatcher/pages/DispatcherPage.jsx` — unrouted.
- `features/hr/pages/HrDashboard.jsx` — unrouted.
