import client from '../../shared/api/client'

/** Unwrap standard envelope { success, data } */
const unwrap = (res) => res.data.data

// ── Customers ────────────────────────────────────────────────────────────────
/** GET /customers/:id */
export async function fetchCustomerById(id) {
  const res = await client.get(`/customers/${id}`)
  return unwrap(res)
}

// ── Board ────────────────────────────────────────────────────────────────────
/** GET /dispatch/board — confirmed/assigned/in_delivery orders */
export async function fetchBoard() {
  const res = await client.get('/dispatch/board', { params: { limit: 200 } })
  return unwrap(res)
}

/** GET /orders?status=new — new orders waiting for confirmation */
export async function fetchNewOrders() {
  const res = await client.get('/orders', { params: { status: 'new', limit: 200 } })
  return unwrap(res)
}

/** GET /orders?status=issue — orders with active issues */
export async function fetchIssueOrders() {
  const res = await client.get('/orders', { params: { status: 'issue', limit: 200 } })
  return unwrap(res)
}

/** GET /orders?status=returned — returned orders */
export async function fetchReturnOrders() {
  const res = await client.get('/orders', { params: { status: 'returned', limit: 200 } })
  return unwrap(res)
}

/** GET /orders?status=delivered — recently delivered (for the board's Delivered column) */
export async function fetchDeliveredOrders() {
  const res = await client.get('/orders', { params: { status: 'delivered', limit: 60 } })
  return unwrap(res)
}

// ── Couriers ─────────────────────────────────────────────────────────────────
/** GET /dispatch/couriers/overview — courier workload summary */
export async function fetchCouriersOverview() {
  const res = await client.get('/dispatch/couriers/overview')
  return unwrap(res)
}

/** PATCH /dispatch/couriers/:id/order-intake */
export async function updateCourierOrderIntake(id, { enabled, reason = '' }) {
  const res = await client.patch(`/dispatch/couriers/${id}/order-intake`, {
    enabled,
    reason: reason?.trim() || undefined,
  })
  return unwrap(res)
}

/** PUT /dispatch/couriers/:id — edit courier profile */
export async function updateCourier(id, payload) {
  const res = await client.put(`/dispatch/couriers/${id}`, payload)
  return unwrap(res)
}

/** PATCH /dispatch/couriers/:id/active — toggle courier active */
export async function toggleCourierActive(id, active) {
  const res = await client.patch(`/dispatch/couriers/${id}/active`, { active })
  return unwrap(res)
}

/** GET /dispatch/couriers/:id/tariffs */
export async function fetchCourierTariffs(id) {
  const res = await client.get(`/dispatch/couriers/${id}/tariffs`)
  return unwrap(res)
}

/** POST /dispatch/couriers/:id/tariffs */
export async function createCourierTariff(id, payload) {
  const res = await client.post(`/dispatch/couriers/${id}/tariffs`, payload)
  return unwrap(res)
}

/** DELETE /dispatch/couriers/:id/tariffs/:ruleId */
export async function deleteCourierTariff(id, ruleId) {
  await client.delete(`/dispatch/couriers/${id}/tariffs/${ruleId}`)
}

/** GET /dispatch/cash/settlement — courier performance + cash settlement */
export async function fetchCashSettlement(params = {}) {
  const res = await client.get('/dispatch/cash/settlement', { params })
  return unwrap(res)
}

/** GET /dispatch/cash/transactions — full courier cash transaction history */
export async function fetchCashTransactions(params = {}) {
  const res = await client.get('/dispatch/cash/transactions', { params })
  // Return { data, meta } explicitly so arr() and meta() helpers work without
  // relying on the raw envelope shape (unlike unwrap() which drops meta).
  return { data: res.data.data, meta: res.data.meta }
}

/** GET /dispatch/history/orders — aggregated dispatcher order history */
export async function fetchDispatchOrderHistory(params = {}) {
  const res = await client.get('/dispatch/history/orders', { params })
  return { data: res.data.data, meta: res.data.meta }
}

// ── Cash handovers ───────────────────────────────────────────────────────────
/** GET /dispatch/cash/handovers */
export async function fetchHandovers() {
  const res = await client.get('/dispatch/cash/handovers')
  const raw = unwrap(res)
  const items = Array.isArray(raw) ? raw : (raw?.data ?? [])
  // Backend returns PascalCase struct fields — normalize to snake_case
  return items.map(h => ({
    id:                  h.ID                ?? h.id,
    courier_id:          h.CourierID         ?? h.courier_id,
    dispatcher_id:       h.DispatcherID      ?? h.dispatcher_id,
    total_collected:     h.TotalCollected    ?? h.total_collected    ?? 0,
    total_delivery_fees: h.TotalDeliveryFees ?? h.total_delivery_fees ?? 0,
    total_to_return:     h.TotalToReturn     ?? h.total_to_return     ?? 0,
    actual_returned:     h.ActualReturned    ?? h.actual_returned,
    status:              h.Status            ?? h.status             ?? 'pending',
    comment:             h.Comment           ?? h.comment,
    created_at:          h.CreatedAt         ?? h.created_at,
    confirmed_at:        h.ConfirmedAt       ?? h.confirmed_at,
    orders: (h.Orders ?? h.orders ?? []).map(o => ({
      id:                o.ID                ?? o.id,
      order_id:          o.OrderID           ?? o.order_id,
      order_total:       o.OrderTotal        ?? o.order_total        ?? 0,
      courier_collected: o.CourierCollected  ?? o.courier_collected  ?? 0,
      courier_returns:   o.CourierReturns    ?? o.courier_returns    ?? 0,
      delivery_fee:      o.DeliveryFee       ?? o.delivery_fee       ?? 0,
    })),
  }))
}

// ── Comments ──────────────────────────────────────────────────────────────────
/** GET /orders/:id/comments */
export async function fetchComments(orderId) {
  const res = await client.get(`/orders/${orderId}/comments`)
  return unwrap(res)
}

/** POST /orders/:id/comments */
export async function addComment(orderId, { comment }) {
  const res = await client.post(`/orders/${orderId}/comments`, { comment })
  return unwrap(res)
}

// ── Order mutations ───────────────────────────────────────────────────────────
/** POST /dispatch/orders/:id/confirm  (new → confirmed) */
export async function confirmOrder(id) {
  const res = await client.post(`/dispatch/orders/${id}/confirm`, {})
  return unwrap(res)
}

/** POST /dispatch/orders/:id/assign  (confirmed → assigned) */
export async function assignCourier(id, { courier_id, note = '' }) {
  const res = await client.post(`/dispatch/orders/${id}/assign`, { courier_id, note })
  return unwrap(res)
}

/** POST /dispatch/orders/:id/reassign */
export async function reassignCourier(id, { courier_id, note = '' }) {
  const res = await client.post(`/dispatch/orders/${id}/reassign`, { courier_id, note })
  return unwrap(res)
}

/** POST /dispatch/orders/:id/unassign — release courier, order returns to confirmed */
export async function unassignCourier(id) {
  const res = await client.post(`/dispatch/orders/${id}/unassign`)
  return unwrap(res)
}

/** POST /dispatch/orders/:id/schedule */
export async function scheduleOrder(id, { scheduled_at, comment = '' }) {
  const res = await client.post(`/dispatch/orders/${id}/schedule`, { scheduled_at, comment })
  return unwrap(res)
}

/** POST /dispatch/orders/:id/issue  (in_delivery → issue) */
export async function markIssue(id, { comment }) {
  const res = await client.post(`/dispatch/orders/${id}/issue`, { comment })
  return unwrap(res)
}

/** POST /dispatch/orders/:id/return */
export async function markReturn(id) {
  const res = await client.post(`/dispatch/orders/${id}/return`, {})
  return unwrap(res)
}

/** POST /dispatch/orders/:id/cancel */
export async function cancelOrder(id, { reason }) {
  const res = await client.post(`/dispatch/orders/${id}/cancel`, { comment: reason })
  return unwrap(res)
}

/** POST /dispatch/orders/:id/resolve-issue */
export async function resolveIssue(id, { to_status = 'assigned', comment = '' }) {
  const res = await client.post(`/dispatch/orders/${id}/resolve-issue`, { to_status, comment })
  return unwrap(res)
}

// ── Prepayment verification ────────────────────────────────────────────────────
/** POST /orders/:id/prepayment/verify */
export async function verifyPrepayment(id, { comment } = {}) {
  const res = await client.post(`/orders/${id}/prepayment/verify`, { comment })
  return unwrap(res)
}

/** POST /orders/:id/prepayment/reject */
export async function rejectPrepayment(id, { reason }) {
  const res = await client.post(`/orders/${id}/prepayment/reject`, { reason })
  return unwrap(res)
}

// ── Handover mutations ────────────────────────────────────────────────────────
/** POST /dispatch/cash/handovers/:id/confirm */
export async function confirmHandover(id, { actual_returned }) {
  const res = await client.post(`/dispatch/cash/handovers/${id}/confirm`, { actual_returned })
  return unwrap(res)
}

/** POST /dispatch/cash/handovers/:id/reject */
export async function rejectHandover(id, { reason }) {
  const res = await client.post(`/dispatch/cash/handovers/${id}/reject`, { comment: reason })
  return unwrap(res)
}

/** POST /dispatch/cash/transactions/:id/confirm */
export async function confirmCashTransaction(id) {
  const res = await client.post(`/dispatch/cash/transactions/${id}/confirm`, {})
  return unwrap(res)
}

/** POST /dispatch/cash/transactions/:id/reject */
export async function rejectCashTransaction(id, { reason }) {
  const res = await client.post(`/dispatch/cash/transactions/${id}/reject`, { reason })
  return unwrap(res)
}

// ── Cities ───────────────────────────────────────────────────────────────────
/** GET /cities — active delivery cities */
export async function fetchCities() {
  const res = await client.get('/cities')
  const parsed = unwrap(res)
  return Array.isArray(parsed) ? parsed : []
}

/** POST /cities — create a new delivery city (owner or dispatcher) */
export async function createCity(name) {
  const res = await client.post('/cities', { name })
  return unwrap(res)
}

// ── Order detail (full) ───────────────────────────────────────────────────────
/** GET /orders/:id — full order detail with customer, seller, items, attachments */
export async function fetchOrderDetail(id) {
  const res = await client.get(`/orders/${id}`)
  return unwrap(res)
}

/** GET /orders/:id/timeline — real backend timeline with actor names */
export async function fetchOrderTimeline(id) {
  const res = await client.get(`/orders/${id}/timeline`)
  return unwrap(res) ?? []
}

/** GET /orders/:id/prepayments — list of prepayment records */
export async function fetchOrderPrepayments(id) {
  const res = await client.get(`/orders/${id}/prepayments`)
  return unwrap(res) ?? []
}

// ── Office order creation (dispatcher) ───────────────────────────────────────

/** GET /dispatch/sellers — sellers the dispatcher can assign to an office order */
export async function fetchSellers() {
  const res = await client.get('/dispatch/sellers')
  return unwrap(res) ?? []
}

/** POST /orders — create an office order on behalf of a seller */
export async function createOfficeOrder(payload) {
  const res = await client.post('/orders', payload)
  return unwrap(res)
}
