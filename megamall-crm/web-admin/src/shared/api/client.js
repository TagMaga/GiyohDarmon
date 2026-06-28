import axios from 'axios'

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
    const raw = localStorage.getItem('megamall-crm-auth')
    if (raw) {
      try {
        const token = JSON.parse(raw)?.state?.token
        if (token) config.headers['Authorization'] = `Bearer ${token}`
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
    const raw = localStorage.getItem('megamall-crm-auth')
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

function clearAuthAndRedirect() {
  try {
    const parsed = getStoredAuth()
    if (parsed?.state) {
      parsed.state.token        = null
      parsed.state.refreshToken = null
      parsed.state.role         = null
      parsed.state.phone        = null
      localStorage.setItem('megamall-crm-auth', JSON.stringify(parsed))
    }
  } catch {
    localStorage.removeItem('megamall-crm-auth')
  }
  window.location.href = '/login'
}

// Track whether a refresh is already in flight so parallel 401s don't each
// trigger their own refresh call.
let refreshPromise = null

async function tryRefresh() {
  const refreshToken = getStoredAuth()?.state?.refreshToken
  if (!refreshToken) return false

  try {
    const res = await axios.post('/api/v1/auth/refresh', { refresh_token: refreshToken })
    const { access_token, refresh_token: newRefresh } = res.data?.data ?? res.data ?? {}
    if (!access_token) return false

    // Persist new tokens
    const parsed = getStoredAuth()
    if (parsed?.state) {
      parsed.state.token        = access_token
      parsed.state.refreshToken = newRefresh ?? refreshToken
      localStorage.setItem('megamall-crm-auth', JSON.stringify(parsed))
    }
    return access_token
  } catch {
    return false
  }
}

// ── Response interceptor — 401 → try refresh → retry once ───────────────────
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status
    const originalRequest = error.config

    // 401 and not already a retry
    if (status === 401 && !originalRequest._retry) {
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
