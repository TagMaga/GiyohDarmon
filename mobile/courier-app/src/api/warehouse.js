import client from './client'

// Lost-product photo evidence uses the legacy authenticated /uploads
// endpoint (returns a plain served URL) rather than the private media
// pipeline — internal/warehouses.LostProductReport.PhotoURL is a plain URL
// column, not a media_asset_id, so there's no signed-URL resolution to
// wire up on the read side. Known simplification: unlike cash-handover
// proofs, this file is served from a public (if unguessable) URL once
// uploaded rather than access-controlled per the private media pipeline.
export async function uploadLostProductPhoto(file) {
  const form = new FormData()
  form.append('file', file)
  const res = await client.post('/uploads', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  return res.data?.data?.url ?? res.data?.url
}

export const getMyWarehouse = () => client.get('/courier/warehouse')
export const getMyTransfers = (params) => client.get('/courier/warehouse/transfers', { params })
export const acceptTransfer = (id) => client.post(`/courier/warehouse/transfers/${id}/accept`)
export const rejectTransfer = (id) => client.post(`/courier/warehouse/transfers/${id}/reject`)
export const createFullReturn = (toWarehouseId) =>
  client.post('/courier/warehouse/returns', { to_warehouse_id: toWarehouseId })
export const reportLostProduct = (data) => client.post('/courier/warehouse/lost-reports', data)
export const getMyLostReports = (params) => client.get('/courier/warehouse/lost-reports', { params })
