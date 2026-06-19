import { useState, useCallback } from 'react'
import { useToast } from '../../../shared/components/ToastProvider'
import KanbanOrderCard from './KanbanOrderCard'
import { BOARD_COLUMNS, STATUS_HEX } from '../statusConfig'
import { getOrderId } from '../utils/orderHelpers'
import { ClipboardList } from 'lucide-react'

// Only these transitions trigger a real backend action via drag.
// Everything else is blocked with an explanation — couriers/automation own them.
const ALLOWED_DRAG_TRANSITIONS = {
  new:       ['confirmed'],
  confirmed: ['assigned'],
}

const BLOCKED_MESSAGES = {
  delivered:   'Перевод в «Доставлено» делает курьер из приложения',
  issue:       'Проблему отмечают из карточки заказа',
  in_delivery: 'Переход в «Доставку» происходит при выезде курьера',
}

function isDragAllowed(from, to) {
  return (ALLOWED_DRAG_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * KanbanBoard — the primary dispatcher workspace.
 *
 * Receives ALREADY-FILTERED orders (search/courier/city/status/date applied by
 * DispatcherBoard). Renders six columns on desktop; a single vertical column
 * with status chips on mobile (no horizontal scrolling).
 */
export default function KanbanBoard({
  orders = [],
  loading = false,
  onAction,
  customerMap = {},
  courierMap = {},
  selectedOrder,
  onSelectOrder,
}) {
  const [dragOverCol, setDragOverCol] = useState(null)
  const [mobileStatus, setMobileStatus] = useState('new')
  const toast = useToast()

  const colOrders = (key) => orders.filter((o) => o.status === key)
  const isCompact = orders.length > 0 && orders.length < 10

  const handleDrop = useCallback((e, colKey) => {
    e.preventDefault()
    setDragOverCol(null)
    const orderId    = e.dataTransfer.getData('orderId')
    const fromStatus = e.dataTransfer.getData('orderStatus')
    if (!orderId || fromStatus === colKey) return

    const order = orders.find((o) => getOrderId(o) === orderId)
    if (!order) return

    if (!isDragAllowed(fromStatus, colKey)) {
      toast.error(BLOCKED_MESSAGES[colKey] ?? `Переход «${fromStatus}» → «${colKey}» не поддерживается`)
      return
    }
    if (fromStatus === 'new' && colKey === 'confirmed')           onAction('confirm', order)
    else if (fromStatus === 'confirmed' && colKey === 'assigned') onAction('assign', order)
  }, [orders, onAction, toast])

  if (loading) {
    return (
      <div className="flex gap-3 h-full overflow-hidden">
        {BOARD_COLUMNS.map((col) => (
          <div key={col.key} className="flex-shrink-0 w-[270px]">
            <div className="h-9 rounded-lg mb-3 animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 rounded-xl mb-2 animate-pulse" style={{ background: 'rgba(255,255,255,0.04)', animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── DESKTOP: horizontal columns ─────────────────────────────────── */}
      <div className={`hidden lg:flex gap-3 flex-1 overflow-x-auto pb-1 min-h-0 ${isCompact ? 'justify-center' : ''}`}>
        {BOARD_COLUMNS.map((col) => {
          const items = colOrders(col.key)
          const accent = STATUS_HEX[col.key]
          const isOver = dragOverCol === col.key
          return (
            <div
              key={col.key}
              className="flex-shrink-0 flex flex-col rounded-2xl overflow-hidden transition-colors duration-150"
              style={{
                width: isCompact ? '220px' : '276px',
                background: isOver ? `${accent}14` : 'rgba(255,255,255,0.015)',
                border: `1px solid ${isOver ? accent + '55' : 'rgba(255,255,255,0.06)'}`,
                opacity: col.terminal ? 0.85 : 1,
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key) }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => handleDrop(e, col.key)}
            >
              <ColumnHeader col={col} accent={accent} count={items.length} />
              <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 min-h-0">
                {items.length === 0 ? (
                  <EmptyColumn col={col} />
                ) : (
                  items.map((order, i) => (
                    <KanbanOrderCard
                      key={getOrderId(order) || i}
                      order={order}
                      onAction={onAction}
                      customerMap={customerMap}
                      courierMap={courierMap}
                      onClick={onSelectOrder}
                      isSelected={selectedOrder && getOrderId(selectedOrder) === getOrderId(order)}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── MOBILE: status chips + single vertical list ─────────────────── */}
      <div className="lg:hidden flex flex-col h-full min-h-0">
        <div className="flex-shrink-0 flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
          {BOARD_COLUMNS.map((col) => {
            const count = colOrders(col.key).length
            const accent = STATUS_HEX[col.key]
            const active = mobileStatus === col.key
            return (
              <button
                key={col.key}
                onClick={() => setMobileStatus(col.key)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 transition-colors"
                style={{
                  background: active ? `${accent}26` : 'rgba(255,255,255,0.04)',
                  color: active ? accent : 'rgba(255,255,255,0.5)',
                  border: `1px solid ${active ? accent + '55' : 'rgba(255,255,255,0.08)'}`,
                }}
              >
                {col.label}
                <span className="text-[10px] tabular-nums opacity-80">{count}</span>
              </button>
            )
          })}
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0 pt-1">
          {colOrders(mobileStatus).length === 0 ? (
            <EmptyColumn col={BOARD_COLUMNS.find(c => c.key === mobileStatus) ?? BOARD_COLUMNS[0]} />
          ) : (
            colOrders(mobileStatus).map((order, i) => (
              <KanbanOrderCard
                key={getOrderId(order) || i}
                order={order}
                onAction={onAction}
                customerMap={customerMap}
                courierMap={courierMap}
                onClick={onSelectOrder}
                isSelected={selectedOrder && getOrderId(selectedOrder) === getOrderId(order)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function ColumnHeader({ col, accent, count }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />
        <span className="text-[13px] font-semibold text-white/80 truncate">{col.label}</span>
        <span className="text-[10px] text-white/25 truncate hidden xl:inline">{col.hint}</span>
      </div>
      <span
        className="text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums flex-shrink-0"
        style={{ background: `${accent}1f`, color: accent }}
      >
        {count}
      </span>
    </div>
  )
}

const EMPTY_STATES = {
  new:         { title: 'Нет новых заказов',       hint: 'Новые заказы появятся здесь' },
  confirmed:   { title: 'Все заказы назначены',      hint: 'Нет заказов, ожидающих курьера' },
  assigned:    { title: 'Нет назначенных заказов',   hint: 'Назначьте курьера для заказа' },
  in_delivery: { title: 'Нет активных доставок',     hint: 'Здесь заказы, которые везут' },
  issue:       { title: 'Проблем не обнаружено',     hint: 'Все заказы обрабатываются штатно' },
  delivered:   { title: 'Нет завершённых доставок',  hint: 'Завершённые заказы за сегодня' },
}

function EmptyColumn({ col }) {
  const accent = STATUS_HEX[col?.key] ?? '#64748b'
  const state  = EMPTY_STATES[col?.key]
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center px-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5"
        style={{ background: `${accent}12` }}
      >
        <ClipboardList size={16} style={{ color: `${accent}55` }} />
      </div>
      <p className="text-[12px] font-semibold text-white/30">
        {state?.title ?? 'Нет заказов'}
      </p>
      {state?.hint && (
        <p className="text-[10px] text-white/15 mt-1 leading-snug">{state.hint}</p>
      )}
    </div>
  )
}
