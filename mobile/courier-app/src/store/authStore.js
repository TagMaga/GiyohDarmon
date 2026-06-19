import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import { getMe } from '../api/auth'

const useAuthStore = create((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,

  setAuth: async (accessToken, refreshToken) => {
    await SecureStore.setItemAsync('access_token', accessToken)
    await SecureStore.setItemAsync('refresh_token', refreshToken)
    set({ accessToken, refreshToken, isAuthenticated: true })
  },

  setUser: (user) => set({ user }),

  rehydrate: async () => {
    try {
      const accessToken = await SecureStore.getItemAsync('access_token')
      const refreshToken = await SecureStore.getItemAsync('refresh_token')
      if (accessToken && refreshToken) {
        set({ accessToken, refreshToken, isAuthenticated: true })
        try {
          const { data } = await getMe()
          set({ user: data.data })
        } catch {
          // getMe failed — refresh token may have been expired/revoked; force re-login
          await SecureStore.deleteItemAsync('access_token')
          await SecureStore.deleteItemAsync('refresh_token')
          set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
        }
      }
    } catch {}
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('access_token')
    await SecureStore.deleteItemAsync('refresh_token')
    set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
  },
}))

export default useAuthStore
