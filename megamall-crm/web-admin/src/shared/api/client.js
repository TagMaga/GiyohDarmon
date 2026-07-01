import axios from 'axios'
import useAuthStore from '../store/authStore'

const AUTH_STORAGE_KEY = 'megamall-crm-auth'
const REFRESH_LOCK_KEY = 'megamall-crm-auth-refresh-lock'
const REFRESH_LOCK_TTL_MS = 10_000
const REFRESH_WAIT_MS = 12_000
const REFRESH_WAIT_STEP_MS = 150
let authExpired = false

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 12_000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// ── Request interceptor — attach Bearer token ────────────────────────────────
client.interceptors.request.use(
  (config) => {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (raw) {
      try {
        const state = JSON.parse(raw)?.state
        const token = state?.token
        if (token && state?.refreshToken) authExpired = false
        if (!authExpired && token) config.headers['Authorization'] = `Bearer ${token}`
      } catch {
        // malformed — ignore
      }
    }
    return config
  },
  (error) => Promise.reject(error)
)

// ── Helpers ──────────────────────────────────────────────────────────────────
function getStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

function persistAuthState(nextState) {
  const parsed = getStoredAuth()
  if (!parsed?.state) return

  parsed.state = {
    ...parsed.state,
    ...nextState,
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(parsed))
}

function syncAuthStore(nextState) {
  const store = useAuthStore.getState()
  const stored = getStoredAuth()?.state ?? {}
  const hasNext = (key) => Object.prototype.hasOwnProperty.call(nextState, key)
  const state = {
    token:        hasNext('token') ? nextState.token : (stored.token ?? store.token ?? null),
    refreshToken: hasNext('refreshToken') ? nextState.refreshToken : (stored.refreshToken ?? store.refreshToken ?? null),
    role:         hasNext('role') ? nextState.role : (stored.role ?? store.role ?? null),
    phone:        hasNext('phone') ? nextState.phone : (stored.phone ?? store.phone ?? null),
  }

  if (state.token && state.refreshToken && state.role) {
    store.setAuth(state.token, state.refreshToken, state.role, state.phone)
  } else {
    store.clearAuth()
  }
}

function clearAuthAndRedirect() {
  authExpired = true
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    localStorage.removeItem(REFRESH_LOCK_KEY)
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  }
  syncAuthStore({ token: null, refreshToken: null, role: null, phone: null })

  if (window.location.pathname !== '/login') {
    window.history.replaceState(null, '', '/login')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getRefreshLock() {
  try {
    return JSON.parse(localStorage.getItem(REFRESH_LOCK_KEY) || 'null')
  } catch {
    return null
  }
}

function acquireRefreshLock(owner) {
  const now = Date.now()
  const lock = getRefreshLock()
  if (lock?.owner && lock.expiresAt > now && lock.owner !== owner) {
    return false
  }

  localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify({
    owner,
    expiresAt: now + REFRESH_LOCK_TTL_MS,
  }))

  return getRefreshLock()?.owner === owner
}

function releaseRefreshLock(owner) {
  const lock = getRefreshLock()
  if (lock?.owner === owner) {
    localStorage.removeItem(REFRESH_LOCK_KEY)
  }
}

async function waitForOtherRefresh(previousRefreshToken) {
  const deadline = Date.now() + REFRESH_WAIT_MS

  while (Date.now() < deadline) {
    const state = getStoredAuth()?.state
    if (!state?.refreshToken) return false
    if (state.refreshToken !== previousRefreshToken) return state.token || false

    const lock = getRefreshLock()
    if (!lock?.owner || lock.expiresAt <= Date.now()) break

    await sleep(REFRESH_WAIT_STEP_MS)
  }

  return false
}

// Track whether a refresh is already in flight so parallel 401s don't each
// trigger their own refresh call in this tab. A localStorage lock covers other
// tabs so refresh-token rotation does not look like token reuse to the backend.
let refreshPromise = null

async function tryRefresh() {
  if (authExpired) return false

  const refreshToken = getStoredAuth()?.state?.refreshToken
  if (!refreshToken) return false

  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  if (!acquireRefreshLock(owner)) {
    return waitForOtherRefresh(refreshToken)
  }

  try {
    const latestState = getStoredAuth()?.state
    if (latestState?.refreshToken && latestState.refreshToken !== refreshToken) {
      return latestState.token || false
    }

    const res = await axios.post('/api/v1/auth/refresh', { refresh_token: refreshToken })
    const { access_token, refresh_token: newRefresh } = res.data?.data ?? res.data ?? {}
    if (!access_token) return false

    const nextAuth = {
      token:        access_token,
      refreshToken: newRefresh ?? refreshToken,
    }
    persistAuthState(nextAuth)
    syncAuthStore(nextAuth)
    authExpired = false
    return access_token
  } catch {
    return false
  } finally {
    releaseRefreshLock(owner)
  }
}

// ── Response interceptor — 401 → try refresh → retry once ───────────────────
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status
    const originalRequest = error.config
    const url = originalRequest?.url ?? ''

    // 401 and not already a retry
    if (
      status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !url.includes('/auth/login') &&
      !url.includes('/auth/refresh') &&
      !authExpired
    ) {
      originalRequest._retry = true

      // Deduplicate: if a refresh is already in flight, wait for it
      if (!refreshPromise) {
        refreshPromise = tryRefresh().finally(() => { refreshPromise = null })
      }

      const newToken = await refreshPromise

      if (newToken) {
        // Retry the original request with the new token
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`
        return client(originalRequest)
      }

      // Refresh failed — log out
      clearAuthAndRedirect()
      return Promise.reject(error)
    }

    // 404 on /users/me — user record deleted
    if (
      status === 404 &&
      error.config?.url?.endsWith('/users/me') &&
      window.location.pathname !== '/login'
    ) {
      clearAuthAndRedirect()
      return Promise.reject(error)
    }

    return Promise.reject(error)
  }
)

export default client
