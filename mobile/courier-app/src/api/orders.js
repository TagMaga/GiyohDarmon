import client from './client'

export const getMyOrders = (params) => client.get('/courier/my-orders', { params })
export const getClaimableOrders = () => client.get('/courier/available')
export const claimOrder = (id) => client.post(`/courier/available/${id}/claim`)

const STATUS_ENDPOINT = {
  in_delivery:     'start',
  delivered:       'delivered',
  returned:        'returned',
  issue:           'issue',
  address_changed: 'address-changed',
}
export const updateOrderStatus = (id, status, data = {}) =>
  client.post(`/courier/orders/${id}/${STATUS_ENDPOINT[status] || status}`, data)

export const reportAddressChanged = (id, newAddress) =>
  client.post(`/courier/orders/${id}/address-changed`, { new_address: newAddress || '' })

export const deferOrder = (id, scheduledAt) =>
  client.post(`/courier/orders/${id}/defer`, { scheduled_at: scheduledAt })

export const getCashSummary = () => client.get('/courier/cash/summary')
export const submitHandover = (data) => client.post('/courier/cash/handover', data)
export const getHandoverHistory = () => client.get('/courier/cash/handovers')
