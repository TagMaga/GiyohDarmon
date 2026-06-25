import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchMyHandovers } from '../api'
import { fmtMoney, fmtDateTime } from '../utils/courierHelpers'
import { CardSkeleton } from '../../../shared/components/Skeleton'

const S = {
  h1:  { fontSize: 30, margin: 0, fontWeight: 900, letterSpacing: -0.8, color: '#071122' },
  sub: { margin: '6px 0 0', color: '#7d8797', fontWeight: 850, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  hero: {
    background: 'white', border: '1px solid #ffdaa0', borderRadius: 32,
    padding: 24, boxShadow: '0 16px 34px rgba(255,159,10,.10)',
    marginBottom: 17, position: 'relative', overflow: 'hidden',
  },
  heroLabel: { color: '#d88900', fontWeight: 900, textTransform: 'uppercase', fontSize: 12, letterSpacing: 1 },
  heroSum:   { fontSize: 'clamp(44px,13vw,56px)', fontWeight: 900, letterSpacing: -2, color: '#ff9f0a', margin: '14px 0' },
  formula:   { background: '#f6f8fb', borderRadius: 22, padding: '14px 12px', display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center', fontSize: 18, fontWeight: 900 },
  caption:   { textAlign: 'center', color: '#7d8797', fontWeight: 750, marginTop: 12, fontSize: 13 },
  pending:   { marginTop: 14, padding: '14px 16px', borderRadius: 20, background: '#fff5df', color: '#b87500', fontWeight: 900, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 14 },
  submitBtn: {
    width: '100%', margin: '16px 0 0', border: 0, borderRadius: 22, padding: 17,
    background: '#665cff', color: 'white', fontSize: 17, fontWeight: 900,
    boxShadow: '0 13px 26px rgba(102,92,255,.22)', cursor: 'pointer',
  },
  segmented: { background: '#eaf0f7', borderRadius: 24, padding: 5, display: 'grid', gridTemplateColumns: '1fr 1fr', marginBottom: 17 },
  seg: (active) => ({
    borderRadius: 20, padding: '14px 8px', textAlign: 'center', fontWeight: 900,
    color: active ? 'white' : '#697385', cursor: 'pointer', border: 'none', fontSize: 14,
    background: active ? '#665cff' : 'transparent',
    boxShadow: active ? '0 7px 16px rgba(102,92,255,.22)' : 'none',
    transition: 'all .15s',
  }),
  listHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 2px 12px', gap: 10 },
  listH2:   { margin: 0, fontSize: 14, letterSpacing: 0.7, color: '#7f8796', textTransform: 'uppercase', fontWeight: 900 },
  totalText: { color: '#7d8797', fontWeight: 850, fontSize: 13, textAlign: 'right' },
  card: { background: '#fff', border: '1px solid #e6ecf3', borderRadius: 29, boxShadow: '0 7px 20px rgba(15,31,55,.07)', overflow: 'hidden', marginBottom: 16 },
  item: {
    display: 'grid', gridTemplateColumns: '48px 1fr auto',
    gap: 12, alignItems: 'center', padding: '12px 16px',
    borderBottom: '1px solid #e6ecf3', cursor: 'pointer',
  },
  receipt: {
    width: 48, height: 60, borderRadius: 10,
    background: 'linear-gradient(180deg,#f8f8f8,#cfd5dc)',
    boxShadow: '0 6px 14px rgba(15,31,55,.1)',
    flexShrink: 0,
  },
  amount:  { color: '#ff9f0a', fontWeight: 900, fontSize: 16, whiteSpace: 'nowrap', textAlign: 'right' },
  stateOk: { display: 'block', fontSize: 11, marginTop: 4, color: '#12b76a', fontWeight: 900 },
  stateWait: { display: 'block', fontSize: 11, marginTop: 4, color: '#ff9f0a', fontWeight: 900 },
  stateBad:  { display: 'block', fontSize: 11, marginTop: 4, color: '#ff453a', fontWeight: 900 },
  earningsItem: {
    display: 'grid', gridTemplateColumns: '48px 1fr auto',
    gap: 12, alignItems: 'center', padding: '12px 16px',
    borderBottom: '1px solid #e6ecf3',
  },
  iconBox: { width: 48, height: 48, borderRadius: 16, background: '#e8f8f0', display: 'grid', placeItems: 'center', fontSize: 22 },
}

const STATUS_LABEL = { pending: 'Ожидает ⏳', confirmed: 'Принято ✅', rejected: 'Отклонено ❌', disputed: 'Спор' }
const STATUS_STYLE = { pending: 'stateWait', confirmed: 'stateOk', rejected: 'stateBad', disputed: 'stateWait' }

export default function CourierCashView({ summary, loading: summaryLoading, onHandover }) {
  const [cashTab, setCashTab] = useState('handover')

  const { data: handovers = [], isPending: hLoading } = useQuery({
    queryKey: KEYS.courier.handovers,
    queryFn:  fetchMyHandovers,
    staleTime: 0,
  })

  const collected = summary?.cash_to_handover   ?? 0
  const fees      = summary?.total_delivery_fees ?? 0
  const toReturn  = Math.max(0, collected - fees)
  const totalHandedOver = handovers.filter(h => (h.status ?? h.Status) === 'confirmed')
    .reduce((s, h) => s + (h.total_to_return ?? h.TotalToReturn ?? 0), 0)

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={S.h1}>Касса</h1>
        <p style={S.sub}>сегодня</p>
      </div>

      {/* Orange cash hero */}
      <div style={S.hero}>
        <div style={S.heroLabel}>нужно вернуть сегодня</div>
        <div style={S.heroSum}>{summaryLoading ? '—' : fmtMoney(toReturn)}</div>
        <div style={S.formula}>
          <span style={{ color: '#071122' }}>{fmtMoney(collected)}</span>
          <span style={{ color: '#7d8797' }}>−</span>
          <span style={{ color: '#12b76a' }}>{fmtMoney(fees)}</span>
          <span style={{ color: '#7d8797' }}>=</span>
          <span style={{ color: '#ff9f0a' }}>{fmtMoney(toReturn)}</span>
        </div>
        <div style={S.caption}>Собранные наличные − Ваша зарплата</div>
        {totalHandedOver > 0 && (
          <div style={S.pending}>
            На проверке у диспетчера <span>{fmtMoney(totalHandedOver)}</span>
          </div>
        )}
        <button style={S.submitBtn} onClick={onHandover}>Сдать наличные</button>
      </div>

      {/* Segmented control */}
      <div style={S.segmented}>
        <button style={S.seg(cashTab === 'handover')} onClick={() => setCashTab('handover')}>Сдача наличных</button>
        <button style={S.seg(cashTab === 'earnings')} onClick={() => setCashTab('earnings')}>Заработки</button>
      </div>

      {/* Handover history */}
      {cashTab === 'handover' && (
        <>
          <div style={S.listHead}>
            <h2 style={S.listH2}>Сдача наличных</h2>
            <div style={S.totalText}>Всего сдано: <b style={{ color: '#ff9f0a' }}>{fmtMoney(totalHandedOver)}</b></div>
          </div>
          {hLoading ? <CardSkeleton /> : (
            <div style={S.card}>
              {handovers.length === 0 && (
                <div style={{ padding: '24px 16px', color: '#7d8797', fontSize: 13, fontWeight: 850, textAlign: 'center' }}>
                  Инкассаций пока нет
                </div>
              )}
              {handovers.map((h, i) => {
                const status  = h.status ?? h.Status ?? 'pending'
                const amount  = h.total_to_return ?? h.TotalToReturn ?? 0
                const date    = h.created_at ?? h.CreatedAt
                const ss      = STATUS_STYLE[status] ?? 'stateWait'
                return (
                  <div key={h.id ?? i} style={{ ...S.item, borderBottom: i === handovers.length - 1 ? 'none' : '1px solid #e6ecf3' }}>
                    <div style={S.receipt} />
                    <div>
                      <span style={{ color: '#7d8797', fontSize: 12, fontWeight: 850 }}>{fmtDateTime(date) ?? '—'}</span>
                      <strong style={{ display: 'block', fontSize: 14, marginTop: 4, color: '#101827' }}>Сдано наличными</strong>
                    </div>
                    <div style={S.amount}>
                      {fmtMoney(amount)}
                      <span style={S[ss]}>{STATUS_LABEL[status] ?? status}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Earnings */}
      {cashTab === 'earnings' && (
        <>
          <div style={S.listHead}>
            <h2 style={S.listH2}>Заработки</h2>
            <div style={S.totalText}>Всего: <b style={{ color: '#12b76a' }}>{fmtMoney(fees)}</b></div>
          </div>
          <div style={S.card}>
            <div style={{ padding: '24px 16px', color: '#7d8797', fontSize: 13, fontWeight: 850, textAlign: 'center' }}>
              История заработков скоро появится
            </div>
          </div>
        </>
      )}
    </div>
  )
}
