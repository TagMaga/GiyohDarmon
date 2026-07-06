/**
 * Dispatcher status configuration — SINGLE SOURCE OF TRUTH.
 *
 * Labels, status colors, per-status actions, board columns, and the date
 * helpers shared across the board, cards, drawer, and filters.
 *
 * (KPI_DEFS / STATUS_TABS / STATUS_BADGE were removed in the v2 redesign —
 *  the KPI cards, tab bar, and table they fed are gone.)
 */

export const STATUS_LABELS = {
  new:         'Новый',
  confirmed:   'Подтверждён',
  assigned:    'Назначен',
  in_delivery: 'В доставке',
  delivered:   'Доставлен',
  returned:    'Возврат',
  cancelled:   'Отменён',
  issue:       'Проблема',
}

/** One hex per status — used by board columns, cards, drawer dots. */
export const STATUS_HEX = {
  new:         '#6366f1',
  confirmed:   '#0ea5e9',
  assigned:    '#8b5cf6',
  in_delivery: '#f59e0b',
  delivered:   '#10b981',
  issue:       '#ef4444',
  returned:    '#f97316',
  cancelled:   '#64748b',
}

/**
 * Board columns, left → right, in operational flow order.
 * `terminal: true` columns are read-only outcomes (collapsed by default).
 */
export const BOARD_COLUMNS = [
  { key: 'new',         label: 'Новые',      hint: 'Ждут подтверждения' },
  { key: 'confirmed',   label: 'Подтверждён', hint: 'Готовы к назначению' },
  { key: 'assigned',    label: 'Назначен',   hint: 'Курьер выбран' },
  { key: 'in_delivery', label: 'В доставке', hint: 'В пути' },
  { key: 'issue',       label: 'Проблемы',   hint: 'Требуют решения' },
  { key: 'delivered',   label: 'Доставлено', hint: 'Сегодня', terminal: true },
]

/**
 * Actions available per order status. { key, label, variant }
 * variant: 'primary' | 'danger' | 'secondary'
 */
export const STATUS_ACTIONS = {
  new: [
    { key: 'confirm',  label: 'Подтвердить', variant: 'primary'   },
    { key: 'cancel',   label: 'Отменить',    variant: 'danger'    },
    { key: 'comment',  label: 'Комментарий', variant: 'secondary' },
  ],
  confirmed: [
    { key: 'assign',   label: 'Назначить',    variant: 'primary'   },
    { key: 'schedule', label: 'Запланировать', variant: 'secondary' },
    { key: 'cancel',   label: 'Отменить',     variant: 'danger'    },
    { key: 'comment',  label: 'Комментарий',  variant: 'secondary' },
  ],
  assigned: [
    { key: 'reassign', label: 'Переназначить', variant: 'secondary' },
    { key: 'unassign', label: 'Снять курьера',  variant: 'secondary' },
    { key: 'issue',    label: 'Проблема',     variant: 'danger'    },
    { key: 'comment',  label: 'Комментарий',  variant: 'secondary' },
  ],
  in_delivery: [
    { key: 'unassign', label: 'Снять курьера', variant: 'secondary' },
    { key: 'issue',    label: 'Проблема',    variant: 'danger'    },
    { key: 'return',   label: 'Возврат',     variant: 'secondary' },
    { key: 'comment',  label: 'Комментарий', variant: 'secondary' },
  ],
  issue: [
    { key: 'resolve',  label: 'Решить',      variant: 'primary'   },
    { key: 'unassign', label: 'Снять курьера', variant: 'secondary' },
    { key: 'return',   label: 'Возврат',     variant: 'secondary' },
    { key: 'cancel',   label: 'Отменить',    variant: 'danger'    },
    { key: 'comment',  label: 'Комментарий', variant: 'secondary' },
  ],
  delivered:  [{ key: 'comment', label: 'Комментарий', variant: 'secondary' }],
  returned:   [{ key: 'comment', label: 'Комментарий', variant: 'secondary' }],
  cancelled:  [{ key: 'comment', label: 'Комментарий', variant: 'secondary' }],
}

// ── Date / urgency helpers (shared by card, drawer, filters, counters) ─────────

const TERMINAL = new Set(['delivered', 'cancelled', 'returned'])

/**
 * Resolve the start and end timestamps for timing an order.
 *
 * Start: assigned_at if the order is in active delivery, otherwise created_at.
 * End:   delivered_at / updated_at when terminal (frozen); Date.now() otherwise.
 */
function resolveTimeBounds(order) {
  const status = order?.status
  const isTerminal = TERMINAL.has(status)
  const isActive = status === 'in_delivery' || status === 'assigned'

  // Start: for in-flight orders, count from when the courier was assigned.
  // For everything else (new/confirmed), count from order creation.
  const startStr = (isActive && order?.assigned_at) ? order.assigned_at : order?.created_at
  const start = startStr ? new Date(startStr).getTime() : null

  // End: freeze the clock when the order is done.
  const endStr = isTerminal ? (order?.delivered_at ?? order?.updated_at) : null
  const end = endStr ? new Date(endStr).getTime() : Date.now()

  return { start, end }
}

/**
 * Age in minutes — used for urgency colour coding.
 * Accepts the full order object. Returns -1 if no date available.
 */
export function orderAgeMinutes(order) {
  const { start, end } = resolveTimeBounds(order)
  if (!start) return -1
  return Math.floor((end - start) / 60000)
}

/**
 * Short human-readable age label: "12м" / "3ч 5м" / "2д".
 * Accepts the full order object.
 * - new / confirmed → time since created_at (how long waiting)
 * - assigned / in_delivery → time since assigned_at (how long courier is on the road)
 * - delivered / returned / cancelled → frozen duration at completion time
 */
export function orderAge(order) {
  const { start, end } = resolveTimeBounds(order)
  if (!start) return null
  const mins = Math.floor((end - start) / 60000)
  if (mins < 1)  return 'сейчас'
  if (mins < 60) return `${mins}м`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  if (hrs < 24) return rem > 0 ? `${hrs}ч ${rem}м` : `${hrs}ч`
  return `${Math.floor(hrs / 24)}д`
}

/** A non-terminal order is urgent if it has been unactioned > 2h since creation. */
export function isUrgent(order) {
  if (!order?.created_at) return false
  if (TERMINAL.has(order.status)) return false
  return Date.now() - new Date(order.created_at).getTime() > 2 * 60 * 60 * 1000
}

/** Overdue = scheduled in the past while still in an active delivery state. */
export function isOverdue(order) {
  const when = order?.scheduled_at || order?.delivery_date
  if (!when) return false
  if (!['confirmed', 'assigned', 'in_delivery'].includes(order.status)) return false
  return new Date(when).getTime() < Date.now()
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate()
}

export function isToday(dateStr) {
  if (!dateStr) return false
  return sameDay(new Date(dateStr), new Date())
}

export function isTomorrow(dateStr) {
  if (!dateStr) return false
  const t = new Date()
  t.setDate(t.getDate() + 1)
  return sameDay(new Date(dateStr), t)
}

/** Format currency (no symbol — caller appends "смн"). */
export function fmt(val) {
  if (val == null) return '—'
  return Number(val).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/** Format datetime to short Russian locale. */
export function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}
