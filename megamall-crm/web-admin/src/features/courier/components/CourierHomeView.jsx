import { useMemo } from 'react'
import { getStatus, fmtMoney, normalizeCourierOrder } from '../utils/courierHelpers'

const S = {
  view: { padding: '6px 0 0' },
  top: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20, gap: 12,
  },
  profile: { display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 },
  avatar: {
    width: 52, height: 52, borderRadius: 19,
    background: 'linear-gradient(145deg,#101827,#2b3550)',
    display: 'grid', placeItems: 'center',
    color: 'white', fontSize: 22, fontWeight: 900,
    boxShadow: '0 7px 20px rgba(15,31,55,.12)', flexShrink: 0,
  },
  name: { fontSize: 22, fontWeight: 900, lineHeight: 1, color: '#071122' },
  sub:  { marginTop: 6, color: '#7d8797', fontWeight: 800, fontSize: 13 },
  onlineBtn: {
    padding: '10px 14px', borderRadius: 999,
    background: '#e8f8f0', color: '#07884e',
    fontWeight: 900, fontSize: 14,
    display: 'flex', gap: 7, alignItems: 'center',
    whiteSpace: 'nowrap', cursor: 'pointer',
    border: 'none', flexShrink: 0,
  },
  dot: {
    width: 8, height: 8, borderRadius: '50%',
    background: '#12b76a',
    boxShadow: '0 0 0 5px rgba(18,183,106,.15)',
    animation: 'pulse 1.8s infinite',
  },
  hero: {
    background: 'linear-gradient(135deg,#071122,#0f4f99 70%,#1578ff)',
    color: 'white', borderRadius: 32, padding: '28px 24px',
    marginBottom: 16,
    boxShadow: '0 20px 46px rgba(12,75,145,.28)',
    position: 'relative', overflow: 'hidden',
  },
  heroSmall: { display: 'block', color: 'rgba(255,255,255,.68)', fontWeight: 850, fontSize: 14, marginBottom: 10 },
  money: { fontSize: 'clamp(44px,13vw,58px)', fontWeight: 900, letterSpacing: -2, lineHeight: .95 },
  heroP: { margin: '12px 0 0', color: 'rgba(255,255,255,.82)', fontSize: 15, fontWeight: 750 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 24 },
  kpi: {
    background: 'rgba(255,255,255,.86)', border: '1px solid rgba(255,255,255,.95)',
    borderRadius: 24, padding: '17px 8px', textAlign: 'center',
    boxShadow: '0 7px 20px rgba(15,31,55,.07)',
    backdropFilter: 'blur(12px)', cursor: 'pointer',
  },
  kpiStrong: { fontSize: 28, fontWeight: 900, display: 'block', color: '#071122' },
  kpiSpan:   { fontWeight: 850, color: '#7d8797', fontSize: 12 },
  sectionTitle: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 22, fontWeight: 900, margin: '0 4px 13px', color: '#071122',
  },
  link: { color: '#1683ff', fontSize: 15, fontWeight: 900, cursor: 'pointer', border: 'none', background: 'none' },
  card: {
    background: '#fff', border: '1px solid #e6ecf3',
    borderRadius: 29, boxShadow: '0 7px 20px rgba(15,31,55,.07)',
  },
  deliveryCard: { padding: 17, marginBottom: 20, cursor: 'pointer' },
  deliveryRow: { display: 'grid', gridTemplateColumns: '56px 1fr', gap: 13, alignItems: 'center' },
  pin: {
    width: 56, height: 56, borderRadius: 20,
    background: '#eef5ff', display: 'grid', placeItems: 'center', fontSize: 26,
  },
  deliveryH3: { margin: '0 0 6px', fontSize: 19, lineHeight: 1.15, color: '#071122' },
  deliveryP: { margin: 0, color: '#7d8797', fontWeight: 800, fontSize: 14, lineHeight: 1.35 },
  actions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 15 },
  btn: { border: 0, borderRadius: 18, padding: '15px 10px', fontSize: 15, fontWeight: 900, color: 'white', cursor: 'pointer', width: '100%' },
  streakCard: { display: 'flex', gap: 14, alignItems: 'center', padding: 18 },
  iconBox: { width: 54, height: 54, borderRadius: 20, background: '#eef5ff', display: 'grid', placeItems: 'center', fontSize: 26, flexShrink: 0 },
  streakStrong: { fontSize: 18, fontWeight: 900, color: '#071122' },
  streakP: { margin: '6px 0 0', color: '#7d8797', fontWeight: 800, fontSize: 14, lineHeight: 1.35 },
}

export default function CourierHomeView({ myOrders = [], cashSummary, onOrderClick, onTabChange }) {
  const delivered   = myOrders.filter(o => getStatus(o) === 'delivered').length
  const active      = myOrders.filter(o => ['assigned','in_delivery'].includes(getStatus(o))).length
  const currentOrder = useMemo(() =>
    myOrders.find(o => getStatus(o) === 'in_delivery') ||
    myOrders.find(o => getStatus(o) === 'assigned'),
  [myOrders])

  const norm       = currentOrder ? normalizeCourierOrder(currentOrder) : null
  const todayEarned = cashSummary?.total_delivery_fees ?? cashSummary?.TotalDeliveryFees ?? 0
  const onHand     = cashSummary?.total_collected     ?? cashSummary?.TotalCollected     ?? 0

  return (
    <div style={S.view}>
      <style>{`@keyframes pulse{50%{box-shadow:0 0 0 9px rgba(18,183,106,0)}}`}</style>

      {/* Top profile row */}
      <div style={S.top}>
        <div style={S.profile}>
          <div style={S.avatar}>А</div>
          <div style={{ minWidth: 0 }}>
            <div style={S.name}>Курьер</div>
            <div style={S.sub}>MegaMall Доставка</div>
          </div>
        </div>
        <div style={S.onlineBtn}>
          <span style={S.dot} />
          <span>На линии</span>
        </div>
      </div>

      {/* Earnings hero */}
      <div style={S.hero}>
        <small style={S.heroSmall}>заработок сегодня</small>
        <div style={S.money}>{fmtMoney(todayEarned)}</div>
        <p style={S.heroP}>
          {delivered} {delivered === 1 ? 'доставка' : delivered < 5 ? 'доставки' : 'доставок'}
          {onHand > 0 ? ` · ${fmtMoney(onHand)} наличные на руках` : ''}
        </p>
      </div>

      {/* KPI bubbles */}
      <div style={S.kpis}>
        <div style={S.kpi} onClick={() => onTabChange('orders')}>
          <strong style={S.kpiStrong}>{delivered}</strong>
          <span style={S.kpiSpan}>доставлено</span>
        </div>
        <div style={S.kpi} onClick={() => onTabChange('orders')}>
          <strong style={S.kpiStrong}>{active}</strong>
          <span style={S.kpiSpan}>активных</span>
        </div>
        <div style={S.kpi} onClick={() => onTabChange('market')}>
          <strong style={S.kpiStrong}>—</strong>
          <span style={S.kpiSpan}>доступно</span>
        </div>
      </div>

      {/* Current delivery */}
      <div style={S.sectionTitle}>
        <span>Сейчас</span>
        <button style={S.link} onClick={() => onTabChange('orders')}>Все</button>
      </div>

      {currentOrder && norm ? (
        <div style={{ ...S.card, ...S.deliveryCard }} onClick={() => onOrderClick(currentOrder)}>
          <div style={S.deliveryRow}>
            <div style={S.pin}>📍</div>
            <div>
              <h3 style={S.deliveryH3}>
                {norm.delivery_address ?? norm.city ?? 'Адрес не указан'}
              </h3>
              <p style={S.deliveryP}>
                {norm.customer_name ?? 'Клиент'}
                {norm.notes ? ` · ${norm.notes}` : ''}
              </p>
            </div>
          </div>
          <div style={S.actions}>
            <button style={{ ...S.btn, background: '#1683ff', boxShadow: '0 10px 22px rgba(22,131,255,.25)' }}>
              Маршрут
            </button>
            <button style={{ ...S.btn, background: '#12b76a', boxShadow: '0 10px 22px rgba(18,183,106,.22)' }}
              onClick={e => { e.stopPropagation(); onOrderClick(currentOrder) }}>
              Позвонить
            </button>
          </div>
        </div>
      ) : (
        <div style={{ ...S.card, padding: '24px 20px', marginBottom: 20, textAlign: 'center', color: '#7d8797', fontWeight: 850, fontSize: 14 }}>
          Нет активных доставок
        </div>
      )}

      {/* Streak card */}
      <div style={S.sectionTitle}><span>Статус дня</span></div>
      <div style={{ ...S.card, ...S.streakCard }}>
        <div style={S.iconBox}>🔥</div>
        <div>
          <strong style={S.streakStrong}>{delivered} доставок сегодня</strong>
          <p style={S.streakP}>
            {delivered === 0 ? 'Первая доставка ждёт тебя!' : `Отличный день, продолжай!`}
          </p>
        </div>
      </div>
    </div>
  )
}
