import { useMemo } from 'react'
import useCurrentUser from './useCurrentUser'
import { useSellerMe } from '../../features/seller/hooks/useSellerMe'
import useAuthStore from '../store/authStore'

export default function useProfile() {
  const { userId, teamId } = useCurrentUser()
  const { phone, role } = useAuthStore()
  const { data: me } = useSellerMe()

  const fullName = me?.full_name ?? me?.FullName ?? null

  const initials = useMemo(() => {
    if (fullName) {
      const words = fullName.trim().split(/\s+/).filter(Boolean)
      return words.map(w => w[0]).slice(0, 2).join('').toUpperCase()
    }
    // Role-based fallback — never show phone digits
    if (role) {
      const parts = role.split('_').filter(Boolean)
      return parts.length >= 2
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : role.slice(0, 2).toUpperCase()
    }
    return 'U'
  }, [fullName, role])

  return { fullName, initials, phone, role, userId, teamId, employee: me }
}
