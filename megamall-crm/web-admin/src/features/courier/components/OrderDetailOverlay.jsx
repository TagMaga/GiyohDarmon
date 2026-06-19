import { normalizeCourierOrder, fmtMoney, getStatus, STATUS_LABEL } from '../utils/courierHelpers'

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 100,
    background: 'linear-gradient(180deg,#071122,#0b1421 55%,#09111c)',
    color: 'white', overflowY: 'auto',
    padding: 'calc(18px + env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom))',
    animation: 'fadeUp .22s ease both',
    WebkitOverflowScrolling: 'touch',
  },
  top: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  back: {
    width: 44, height: 44, borderRadius: 18, border: 0,
    background: 'rgba(255,255,255,.08)', color: 'white',
    fontSize: 26, display: 'grid', placeItems: 'center', cursor: 'pointer',
  },
  title: { fontSize: 26, fontWeight: 900 },
  badge: (status) => {
    const map = {
      delivered:   { bg: 'rgba(18,183,106,.16)', color: '#32e48a' },
      in_delivery: { bg: 'rgba(22,131,255,.18)', color: '#60afff' },
      assigned:    { bg: 'rgba(102,92,255,.18)', color: '#b0aaff' },
      returned:    { bg: 'rgba(255,159,10,.18)', color: '#ffbe4d' },
      issue:       { bg: 'rgba(255,69,58,.18)',  color: '#ff8a82' },
    }
    const c = map[status] ?? { bg: 'rgba(255,255,255,.1)', color: '#cdd5e0' }
    return { padding: '10px 14px', borderRadius: 999, background: c.bg, color: c.color, fontWeight: 900, fontSize: 13 }
  },
  card: {
    background: 'rgba(255,255,255,.055)', border: '1px solid rgba(255,255,255,.08)',
    borderRadius: 26, padding: 16, marginBottom: 14,
    boxShadow: '0 18px 42px rgba(0,0,0,.18)',
  },
  clientRow: { display: 'grid', gridTemplateColumns: '68px 1fr', gap: 14, alignItems: 'center' },
  clientPhoto: {
    width: 68, height: 68, borderRadius: 24,
    background: 'linear-gradient(135deg,#4f46e5,#9ea7ff)',
    display: 'grid', placeItems: 'center', fontSize: 38,
  },
  clientName: { fontSize: 22, fontWeight: 900 },
  dLine: { display: 'flex', gap: 10, alignItems: 'flex-start', margin: '14px 0', fontSize: 18, fontWeight: 850 },
  dLineSub: { display: 'block', color: '#96a0b3', fontSize: 13, marginTop: 4 },
  contactGrid: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 },
  contactBtn: {
    border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.06)',
    color: '#dce5f5', borderRadius: 18, padding: '12px 6px',
    fontWeight: 900, fontSize: 13, cursor: 'pointer',
  },
  cardH3: { margin: '0 0 14px', color: '#aab4c6', fontSize: 15, fontWeight: 900 },
  payRow:   { display: 'flex', justifyContent: 'space-between', color: '#aab4c6', fontSize: 17, margin: '10px 0' },
  payTotal: { borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 15, marginTop: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  payTotalB: { fontSize: 28, color: '#8c7cff', fontWeight: 900 },
  cashMode: { color: '#31e083', fontWeight: 900, fontSize: 18, marginTop: 13 },
  actions: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
    position: 'sticky', bottom: 0, paddingTop: 14,
    background: 'linear-gradient(180deg,rgba(9,17,28,0),#09111c 40%)',
  },
  actBtn: (color) => ({
    border: 0, borderRadius: 20, padding: '16px 10px',
    fontSize: 16, fontWeight: 900, color: 'white', cursor: 'pointer',
    background: color === 'green' ? '#12b76a' : color === 'blue' ? '#1683ff' : '#ff453a',
  }),
}

export default function OrderDetailOverlay({ order, onClose, onAction, pendingId }) {
  if (!order) return null
  const norm   = normalizeCourierOrder(order)
  const status = getStatus(order)
  const id     = norm.id
  const isBusy = pendingId === id

  return (
    <div style={S.overlay}>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}`}</style>

      {/* Top bar */}
      <div style={S.top}>
        <button style={S.back} onClick={onClose}>‹</button>
        <div style={S.title}>{norm.order_number ?? 'Заказ'}</div>
        <div style={S.badge(status)}>{STATUS_LABEL[status] ?? status}</div>
      </div>

      {/* Client info */}
      <div style={S.card}>
        <div style={S.clientRow}>
          <div style={S.clientPhoto}>👤</div>
          <div>
            <div style={S.clientName}>{norm.customer_name ?? 'Клиент'}</div>
          </div>
        </div>
        {norm.customer_phone && (
          <div style={S.dLine}>
            📞 <div>{norm.customer_phone}</div>
          </div>
        )}
        {norm.delivery_address && (
          <div style={S.dLine}>
            📍 <div>
              {norm.delivery_address}
              {norm.notes && <small style={S.dLineSub}>{norm.notes}</small>}
            </div>
          </div>
        )}
        <div style={S.contactGrid}>
          {norm.customer_phone && (
            <button style={S.contactBtn} onClick={() => window.open(`tel:${norm.customer_phone}`)}>📞 Позвонить</button>
          )}
          {norm.customer_phone && (
            <button style={S.contactBtn} onClick={() => window.open(`https://wa.me/${norm.customer_phone?.replace(/\D/g, '')}`)}>🟢 WhatsApp</button>
          )}
          {norm.customer_phone && (
            <button style={S.contactBtn} onClick={() => window.open(`https://t.me/${norm.customer_phone?.replace(/\D/g, '')}`)}>✈️ Telegram</button>
          )}
        </div>
      </div>

      {/* Notes */}
      {norm.notes && (
        <div style={S.card}>
          <h3 style={S.cardH3}>💬 Комментарий</h3>
          <div style={{ fontSize: 17, fontWeight: 750 }}>{norm.notes}</div>
        </div>
      )}

      {/* Payment */}
      <div style={S.card}>
        <h3 style={S.cardH3}>💳 Оплата</h3>
        <div style={S.payRow}><span>Стоимость товаров</span><b>{fmtMoney(norm.total_amount)}</b></div>
        <div style={S.payRow}>
          <span>Доставка {norm.delivery_method === 'express' ? '(быстрая)' : '(обычная)'}</span>
          <b style={norm.delivery_fee > 0 ? {} : { color: '#32e48a' }}>
            {norm.delivery_fee > 0 ? fmtMoney(norm.delivery_fee) : 'Бесплатно'}
          </b>
        </div>
        {norm.prepayment > 0 && (
          <div style={S.payRow}><span>Предоплата</span><b style={{ color: '#32e48a' }}>−{fmtMoney(norm.prepayment)}</b></div>
        )}
        {norm.payment_label && (
          <div style={S.payRow}>
            <span>Способ</span>
            <b style={{ color: '#aab4c6' }}>
              {norm.payment_label === 'cod' ? 'Оплата при получении'
               : norm.payment_label === 'partial_prepayment' ? 'Частичная предоплата'
               : norm.payment_label === 'full_prepayment' ? 'Полная предоплата'
               : norm.payment_label}
            </b>
          </div>
        )}
        {(() => {
          const collect = norm.amount_to_collect ?? Math.max(0, norm.total_amount + (norm.delivery_fee || 0) - norm.prepayment)
          return (
            <div style={S.payTotal}>
              <span style={{ fontSize: 22, fontWeight: 900 }}>К оплате</span>
              {collect > 0
                ? <b style={S.payTotalB}>{fmtMoney(collect)}</b>
                : <b style={{ ...S.payTotalB, color: '#32e48a' }}>Оплачено</b>
              }
            </div>
          )
        })()}
        <div style={S.cashMode}>
          {norm.prepayment > 0 && norm.amount_to_collect === 0 ? '✅ Полностью оплачено' : '💵 Наличные'}
        </div>
      </div>

      {/* Action buttons */}
      <div style={S.actions}>
        {status === 'assigned' && (
          <>
            <button disabled={isBusy} style={S.actBtn('blue')} onClick={() => { onAction('start', order); onClose() }}>
              {isBusy ? '...' : '▶ В путь'}
            </button>
            <button style={S.actBtn('red')} onClick={() => { onAction('attempt', order); onClose() }}>
              × Проблема
            </button>
          </>
        )}
        {status === 'in_delivery' && (
          <>
            <button disabled={isBusy} style={S.actBtn('green')} onClick={() => { onAction('delivered', order); onClose() }}>
              {isBusy ? '...' : '✓ Доставлен'}
            </button>
            <button style={S.actBtn('red')} onClick={() => { onAction('attempt', order); onClose() }}>
              × Проблема
            </button>
          </>
        )}
        {['delivered','returned','issue'].includes(status) && (
          <button style={{ ...S.actBtn('blue'), gridColumn: '1/-1' }} onClick={onClose}>
            Закрыть
          </button>
        )}
      </div>
    </div>
  )
}
