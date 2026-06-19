/**
 * useCurrentUser
 *
 * Decodes the JWT from auth store and returns { userId, role }.
 * Does NOT fetch the user object from the server — pure client-side decode.
 * Stable across renders (useMemo on token string).
 */
import { useMemo }    from 'react'
import { jwtDecode }  from 'jwt-decode'
import useAuthStore   from '../store/authStore'

export default function useCurrentUser() {
  const { token, role } = useAuthStore()

  return useMemo(() => {
    if (!token) return { userId: null, role: role ?? null }
    try {
      const decoded = jwtDecode(token)
      const userId  = decoded.user_id ?? decoded.sub ?? decoded.id ?? null
      return { userId, role: role ?? decoded.role ?? null }
    } catch {
      return { userId: null, role: role ?? null }
    }
  }, [token, role])
}
