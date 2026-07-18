# Courier App — Technical Documentation

Native mobile app for the `courier` role: claim orders, deliver them, and hand over collected cash. It talks to the same backend as the [web-admin website](../../megamall-crm/docs/WEB_ADMIN.md), exclusively through the [`courier` module](../../megamall-crm/docs/API_REFERENCE.md#courier--apiv1courier) (`/api/v1/courier/*`) plus a couple of shared endpoints (`/auth/*`, `/uploads`).

For quick day-to-day commands see [`CLAUDE.md`](CLAUDE.md) in this directory — this document goes deeper into architecture and flows.

## Stack

| Concern | Library |
|---|---|
| Framework | Expo SDK 54, Expo Router 6 (file-based routing) |
| Runtime | React Native 0.81.5, React 19.1 |
| Navigation chrome | `@react-navigation/native` (underlies Expo Router's `Tabs`) |
| Secure storage | `expo-secure-store` — tokens are **never** put in AsyncStorage |
| Location | not currently used in the reviewed screens despite being listed in `CLAUDE.md`'s stack summary — no `expo-location` import found in `src/` |
| Media | `expo-image-picker` (cash-handover proof screenshots), `expo-blur` (tab bar glass effect) |
| State | zustand 4, no persist middleware — SecureStore is the persistence layer instead |
| HTTP | axios with a JWT auto-refresh interceptor |
| Dates | `dayjs` (Russian locale) |

## Directory layout

```
app/                          Expo Router file-based routes
  _layout.jsx                  Root layout: gesture handler + glass theme + auth bootstrap
  index.jsx                    Redirects to /login
  (auth)/
    _layout.jsx
    login.jsx                  Login screen
  (tabs)/
    _layout.jsx                 Tab bar (5 tabs, floating glass pill)
    dashboard.jsx                Home — earnings hero, KPIs, active deliveries
    deliveries.jsx                My orders, filterable by status
    claimable.jsx                 Unassigned orders available to claim
    cash.jsx                      Cash summary, handover submission, earnings history
    profile.jsx                   Courier info, tariff rules, logout
  (tabs)_backup_20260615/       dated backup of the previous tab set — not part of the routed app
src/
  api/
    client.js                  axios instance, base URL resolution, refresh interceptor
    auth.js                    login/logout/getMe/uploadAvatar
    orders.js                  all order + cash endpoints
  components/
    Avatar.jsx, OrderCard.jsx, OrderDetailSheet.jsx, glass.jsx, motion.jsx
  lib/creator.js                resolves "who created this order" display (name/role/isOwn)
  store/authStore.js            zustand auth store
```

## Dev & build

```bash
npm install
npx expo start            # QR code, Expo Go
npx expo start --ios      # iOS simulator
npx expo start --android  # Android emulator
```

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview     # APK for testing
eas build --platform android --profile production  # AAB for Play Store
```
Full builds are only needed when native code, permissions, or the Expo SDK
version change.

### OTA updates (EAS Update)

JS/UI-only fixes ship without a new build or store review, via
`preview`/`production` channels (`eas.json`'s `build.<profile>.channel`) and
a `fingerprint`-policy `runtimeVersion`, which only offers an update to
installs it's actually compatible with:

```bash
npm run update:preview      # test on a preview-channel build first
npm run update:production   # then push to production
```

Env: copy `.env.example` → `.env`, set `EXPO_PUBLIC_API_URL=http://<lan-ip>:8080`. In dev this is actually rarely needed — see base-URL resolution below.

## API client & base URL resolution (`src/api/client.js`)

`resolveApiUrl()` picks the backend host depending on build type:

- **In `__DEV__`** (Expo Go): derives the LAN IP from Metro's connection info (`Constants.expoConfig.hostUri` / `expoGoConfig.debuggerHost` / etc.) and points at `http://<that-host>:8080`. This means the app follows the dev machine's current WiFi IP automatically — no manual `.env` editing, and no stale-IP "wrong password" red herring when the laptop's IP changes.
- **In production builds**: no Metro host exists, so it falls back to `EXPO_PUBLIC_API_URL`, then the encrypted production endpoint `https://134.122.81.40`.

`client` is an axios instance with `baseURL: '{API_URL}/api/v1'`, 10s timeout.

- **Request interceptor**: attaches `Authorization: Bearer <access_token>` from `expo-secure-store`.
- **Response interceptor** (401 handling):
  - Skips refresh entirely for `/auth/*` URLs — a 401 there is a real credential error, not session expiry.
  - Single-flight refresh: concurrent 401s queue behind one in-flight `POST /auth/refresh` call (`isRefreshing` flag + `queue` array), then all retry with the new token.
  - On refresh failure: clears both tokens from SecureStore, force-syncs the zustand store to logged-out (via a late-bound `require('../store/authStore')` to dodge a circular import between `client.js` → `authStore.js` → `auth.js` → `client.js`), and navigates to `/(auth)/login`.

## Auth flow

1. `login.jsx` calls `login({ phone: loginVal, password })` → `POST /auth/login`.
2. Tokens are persisted via `authStore.setAuth()`, which writes both to SecureStore and to zustand state.
3. Immediately calls `getMe()` → `GET /courier/me`. If `profile.role !== 'courier'`, the login is rejected client-side ("Этот аккаунт не является курьером") even though the credentials were valid — this app only serves the courier role.
4. On success, navigates to `/(tabs)/dashboard`.
5. On app cold start, `app/_layout.jsx` calls `authStore.rehydrate()`: reads tokens from SecureStore, and if present, re-fetches `getMe()` to refresh the cached user. Critically, it **only forces logout on a `401`/`403`** from that call — network errors, timeouts, and 5xx leave the user's session intact (so a flaky network on launch doesn't bounce a legitimately logged-in courier back to the login screen).
6. Logout (`profile.jsx`): confirms via `Alert`, calls `POST /auth/logout` with the refresh token (best-effort — failure is swallowed), clears local state, navigates to login.

Login error handling distinguishes two cases: `err.response` present → real server error (shows the backend's message); no `err.response` → the request never reached the server, shown as a distinct "Нет связи с сервером" (no connection) alert naming the resolved `API_URL`, since on a LAN this is almost always a wrong-IP/wrong-WiFi problem rather than bad credentials.

## Screens

| Route | Screen | Purpose |
|---|---|---|
| `/(auth)/login` | Login | Phone + password; courier-role-only gate |
| `/(tabs)/dashboard` | Dashboard | Earnings hero, 3 KPI bubbles (delivered/active/available), active-delivery list, day-status card |
| `/(tabs)/deliveries` | Deliveries | Full order list with status filter chips (`all/assigned/in_delivery/delivered/returned`); urgent (`fast`/`express`) orders float to the top |
| `/(tabs)/claimable` | Claimable | Unassigned orders available to self-assign; urgent orders badged and sorted first; one-tap claim, no confirmation dialog |
| `/(tabs)/cash` | Cash | "Amount to hand over today" hero (`collected − salary` formula), handover submission sheet with photo proof, handover history + earnings history tabs |
| `/(tabs)/profile` | Profile | Name, phone, avatar, active tariff rules (grouped by delivery type: normal/fast), logout |

Tab bar (`app/(tabs)/_layout.jsx`): a floating, blurred glass pill anchored to the bottom of the screen (not a standard opaque tab bar), 5 icons via `lucide-react-native` (Home, Package, MapPin, Wallet, User), with a spring-animated active pill behind the focused icon.

### Dashboard (`dashboard.jsx`)

Fetches `getMyOrders()`, `getCashSummary()`, `getClaimableOrders()` in parallel via `Promise.allSettled` — a failure in one call doesn't blank the whole screen, since the other two can still render. Distinguishes "never loaded" (full-screen error card with retry) from "reload failed but stale data exists" (small inline warning banner, keeps showing the last good data). Computes today's earnings client-side by summing `courier_payout`/`delivery_fee` across orders with `status === 'delivered'`. Tapping an in-route order opens `OrderDetailSheet`, which exposes `onStart` (→ `in_delivery`) and `onDelivered` actions.

### Deliveries (`deliveries.jsx`)

Client-side filter over `getMyOrders()` by status; sorts urgent-and-still-active orders (`delivery_method === 'fast' | 'express'`, not yet delivered/returned/cancelled) to the top regardless of the active filter.

### Claimable (`claimable.jsx`)

Fetches `getClaimableOrders()` (backend already returns them pre-sorted urgent-first; the client re-sorts as a defensive guard). `resolveCreator()` (`src/lib/creator.js`) figures out how to label who created the order (own order vs. a named seller/manager with a role-colored pill). Claiming is deliberately frictionless — a single tap on "🎯 Взять заказ" calls `claimOrder(id)` immediately, with no confirmation modal and no success popup; the card animates out of the list (`animateLayout()` + filtering the claimed order from local state) and the list re-fetches in the background.

### Cash (`cash.jsx`)

The most stateful screen. Two sub-tabs act as the primary navigation (not `Tabs` from Router — plain local state toggling between "Сдано наличных"/"Заработки" KPI cards):

- **Handover formula**: `к сдаче = собранные наличные (COD) − зарплата курьера`, shown live as `{collected} − {salary} = {toReturn} TJS`. `collected = toReturn + salary`, i.e. derived from the backend summary (`cash_to_handover`, `total_delivery_fees`), not computed forward from orders.
- **Submitting a handover**: requires both an amount and at least one attached photo (`expo-image-picker`, gallery only — no camera option, capped at `MAX_ATTACHMENTS = 5`). Each attachment is uploaded individually to `POST /uploads` first (multipart), then the resulting URLs are passed to `submitHandover({ proof_url, attachments_json, actual_amount, notes })` — the first URL as `proof_url`, the full list JSON-encoded into `attachments_json` if more than one. A live "разница" (difference) indicator compares the entered amount against the expected `toReturn` before submission.
- **Earnings tab**: lists each delivered order's fixed courier payout — independent of whether that cash has been handed over yet.
- Handover history and a full-screen image preview modal (for both freshly-picked and previously-submitted proof photos) round out the screen.

### Profile (`profile.jsx`)

Read-only info (name, phone, avatar) plus the courier's **active tariff rules**, grouped by delivery type (`normal`/`fast`) and rendered as amount-range → rate rows (percent or flat TJS). This is the courier-facing view into the same tariff data the dispatcher/owner manage via `courier_tariffs` on the backend (see [dispatch tariff endpoints](../../megamall-crm/docs/API_REFERENCE.md#dispatch--apiv1dispatch)).

## API surface used (`src/api/auth.js`, `src/api/orders.js`)

| Function | Endpoint |
|---|---|
| `login(data)` | `POST /auth/login` |
| `logout(refreshToken)` | `POST /auth/logout` |
| `getMe()` | `GET /courier/me` |
| `uploadAvatar(asset)` | `POST /users/me/avatar` (multipart) |
| `getMyOrders(params)` | `GET /courier/my-orders` |
| `getClaimableOrders()` | `GET /courier/available` |
| `claimOrder(id)` | `POST /courier/available/:id/claim` |
| `updateOrderStatus(id, status, data)` | `POST /courier/orders/:id/{start\|delivered\|returned\|issue\|address-changed}` — mapped via a local `STATUS_ENDPOINT` table keyed by the target status (`in_delivery→start`, `delivered→delivered`, `returned→returned`, `issue→issue`, `address_changed→address-changed`) |
| `reportAddressChanged(id, newAddress)` | `POST /courier/orders/:id/address-changed` |
| `deferOrder(id, scheduledAt)` | `POST /courier/orders/:id/defer` |
| `getOrderComments(id)` / `addOrderComment(id, comment)` | `GET`/`POST /orders/:id/comments` (shared order-comments endpoint, not courier-prefixed) |
| `getCashSummary()` | `GET /courier/cash/summary` |
| `submitHandover(data)` | `POST /courier/cash/handover` |
| `getHandoverHistory()` | `GET /courier/cash/handovers` |

Note: the backend `courier` module also exposes `GET /courier/orders/:id`, `GET/POST /courier/orders/:id/notes`, `POST /courier/orders/:id/attempt`, `POST /courier/status`, and `PUT /courier/push-token` (see [API_REFERENCE.md](../../megamall-crm/docs/API_REFERENCE.md#courier--apiv1courier)) — these are not currently called from any reviewed screen, so either they're dead endpoints or consumed from a component not covered here (e.g. an "attempt" flow inside `OrderDetailSheet.jsx`/`OrderCard.jsx`, or a not-yet-wired push-notification registration).

## Key business rules

- A courier can only claim orders that are unassigned and in `new`/`confirmed` status (`getClaimableOrders`).
- Marking "delivered" requires **no** photo confirmation — a single button tap suffices (unlike the cash-handover flow, which does require a photo).
- Cash to hand over = all COD (cash-on-delivery) orders collected today minus what's already been handed over — computed server-side (`GET /courier/cash/summary`) and mirrored by the client-side formula in `cash.jsx`.
- "Returned" covers both the customer not being present and the customer refusing the order.
- Urgent deliveries (`delivery_method` = `fast`, with `express` kept only as a legacy fallback value) are surfaced first in both Deliveries and Claimable.

## UI conventions

- `src/components/glass.jsx` provides a theme context (`useGlass()` → `{ dark, T, ... }`) driving a consistent frosted-glass aesthetic (`GlassBackdrop`, `GlassFill`, `Sheen`) across light/dark; screens pull colors from `T` (theme tokens) rather than hardcoding hex values, except a few screens (`login.jsx`, `profile.jsx`) that use a fixed dark palette (`const C = {...}`) since those are always-dark screens by design.
- `src/components/motion.jsx` centralizes animation primitives: `FadeSlideIn`, `PressScale`, `CountUp`, `PulseDot`, `Skeleton`/`OrderCardSkeleton`, `animateLayout()` (wraps `LayoutAnimation` for list add/remove transitions).
- All user-facing text is Russian.
