// Re-export shared helpers so courier code imports from one place
export { getOrderId, getOrderNumber, formatOrderLabel } from '../../dispatcher/utils/orderHelpers'

/**
 * getStatus — reads status from either snake_case or PascalCase field.
 */
export function getStatus(order) {
  if (!order) return null
  return order.status ?? order.Status ?? null
}

/**
 * normalizeCourierOrder — collapses PascalCase / snake_case field variants
 * into a stable, predictable object shape for rendering.
 */
export function normalizeCourierOrder(order) {
  if (!order) return null

  const customer = order.customer ?? order.Customer ?? null

  return {
    // identity
    id:              order.id           ?? order.ID           ?? order.order_id  ?? order.OrderID  ?? null,
    order_number:    order.order_number ?? order.OrderNumber  ?? order.number    ?? null,
    status:          order.status       ?? order.Status       ?? null,

    // customer
    customer,
    customer_id:     order.customer_id  ?? order.CustomerID   ?? null,
    customer_name:   customer?.full_name ?? customer?.FullName ?? null,
    customer_phone:  customer?.phone     ?? customer?.Phone    ?? null,

    // financials
    total_amount:    order.total_amount     ?? order.TotalAmount     ?? order.product_total    ?? 0,
    delivery_fee:    order.delivery_fee     ?? order.DeliveryFee     ?? 0,
    prepayment:      order.prepayment_amount ?? order.PrepaymentAmount ?? 0,
    amount_to_collect: order.amount_to_collect ?? order.courier_collect_amount ?? null,
    payment_label:   order.payment_label    ?? null,
    delivery_method: order.delivery_method  ?? order.DeliveryMethod  ?? 'normal',

    // delivery details
    delivery_address: order.delivery_address ?? order.DeliveryAddress ?? null,
    city:             order.city             ?? order.City             ?? null,
    notes:            order.notes            ?? order.Notes            ?? null,
    scheduled_at:     order.scheduled_at     ?? order.ScheduledAt      ?? null,

    // raw ref (for actions that need original fields)
    _raw: order,
  }
}

// ── Status config ─────────────────────────────────────────────────────────────

export const STATUS_LABEL = {
  assigned:    'Назначен',
  in_delivery: 'В доставке',
  delivered:   'Доставлен',
  returned:    'Возврат',
  issue:       'Проблема',
  new:         'Новый',
  confirmed:   'Подтверждён',
  cancelled:   'Отменён',
}

export const STATUS_BADGE = {
  assigned:    'indigo',
  in_delivery: 'sky',
  delivered:   'emerald',
  returned:    'orange',
  issue:       'rose',
  new:         'slate',
  confirmed:   'violet',
  cancelled:   'slate',
}

// ── Date helpers ──────────────────────────────────────────────────────────────

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day:   '2-digit',
  month: '2-digit',
  year:  'numeric',
  hour:  '2-digit',
  minute:'2-digit',
})

export function fmtDateTime(iso) {
  if (!iso) return null
  try { return dateFmt.format(new Date(iso)) } catch { return iso }
}

const currFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
export function fmtMoney(n) {
  const num = Number(n)
  if (Number.isNaN(num)) return '—'
  return `${currFmt.format(num)} сом`
}

// ── Attempt result options ─────────────────────────────────────────────────────

export const ATTEMPT_RESULTS = [
  { value: 'no_answer',          label: 'Не отвечает' },
  { value: 'busy',               label: 'Занято' },
  { value: 'rescheduled',        label: 'Перенос' },
  { value: 'wrong_address',      label: 'Неверный адрес' },
  { value: 'customer_cancelled', label: 'Клиент отказался' },
  { value: 'refused',            label: 'Отказ при получении' },
  { value: 'other',              label: 'Другое' },
]
