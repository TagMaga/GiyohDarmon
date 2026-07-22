import { Search, X, Clock, Loader2, Check, AlertTriangle, Truck } from 'lucide-react'
import { C, chipStyle } from './theme'
import { resolveCustomer, resolveAddress, resolveCity } from '../utils/resolveCustomer'
import { resolveCourierDisplay, formatOrderLabel, getOrderId } from '../utils/orderHelpers'
import { fmt, isOverdue, isToday, isTomorrow, orderAge } from '../statusConfig'

const DATE_OPTIONS = [
  { value: 'all', label: 'Все' },
  { value: 'today', label: 'Сегодня' },
  { value: 'tomorrow', label: 'Завтра' },
  { value: 'overdue', label: 'Просрочено' },
]

export default function DispatchTab({
  search, onSearch, dateFilter, onDateFilter, columns, colFilter, onColFilter,
  grouped, customerMap, courierMap, onSelectOrder, onAction, isConfirming, loading, onOpenCreate,
}) {
  const activeCol = columns.find((c) => c.key === colFilter) ?? columns[0]
  const orders = grouped[colFilter] ?? []

  return (
    <div>
      {/* Search */}
      <div style={{ padding: '0 18px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '9px 12px' }}>
          <Search size={15} color={C.text3} />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Поиск: имя, №, адрес"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 13, color: C.text1 }}
          />
          {search && (
            <button onClick={() => onSearch('')} style={{ border: 'none', background: 'transparent', color: C.text3, cursor: 'pointer', display: 'flex', padding: 0 }}>
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Date chips */}
      <div className="dm-scroll" style={{ display: 'flex', gap: 7, padding: '0 18px 12px', overflowX: 'auto' }}>
        {DATE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onDateFilter(opt.value)}
            style={{ flexShrink: 0, padding: '7px 13px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', ...chipStyle(dateFilter === opt.value) }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Column chips */}
      <div className="dm-scroll" style={{ display: 'flex', gap: 7, padding: '0 18px 14px', overflowX: 'auto' }}>
        {columns.map((col) => {
          const active = colFilter === col.key
          const count = grouped[col.key]?.length ?? 0
          return (
            <button
              key={col.key}
              onClick={() => onColFilter(col.key)}
              style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 10,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                background: active ? col.color : C.card, color: active ? '#fff' : C.text2,
                border: `1px solid ${active ? col.color : C.border}`,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? '#fff' : col.color }} />
              {col.label}
              <span style={{
                minWidth: 17, height: 17, padding: '0 4px', borderRadius: 9, fontSize: 10, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: active ? 'rgba(255,255,255,.25)' : C.border2, color: active ? '#fff' : C.text2,
              }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Column title */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 20px 10px' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800 }}>{activeCol?.label}</div>
        <div style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>{activeCol?.hint}</div>
      </div>

      {/* Order list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 18px' }}>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ height: 100, borderRadius: 15, background: C.border2, animation: 'dmFade 1.2s ease infinite alternate' }} />
          ))
        ) : orders.length === 0 ? (
          <EmptyState search={search} />
        ) : (
          orders.map((order) => (
            <OrderCard
              key={getOrderId(order)}
              order={order}
              customerMap={customerMap}
              courierMap={courierMap}
              onSelect={onSelectOrder}
              onAction={onAction}
              isConfirming={isConfirming}
            />
          ))
        )}
      </div>
    </div>
  )
}

function EmptyState({ search }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 16px', textAlign: 'center', color: '#B0B0A6' }}>
      <div style={{ fontSize: 30, opacity: .5, marginBottom: 8 }}>◇</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text3 }}>{search ? 'Ничего не найдено' : 'Пусто'}</div>
      <div style={{ fontSize: 11.5, marginTop: 2 }}>{search ? 'Измените запрос' : 'Нет заказов в этой колонке'}</div>
    </div>
  )
}

function OrderCard({ order, customerMap, courierMap, onSelect, onAction, isConfirming }) {
  const customer = resolveCustomer(order, customerMap)
  const courierDisp = resolveCourierDisplay(order, courierMap)
  const address = resolveAddress(order) || customer?.address || resolveCity(order) || customer?.city || '—'
  const age = orderAge(order)
  const when = order.scheduled_at || order.delivery_date
  const overdue = isOverdue(order)
  const isCash = order.payment_method === 'cash' || order.payment_method === 'наличные'
  const hasPrepay = order.prepayment_status || Number(order.prepayment_amount ?? 0) > 0
  const isExpress = order.delivery_method === 'express'

  const barColor = order.status === 'new' ? '#6366f1' : order.status === 'confirmed' ? '#0ea5e9'
    : order.status === 'issue' ? '#ef4444' : order.status === 'delivered' ? '#10b981' : '#f59e0b'
  const ageColor = overdue ? C.red : C.text3

  const badges = []
  if (hasPrepay) badges.push({ label: 'предопл', bg: C.amberBg, color: C.amber })
  if (isExpress) badges.push({ label: '⚡ экспр', bg: C.amberBg, color: C.amber })
  if (isToday(when)) badges.push({ label: 'сегодня', bg: C.greenBg, color: C.green })
  if (isTomorrow(when)) badges.push({ label: 'завтра', bg: C.blueBg, color: C.blue })
  if (overdue) badges.push({ label: 'просроч', bg: C.redBg, color: C.red })

  return (
    <div
      onClick={() => onSelect(order)}
      style={{ position: 'relative', background: C.card, borderRadius: 15, padding: '13px 14px 13px 16px', cursor: 'pointer', animation: 'dmCardIn .2s ease' }}
    >
      <span style={{ position: 'absolute', left: 0, top: 13, bottom: 13, width: 3, borderRadius: '0 3px 3px 0', background: barColor }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: C.text3, fontVariantNumeric: 'tabular-nums' }}>#{formatOrderLabel(order)}</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
          {badges.map((b) => (
            <span key={b.label} style={{ padding: '2px 7px', borderRadius: 6, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', background: b.bg, color: b.color }}>{b.label}</span>
          ))}
        </div>
        {age && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, flexShrink: 0, color: ageColor }}>
            <Clock size={10} />{age}
          </span>
        )}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 3 }}>{customer?.full_name || customer?.phone || 'Клиент —'}</div>
      <div style={{ fontSize: 12, color: C.text4, marginBottom: 11 }}>{address}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {fmt(order.total_amount)} <span style={{ fontSize: 11, fontWeight: 600, color: C.text3 }}>c</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.text4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: courierDisp.name ? '#10b981' : '#D6D3CB' }} />
          {courierDisp.name || 'Без курьера'}
        </div>
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        {order.status === 'new' && (
          <QuickAction label="Подтвердить" disabled={isConfirming} onClick={() => onAction('confirm', order)}>
            {isConfirming ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          </QuickAction>
        )}
        {order.status === 'confirmed' && (
          <QuickAction label="Назначить курьера" onClick={() => onAction('assign', order)}>
            <Truck size={13} />
          </QuickAction>
        )}
        {!['delivered', 'cancelled'].includes(order.status) && (
          <QuickAction label="Проблема" onClick={() => onAction('issue', order)} tone="danger">
            <AlertTriangle size={13} />
          </QuickAction>
        )}
      </div>
    </div>
  )
}

function QuickAction({ children, onClick, disabled, tone }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 9,
        border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: tone === 'danger' ? C.redBg : C.violetBg,
        color: tone === 'danger' ? C.red : C.violetDk,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  )
}
