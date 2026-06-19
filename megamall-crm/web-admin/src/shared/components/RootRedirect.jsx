import { Navigate } from 'react-router-dom'
import useAuthStore from '../store/authStore'
import { ROLE_HOME } from '../../app/router'

/**
 * RootRedirect — sits at "/" and sends the user to the right dashboard
 * based on their role, or to /login if not authenticated.
 */
export default function RootRedirect() {
  const { token, role, _hasHydrated } = useAuthStore()

  if (!_hasHydrated) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!token) return <Navigate to="/login" replace />

  const home = ROLE_HOME[role] ?? '/login'
  return <Navigate to={home} replace />
}
