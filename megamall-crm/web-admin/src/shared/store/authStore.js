import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Auth store — persisted to localStorage.
 *
 * Hydration note: `_hasHydrated` starts false. The `onRehydrateStorage`
 * callback flips it to true once localStorage values are read. Components
 * that guard routes must wait for hydration before deciding to redirect, to
 * avoid a flash of the login page for already-authenticated users.
 */
const useAuthStore = create(
  persist(
    (set) => ({
      // ── Persisted state ─────────────────────────────────────────────────
      token:        null,   // access_token (JWT)
      refreshToken: null,   // refresh_token (stored, not auto-rotated in Phase 7)
      role:         null,   // decoded from JWT claim
      phone:        null,   // stored from login form input

      // ── Hydration flag — NOT persisted ──────────────────────────────────
      _hasHydrated: false,

      // ── Actions ─────────────────────────────────────────────────────────
      setAuth: (token, refreshToken, role, phone) =>
        set({ token, refreshToken, role, phone }),

      clearAuth: () =>
        set({ token: null, refreshToken: null, role: null, phone: null }),

      _setHydrated: () => set({ _hasHydrated: true }),
    }),
    {
      name: 'megamall-crm-auth',
      storage: createJSONStorage(() => localStorage),
      // Exclude the transient hydration flag from persistence
      partialize: (state) => ({
        token:        state.token,
        refreshToken: state.refreshToken,
        role:         state.role,
        phone:        state.phone,
      }),
      onRehydrateStorage: () => (state) => {
        // Called after the store has been rehydrated from localStorage
        state?._setHydrated()
      },
    }
  )
)

export default useAuthStore
