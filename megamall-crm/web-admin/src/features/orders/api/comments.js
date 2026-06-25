import client from '../../../shared/api/client'

const unwrap = (res) => {
  const body = res.data
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return body.data
  }
  return body
}

export async function fetchOrderComments(orderId) {
  const res = await client.get(`/orders/${orderId}/comments`)
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
}

export async function addOrderComment(orderId, comment) {
  const res = await client.post(`/orders/${orderId}/comments`, { comment })
  return unwrap(res)
}
