/**
 * Shared order status configuration.
 * Used by both seller (Phase 9) and dispatcher (Phase 8) features.
 * Dispatcher's statusConfig.js keeps its own action lists but may import
 * STATUS_LABELS / STATUS_BADGE from here in a future refactor.
 */

export const STATUS_LABELS = {
  new:                  'Новый',
  confirmed:            'Подтверждён',
  prepayment_pending:   'Ожидает предоплату',
  prepayment_received:  'Предоплата получена',
  assigned:             'Назначен',
  in_delivery:          'В пути',
  delivered:            'Доставлен',
  returned:             'Возврат',
  cancelled:            'Отменён',
  issue:                'Проблема',
}

export const STATUS_BADGE = {
  new:                  'indigo',
  confirmed:            'sky',
  prepayment_pending:   'amber',
  prepayment_received:  'violet',
  assigned:             'violet',
  in_delivery:          'amber',
  delivered:            'emerald',
  returned:             'orange',
  cancelled:            'slate',
  issue:                'rose',
}

/** Statuses that a seller can filter by in their orders list */
export const SELLER_STATUS_FILTERS = [
  { key: 'all',        label: 'Все'             },
  { key: 'new',        label: 'Новые'           },
  { key: 'confirmed',  label: 'Подтверждённые'  },
  { key: 'assigned',   label: 'Назначенные'     },
  { key: 'in_delivery',label: 'В пути'          },
  { key: 'delivered',  label: 'Доставлено'      },
  { key: 'cancelled',  label: 'Отменены'        },
]

/** Format amount to Russian locale */
export function fmtAmount(val) {
  if (val == null || val === '') return '—'
  return Number(val).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/** Format ISO datetime to short Russian string */
export function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}
