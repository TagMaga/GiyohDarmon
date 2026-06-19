import { Navigate, Outlet } from 'react-router-dom'
import useAuthStore from '../store/authStore'
import { ROLE_HOME } from '../../app/router'

/**
 * ProtectedRoute — auth + role guard for protected sections.
 *
 * Behaviour:
 *   1. Store not yet hydrated from localStorage → show full-page spinner
 *      (prevents flash of /login for already-logged-in users on hard reload)
 *   2. No token → redirect to /login
 *   3. Token present but wrong role → redirect to the user's own home
 *   4. Token + correct role → render <Outlet />
 *
 * Props:
 *   allowedRole  {string}  — the single role allowed to access this section.
 *                            If omitted, any authenticated user passes.
 */
export default function ProtectedRoute({ allowedRole }) {
  const { token, role, _hasHydrated } = useAuthStore()

  // ── Waiting for localStorage rehydration ─────────────────────────────────
  if (!_hasHydrated) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
          <p className="text-sm text-slate-500">Загрузка…</p>
        </div>
      </div>
    )
  }

  // ── Not authenticated ─────────────────────────────────────────────────────
  if (!token) {
    return <Navigate to="/login" replace />
  }

  // ── Wrong role — send user to their own dashboard ─────────────────────────
  if (allowedRole && role !== allowedRole) {
    const home = ROLE_HOME[role] ?? '/login'
    return <Navigate to={home} replace />
  }

  return <Outlet />
}
