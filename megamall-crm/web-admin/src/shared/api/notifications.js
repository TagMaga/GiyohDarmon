import client from './client'

const unwrap = (res) => res.data?.data ?? res.data

export async function fetchNotifications() {
  const res = await client.get('/notifications', { params: { limit: 30 } })
  return unwrap(res)
}

export async function fetchUnreadCount() {
  const res = await client.get('/notifications/unread-count')
  return unwrap(res)?.count ?? 0
}

export async function markNotificationRead(id) {
  await client.post(`/notifications/${id}/read`)
}

export async function markAllNotificationsRead() {
  await client.post('/notifications/read-all')
}
