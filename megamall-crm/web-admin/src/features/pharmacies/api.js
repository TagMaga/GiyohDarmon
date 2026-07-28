import client from '../../shared/api/client'

const unwrap = response => response?.data?.data ?? response?.data

export const fetchPharmacies = async params => unwrap(await client.get('/pharmacies', { params }))
export const fetchPharmacyDashboard = async params => unwrap(await client.get('/pharmacies/dashboard', { params }))
export const fetchPharmacy = async id => unwrap(await client.get(`/pharmacies/${id}`))
export const createPharmacy = async payload => unwrap(await client.post('/pharmacies', payload))
export const updatePharmacy = async ({ id, payload }) => unwrap(await client.put(`/pharmacies/${id}`, payload))
export const archivePharmacy = async id => unwrap(await client.post(`/pharmacies/${id}/archive`))
export const transferPharmacy = async ({ id, payload }) => unwrap(await client.post(`/pharmacies/${id}/transfer-responsibility`, payload))

export const createPharmacyInvoice = async payload => unwrap(await client.post('/pharmacies/invoices', payload))
export const acceptPharmacyInvoice = async id => unwrap(await client.post(`/pharmacies/invoices/${id}/accept`))
export const rejectPharmacyInvoice = async ({ id, reason }) => unwrap(await client.post(`/pharmacies/invoices/${id}/reject`, { reason }))

export const createPharmacyPayment = async payload => unwrap(await client.post('/pharmacies/payments', payload))
export const confirmPharmacyPayment = async id => unwrap(await client.post(`/pharmacies/payments/${id}/confirm`))
export const rejectPharmacyPayment = async ({ id, reason }) => unwrap(await client.post(`/pharmacies/payments/${id}/reject`, { reason }))
export const correctPharmacyPayment = async ({ id, payload }) => unwrap(await client.put(`/pharmacies/payments/${id}`, payload))

export const createPharmacyReturn = async payload => unwrap(await client.post('/pharmacies/returns', payload))
export const processPharmacyReturn = async ({ id, payload }) => unwrap(await client.post(`/pharmacies/returns/${id}/process`, payload))

export const fetchSellerOptions = async () => {
  const body = unwrap(await client.get('/users', { params: { role: 'seller', is_active: true, limit: 500 } }))
  return Array.isArray(body) ? body : []
}

export const fetchProductOptions = async () => {
  const body = unwrap(await client.get('/products', { params: { is_active: true, limit: 500 } }))
  return Array.isArray(body) ? body : []
}
