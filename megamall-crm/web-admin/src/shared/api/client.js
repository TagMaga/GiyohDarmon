import axios from 'axios'

/**
 * Axios instance.
 *
 * baseURL is relative (/api/v1) so all requests go through the Vite dev-server
 * proxy → http://localhost:8080.  In production, point the reverse proxy (nginx
 * etc.) to the Go backend and the same relative URL will work unchanged.
 */
const client = axios.create({
  baseURL: '/api/v1',
  timeout: 12_000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// ── Request interceptor — attach Bearer token ────────────────────────────────
// TODO: token in localStorage is vulnerable to XSS. Migrate to httpOnly-cookie
//       session when this admin panel needs to be hardened for public deployment.
client.interceptors.request.use(
  (config) => {
    // Import lazily to avoid circular-module issues at load time
    // (authStore imports nothing from here, but this file is loaded before the
    // store is fully initialised on first render)
    const raw = localStorage.getItem('megamall-crm-auth')
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        const token  = parsed?.state?.token
        if (token) {
          config.headers['Authorization'] = `Bearer ${token}`
        }
      } catch {
        // Malformed localStorage value — ignore
      }
    }
    return config
  },
  (error) => Promise.reject(error)
)

// ── Response interceptor — handle 401 + stale-user 404 ─────────────────────
function clearAuthAndRedirect() {
  try {
    const raw    = localStorage.getItem('megamall-crm-auth')
    const parsed = JSON.parse(raw || '{}')
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

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    // 401 — token invalid/expired.
    if (status === 401) {
      clearAuthAndRedirect()
      return Promise.reject(error)
    }
    // 404 on /users/me — JWT is valid but the user record was deleted.
    // Treat the same as 401: clear auth and redirect to login.
    // Guard against infinite loop: only fire when not already on /login.
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
