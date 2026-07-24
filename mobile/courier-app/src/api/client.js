import axios from 'axios'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'
import { router } from 'expo-router'

/**
 * Resolve the backend base URL.
 *
 * In dev (Expo Go) the backend runs on the same machine as the Metro bundler, so
 * we derive its LAN IP from the Metro connection (`hostUri`). This means the app
 * always points at the right host even when the laptop's WiFi IP changes — no
 * more editing .env and getting a misleading "wrong password" because the phone
 * couldn't reach a stale IP.
 *
 * In production builds there is no Metro host, so EXPO_PUBLIC_API_URL must be set.
 */
function resolveApiUrl() {
  const envUrl = process.env.EXPO_PUBLIC_API_URL

  if (__DEV__) {
    const hostUri =
      Constants.expoConfig?.hostUri ||
      Constants.expoGoConfig?.debuggerHost ||
      Constants.manifest2?.extra?.expoGo?.debuggerHost ||
      Constants.manifest?.debuggerHost ||
      ''
    const host = hostUri.split(':')[0]
    if (host) return `http://${host}:8080`
  }

  return envUrl || 'https://giyohdarmon.tj'
}

export const API_URL = resolveApiUrl()
if (__DEV__) console.log('[api] base URL =', API_URL)

const client = axios.create({ baseURL: `${API_URL}/api/v1`, timeout: 10000 })

let isRefreshing = false
let queue = []

const processQueue = (error, token = null) => {
  queue.forEach(p => error ? p.reject(error) : p.resolve(token))
  queue = []
}

client.interceptors.request.use(async (cfg) => {
  const token = await SecureStore.getItemAsync('access_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

client.interceptors.response.use(
  r => r,
  async (err) => {
    const orig = err.config
    if (err.response?.status !== 401 || orig._retry) return Promise.reject(err)

    // Never try to refresh on auth endpoints — their 401s are real errors (wrong
    // credentials, expired token passed to /refresh, etc.), not session expiry.
    if (orig.url?.includes('/auth/')) return Promise.reject(err)

    if (isRefreshing) {
      return new Promise((resolve, reject) => queue.push({ resolve, reject }))
        .then(token => {
          orig.headers.Authorization = `Bearer ${token}`
          return client(orig)
        })
    }

    orig._retry = true
    isRefreshing = true

    try {
      const refreshToken = await SecureStore.getItemAsync('refresh_token')
      if (!refreshToken) throw new Error('no_refresh_token')
      const { data } = await axios.post(`${API_URL}/api/v1/auth/refresh`, { refresh_token: refreshToken })
      // Backend wraps response in { success, data: { access_token, refresh_token } }
      const tokens = data.data
      await SecureStore.setItemAsync('access_token', tokens.access_token)
      await SecureStore.setItemAsync('refresh_token', tokens.refresh_token)
      processQueue(null, tokens.access_token)
      orig.headers.Authorization = `Bearer ${tokens.access_token}`
      return client(orig)
    } catch (e) {
      processQueue(e)
      await SecureStore.deleteItemAsync('access_token')
      await SecureStore.deleteItemAsync('refresh_token')
      // Sync zustand store — late-bound via require to avoid the circular import
      // authStore → auth → client. By the time this catch fires all modules are loaded.
      try {
        const useAuthStore = require('../store/authStore').default
        useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
      } catch {}
      router.replace('/(auth)/login')
      return Promise.reject(e)
    } finally {
      isRefreshing = false
    }
  }
)

export default client
