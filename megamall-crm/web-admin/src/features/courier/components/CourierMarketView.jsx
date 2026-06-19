import { normalizeCourierOrder, fmtMoney } from '../utils/courierHelpers'
import { CardSkeleton } from '../../../shared/components/Skeleton'

const S = {
  h1:  { fontSize: 30, margin: 0, fontWeight: 900, letterSpacing: -0.8, color: '#071122' },
  sub: { margin: '6px 0 0', color: '#7d8797', fontWeight: 850, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: {
    background: '#fff', border: '1px solid #e6ecf3',
    borderRadius: 29, boxShadow: '0 7px 20px rgba(15,31,55,.07)',
    padding: 16, marginBottom: 13,
  },
  orderTop: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 },
  title: { fontSize: 17, fontWeight: 900, color: '#071122' },
  meta:  { margin: '7px 0 0', color: '#7b8494', fontWeight: 850, fontSize: 14 },
  newBadge: { padding: '7px 12px', borderRadius: 999, background: '#e8f8f0', color: '#098a50', fontWeight: 900, fontSize: 12 },
  takeBtn: {
    width: '100%', border: 0, borderRadius: 22, padding: 17,
    background: '#665cff', color: 'white', fontSize: 17, fontWeight: 900,
    boxShadow: '0 13px 26px rgba(102,92,255,.22)', cursor: 'pointer',
  },
  empty: { textAlign: 'center', padding: '48px 0', color: '#7d8797', fontWeight: 850, fontSize: 14 },
  disabledBox: {
    background: '#fff7ed',
    border: '1px solid #fed7aa',
    borderRadius: 22,
    color: '#9a3412',
    fontSize: 14,
    fontWeight: 850,
    lineHeight: 1.45,
    padding: 18,
    textAlign: 'center',
  },
}

export default function CourierMarketView({ orders = [], loading, intakeDisabled = false, onClaim, pendingId }) {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={S.h1}>Доступные</h1>
        <p style={S.sub}>{intakeDisabled ? 'Приём заказов выключен' : `${orders.length} заказов рядом`}</p>
      </div>

      {intakeDisabled && (
        <div style={S.disabledBox}>Приём новых заказов временно отключён диспетчером</div>
      )}

      {loading && [1,2].map(i => <CardSkeleton key={i} />)}

      {!intakeDisabled && !loading && orders.length === 0 && (
        <div style={S.empty}>Нет доступных заказов</div>
      )}

      {!intakeDisabled && !loading && orders.map((order, i) => {
        const norm = normalizeCourierOrder(order)
        const id   = norm.id
        const busy = pendingId === id

        return (
          <div key={id ?? i} style={S.card}>
            <div style={S.orderTop}>
              <div>
                <div style={S.title}>{norm.delivery_address ?? norm.city ?? 'Адрес не указан'}</div>
                <p style={S.meta}>
                  {norm.order_number ?? '—'}
                  {norm.total_amount > 0 ? ` · ${fmtMoney(norm.total_amount)}` : ''}
                </p>
              </div>
              <span style={S.newBadge}>новый</span>
            </div>
            <button
              disabled={busy}
              style={{ ...S.takeBtn, opacity: busy ? 0.6 : 1 }}
              onClick={() => onClaim(order)}
            >
              {busy ? 'Берём...' : 'Взять заказ'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
