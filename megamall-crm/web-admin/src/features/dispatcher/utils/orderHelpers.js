/**
 * getOrderId
 *
 * Extracts the order UUID from any order DTO regardless of field name casing.
 * Different backend endpoints return different shapes:
 *   - GET /dispatch/board   → { id: "..." }
 *   - GET /orders           → { id: "..." } or { ID: "..." }
 *   - Some DTOs             → { order_id: "..." } / { OrderID: "..." }
 *
 * Returns null when no id field is found — callers must guard against this.
 */
export function getOrderId(order) {
  if (!order) return null
  return (
    order.id      ||
    order.ID      ||
    order.order_id ||
    order.OrderID  ||
    order.orderId  ||
    null
  )
}

/**
 * getOrderNumber
 *
 * Returns the human-readable order number for display.
 * Never use this value as an API id — use getOrderId() for that.
 */
export function getOrderNumber(order) {
  if (!order) return '—'
  return (
    order.order_number  ||
    order.OrderNumber   ||
    order.number        ||
    null
  )
}

/**
 * formatOrderLabel
 *
 * Produces a short display label like "ORD-0042" or "abc12345" (truncated id).
 * Safe to use in modal titles and toast messages.
 */
export function formatOrderLabel(order) {
  const num = getOrderNumber(order)
  if (num) return num
  const id = getOrderId(order)
  return id ? id.slice(0, 8) : '—'
}

/**
 * getCourierId — the assigned courier's id, regardless of DTO shape.
 * The board endpoint returns only `courier_id`; the orders endpoint may embed.
 */
export function getCourierId(order) {
  if (!order) return null
  return (
    order.courier_id ||
    order.current_courier_id ||
    order.delivered_by_courier_id ||
    order.courier?.id ||
    order.assigned_courier?.id ||
    order.assignment?.courier_id ||
    null
  )
}

/**
 * buildCourierMap — index a couriers-overview array by courier id.
 * Lets the board resolve courier names that the board DTO omits.
 */
export function buildCourierMap(couriers = []) {
  const map = {}
  for (const c of couriers) {
    const id = c.courier_id ?? c.id
    if (id) map[id] = c
  }
  return map
}

/**
 * resolveCourier — best available courier { full_name, phone } for an order,
 * or null when unassigned. Prefers an embedded object, falls back to the map.
 */
export function resolveCourier(order, courierMap = {}) {
  const embedded =
    order?.courier ?? order?.assigned_courier ?? order?.assignment?.courier
  if (embedded?.full_name) return embedded

  // Backend-resolved display name (orders endpoint exposes courier_display_name
  // for delivered/active orders even when the live assignment is gone).
  if (order?.courier_display_name) return { full_name: order.courier_display_name }

  const id = getCourierId(order) || order?.current_courier_id || order?.delivered_by_courier_id
  if (id && courierMap[id]) {
    const c = courierMap[id]
    return { full_name: c.full_name ?? c.courier?.full_name, phone: c.phone ?? c.courier?.phone }
  }
  return null
}

/**
 * resolveCourierDisplay — the single source of truth for how the UI labels an
 * order's courier. Prefers the backend's resolved fields (courier_display_name /
 * courier_display_status) and falls back to map resolution for board DTOs that
 * only carry courier_id.
 *
 * Returns { name, status, label, prefix }:
 *   - delivered_by → label "Доставил заказ",  prefix "Доставил:"
 *   - assigned     → label "Назначен",        prefix null
 *   - former       → label "Был назначен",    prefix null
 *   - unassigned   → name null → caller shows "Без курьера"
 */
export function resolveCourierDisplay(order, courierMap = {}) {
  const c = resolveCourier(order, courierMap)
  const name = c?.full_name ?? null

  let status = order?.courier_display_status
  if (!status) status = name ? 'assigned' : 'unassigned'
  // A delivered order must never read as unassigned when a courier is known.
  if (order?.status === 'delivered' && name) status = 'delivered_by'

  const LABELS = {
    delivered_by: { label: 'Доставил заказ', prefix: 'Доставил:' },
    assigned:     { label: 'Назначен',        prefix: null },
    former:       { label: 'Был назначен',    prefix: null },
    unassigned:   { label: null,              prefix: null },
  }
  const meta = LABELS[status] ?? LABELS.unassigned
  return { name, status, label: meta.label, prefix: meta.prefix }
}
