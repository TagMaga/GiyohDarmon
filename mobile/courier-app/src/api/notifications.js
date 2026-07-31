import client from './client'

export const getNotifications = () => client.get('/notifications', { params: { limit: 30 } })
export const getUnreadCount = () => client.get('/notifications/unread-count')
export const markNotificationRead = (id) => client.post(`/notifications/${id}/read`)
export const markAllNotificationsRead = () => client.post('/notifications/read-all')
export const registerPushToken = (token, platform) => client.put('/courier/push-token', { token, platform })
