import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '../queryKeys'
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../api/notifications'

// Polls every 30s — no websocket infra exists yet, so this is the simplest
// way to keep the bell live across every role's session.
export default function useNotifications(options = {}) {
  const enabled = options.enabled ?? true
  const queryClient = useQueryClient()

  const listQuery = useQuery({
    queryKey: KEYS.notifications.list,
    queryFn: fetchNotifications,
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled,
  })

  const countQuery = useQuery({
    queryKey: KEYS.notifications.unreadCount,
    queryFn: fetchUnreadCount,
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled,
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: KEYS.notifications.list })
    queryClient.invalidateQueries({ queryKey: KEYS.notifications.unreadCount })
  }

  async function markRead(id) {
    await markNotificationRead(id)
    invalidate()
  }

  async function markAllRead() {
    await markAllNotificationsRead()
    invalidate()
  }

  return {
    notifications: listQuery.data ?? [],
    unreadCount: countQuery.data ?? 0,
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    error: listQuery.error,
    markRead,
    markAllRead,
  }
}
