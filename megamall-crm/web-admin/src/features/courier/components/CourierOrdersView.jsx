import { useState, useMemo } from 'react'
import { getStatus, normalizeCourierOrder, fmtMoney, STATUS_LABEL } from '../utils/courierHelpers'
import { CardSkeleton } from '../../../shared/components/Skeleton'

const S = {
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  h1:   { fontSize: 30, margin: 0, fontWeight: 900, letterSpacing: -0.8, color: '#071122' },
  sub:  { margin: '6px 0 0', color: '#7d8797', fontWeight: 850, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  filters: { display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 16, scrollbarWidth: 'none', paddingBottom: 2 },
  chip: (active) => ({
    padding: '11px 15px', borderRadius: 16,
    border: `1px solid ${active ? '#665cff' : '#e6ecf3'}`,
    background: active ? '#665cff' : 'white',
    fontWeight: 900, whiteSpace: 'nowrap', cursor: 'pointer',
    color: active ? 'white' : '#071122', fontSize: 13,
    flexShrink: 0,
  }),
  card: {
    background: '#fff', border: '1px solid #e6ecf3',
    borderRadius: 29, boxShadow: '0 7px 20px rgba(15,31,55,.07)',
    padding: 16, marginBottom: 13, cursor: 'pointer',
  },
  orderTop: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  orderNum: { fontSize: 17, fontWeight: 900, color: '#071122' },
  orderSub: { margin: '7px 0 0', color: '#7b8494', fontWeight: 850, fontSize: 14 },
  badge: (status) => {
    const map = {
      assigned:    { bg: '#e8f0fe', color: '#1a56db' },
      in_delivery: { bg: '#dbeafe', color: '#1e40af' },
      delivered:   { bg: '#e8f8f0', color: '#098a50' },
      returned:    { bg: '#fff7ed', color: '#c2410c' },
      issue:       { bg: '#fee2e2', color: '#991b1b' },
    }
    const c = map[status] ?? { bg: '#f1f5f9', color: '#64748b' }
    return { padding: '7px 12px', borderRadius: 999, background: c.bg, color: c.color, fontWeight: 900, fontSize: 12, whiteSpace: 'nowrap' }
  },
  actions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 },
  btn: (color) => ({
    border: 0, borderRadius: 18, padding: '14px 10px', fontSize: 14,
    fontWeight: 900, color: 'white', cursor: 'pointer', width: '100%',
    background: color === 'blue' ? '#1683ff' : color === 'green' ? '#12b76a' : '#ff453a',
    boxShadow: color === 'blue' ? '0 10px 22px rgba(22,131,255,.22)'
              : color === 'green' ? '0 10px 22px rgba(18,183,106,.18)'
              : '0 10px 22px rgba(255,69,58,.18)',
  }),
  empty: { textAlign: 'center', padding: '48px 0', color: '#7d8797', fontWeight: 850, fontSize: 14 },
}

const FILTERS = [
  { id: 'all',         label: 'Все' },
  { id: 'assigned',    label: 'Назначены' },
  { id: 'in_delivery', label: 'Активные' },
  { id: 'delivered',   label: 'Доставлены' },
  { id: 'returned',    label: 'Возвраты' },
  { id: 'issue',       label: 'Проблемы' },
]

export default function CourierOrdersView({ orders = [], loading, onAction, onOrderClick, pendingId }) {
  const [filter, setFilter] = useState('all')

  const visible = useMemo(() =>
    filter === 'all' ? orders : orders.filter(o => getStatus(o) === filter),
  [orders, filter])

  return (
    <div>
      <div style={S.head}>
        <div>
          <h1 style={S.h1}>Доставки</h1>
          <p style={S.sub}>Сегодня · {orders.length} заказов</p>
        </div>
      </div>

      <div style={S.filters}>
        {FILTERS.map(f => (
          <button key={f.id} style={S.chip(filter === f.id)} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading && [1,2,3].map(i => <CardSkeleton key={i} />)}

      {!loading && visible.length === 0 && (
        <div style={S.empty}>Нет заказов</div>
      )}

      {!loading && visible.map((order, i) => {
        const norm   = normalizeCourierOrder(order)
        const status = getStatus(order)
        const id     = norm.id
        const isBusy = pendingId === id

        return (
          <div key={id ?? i} style={S.card} onClick={() => onOrderClick(order)}>
            <div style={S.orderTop}>
              <div>
                <div style={S.orderNum}>{norm.order_number ?? `#${String(id).slice(0,8)}`}</div>
                <p style={S.orderSub}>
                  {norm.customer_name ?? 'Клиент'}{norm.delivery_address ? ` · ${norm.delivery_address}` : ''}
                </p>
              </div>
              <span style={S.badge(status)}>{STATUS_LABEL[status] ?? status}</span>
            </div>

            {norm.total_amount > 0 && (
              <div style={{ marginTop: 12, fontSize: 15, fontWeight: 900, color: '#071122' }}>
                {fmtMoney(norm.total_amount)}
              </div>
            )}

            <div style={S.actions} onClick={e => e.stopPropagation()}>
              {status === 'assigned' && (
                <>
                  <button disabled={isBusy} style={S.btn('blue')} onClick={() => onAction('start', order)}>
                    {isBusy ? '...' : 'В доставку'}
                  </button>
                  <button style={S.btn('green')} onClick={() => onOrderClick(order)}>Детали</button>
                </>
              )}
              {status === 'in_delivery' && (
                <>
                  <button disabled={isBusy} style={S.btn('green')} onClick={() => onAction('delivered', order)}>
                    {isBusy ? '...' : '✓ Доставлен'}
                  </button>
                  <button style={S.btn('red')} onClick={() => onAction('attempt', order)}>Проблема</button>
                </>
              )}
              {(status === 'delivered' || status === 'returned' || status === 'issue') && (
                <button style={{ ...S.btn('blue'), gridColumn: '1/-1' }} onClick={() => onOrderClick(order)}>
                  Детали
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
