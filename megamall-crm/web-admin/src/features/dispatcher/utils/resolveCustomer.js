/**
 * resolveCustomer
 *
 * Given an order and the customerMap from useCustomerMap, returns the best
 * available customer object (or a fallback shape).
 *
 * Priority:
 *   1. order.customer      — full object already embedded in response
 *   2. customerMap[id]     — fetched separately via GET /customers/:id
 *   3. fallback            — { full_name: 'Клиент #<shortId>', phone: null }
 *
 * This means downstream components never need to write null-checks for each
 * field — they always get a consistent { full_name, phone, address, city }
 * shape back.
 */
export function resolveCustomer(order, customerMap = {}) {
  if (order.customer && (order.customer.full_name || order.customer.phone)) {
    return order.customer
  }

  const id = order.customer_id
  if (id && customerMap[id]) {
    return customerMap[id]
  }

  // Graceful fallback — show shortened ID so dispatcher knows which order it is
  const shortId = id ? `#${id.slice(0, 8)}` : null
  return {
    full_name: shortId ? `Клиент ${shortId}` : null,
    phone:     null,
    address:   null,
    city:      null,
    _fallback: true,
  }
}

/**
 * resolveAddress
 *
 * Picks the best delivery address from an order's available fields.
 * Different backend DTOs use different field names.
 */
export function resolveAddress(order) {
  return (
    order.delivery_address ||
    order.address          ||
    order.customer?.address ||
    null
  )
}

export function resolveCity(order) {
  return (
    order.city             ||
    order.delivery_city    ||
    order.customer?.city   ||
    null
  )
}
