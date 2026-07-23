import { useState, useMemo } from 'react'
import Alert from '../../../shared/components/Alert'
import IncomePeriodFilter from '../../hr/components/IncomePeriodFilter'
import useMyIncome from '../../hr/hooks/useMyIncome'
import useSellerPayouts from '../hooks/useSellerPayouts'
import useSellerOrders from '../hooks/useSellerOrders'
import { useSellerCompensation } from '../hooks/useSellerMe'
import { EVENT_TYPE_LABEL } from '../../hr/utils/hrHelpers'
import { CalendarCheck } from 'lucide-react'
import { fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { M, MobileShell, Card, DarkCard, Chip } from '../components/mobileUi'

// Local calendar date, not UTC — toISOString() would roll dates back a day
// for any timezone ahead of UTC (e.g. midnight local on the 1st becomes the
// 30th/31st in UTC), which threw off the "current month" default range.
function toDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function currentMonthRange() {
  const now = new Date()
  return {
    from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateStr(now),
  }
}

const PERIOD_PRESETS = [
  { key: 'today', label: 'Сегодня', heroLabel: 'Заработок сегодня' },
  { key: 'week',  label: 'Неделя',  heroLabel: 'Заработок за неделю' },
  { key: 'month', label: 'Месяц',   heroLabel: 'Заработок за месяц' },
]

function presetRange(key) {
  const now = new Date()
  if (key === 'today') {
    const t = toDateStr(now)
    return { from: t, to: t }
  }
  if (key === 'week') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    return { from: toDateStr(start), to: toDateStr(now) }
  }
  return currentMonthRange()
}

/** Payouts run bi-monthly: periods 1–15 are paid on the 16th, 16–end on the 1st. */
function nextPayoutDate() {
  const now = new Date()
  const d = now.getDate() <= 15
    ? new Date(now.getFullYear(), now.getMonth(), 16)
    : new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

const PAYOUT_STATUS = {
  paid:    { label: 'Выплачено', cls: 'text-emerald-700 bg-emerald-50' },
  pending: { label: 'Ожидает',  cls: 'text-amber-700 bg-amber-50' },
  voided:  { label: 'Отменено', cls: 'text-slate-500 bg-slate-100' },
}

function dateInRange(value, from, to) {
  if (!value) return false
  const ts = new Date(value).getTime()
  if (Number.isNaN(ts)) return false
  return ts >= new Date(`${from}T00:00:00`).getTime() && ts <= new Date(`${to}T23:59:59`).getTime()
}

function periodOrderTotals(orders = [], from, to) {
  return orders.reduce((acc, order) => {
    if (order.status !== 'delivered') return acc
    const date = order.delivered_at ?? order.updated_at ?? order.created_at
    if (!dateInRange(date, from, to)) return acc

    // courier_payout (what MegaMall pays the courier) is the real per-order
    // deduction the commission math uses — not delivery_fee (what the client
    // was charged), which can differ or be unset.
    const courierPayout = Number(order.courier_payout ?? 0)
    const revenue = Number(
      order.total_amount ?? (
        order.total_order_amount != null ? Number(order.total_order_amount) - courierPayout : 0
      )
    )
    acc.revenue += Number.isFinite(revenue) ? revenue : 0
    acc.courierPayout += Number.isFinite(courierPayout) ? courierPayout : 0
    return acc
  }, { revenue: 0, courierPayout: 0 })
}

/** Per-row "(order total − courier payout) × rate% = amount" breakdown, using
 *  the seller's current commission rate (from HR settings) rather than a
 *  value reverse-engineered from the stored amount, which produced a
 *  misleading rate whenever net_revenue didn't match the actual commission
 *  math. "Order total" is total_amount + delivery_fee (what the client actually
 *  paid), matching commission_base (internal/orders/financial.go) — using
 *  total_amount alone here under-counted delivery revenue and made the
 *  formula not reconcile with the displayed amount. The deduction is
 *  courier_payout (what MegaMall pays the courier), not delivery_fee (what
 *  the client was charged), which can differ or be unset. */
function orderBreakdown(ev, fallbackPct) {
  if (ev.total_amount == null || fallbackPct == null) return null
  const orderTotal = Number(ev.total_amount) + Number(ev.delivery_fee ?? 0)
  const courierPayout = Number(ev.courier_payout ?? 0)
  return `(${fmtAmount(orderTotal)} − ${fmtAmount(courierPayout)}) × ${fallbackPct}% = ${fmtAmount(ev.amount)}`
}

function eventOrderTotals(events = []) {
  const seen = new Set()
  return events.reduce((acc, ev) => {
    const key = ev.order_id ?? ev.order_number ?? ev.id
    if (key && seen.has(key)) return acc
    if (key) seen.add(key)

    const totalAmount = Number(ev.total_amount ?? 0)
    const courierPayout = Number(ev.courier_payout ?? 0)
    acc.revenue += Number.isFinite(totalAmount) ? totalAmount : 0
    acc.courierPayout += Number.isFinite(courierPayout) ? Math.max(0, courierPayout) : 0
    return acc
  }, { revenue: 0, courierPayout: 0 })
}

export default function SellerIncomePage() {
  const def = currentMonthRange()
  const [from, setFrom] = useState(def.from)
  const [to, setTo] = useState(def.to)
  const [tab, setTab] = useState('income')
  const [period, setPeriod] = useState('month')

  const { data: report, isLoading, isError, error } = useMyIncome({ from, to, include_events: true })
  const { data: payouts = [], isLoading: payoutsLoading } = useSellerPayouts()
  const { orders = [], isLoading: ordersLoading } = useSellerOrders()
  const { data: compensation } = useSellerCompensation()

  const commissionPct = compensation?.commission_rate != null ? +(compensation.commission_rate * 100).toFixed(1) : null
  const pendingPayout = payouts
    .filter(p => p.status === 'pending')
    .reduce((s, p) => s + (p.amount ?? 0), 0)

  const events = report?.events ?? []
  const eventTotals = useMemo(() => eventOrderTotals(events), [events])
  const orderTotals = useMemo(() => periodOrderTotals(orders, from, to), [orders, from, to])
  const totalIncome = report?.total_income ?? 0
  const totalRevenue = report?.total_revenue || eventTotals.revenue || orderTotals.revenue || 0
  const totalDeliveryFee = report?.total_courier_payout || eventTotals.courierPayout || orderTotals.courierPayout || 0
  const netProfit = report?.net_profit ?? totalIncome
  const payableAmount = pendingPayout > 0 ? pendingPayout : netProfit
  const totalsLoading = isLoading && ordersLoading
  const heroLabel = PERIOD_PRESETS.find(p => p.key === period)?.heroLabel ?? 'Заработок за период'

  const selectPeriod = (key) => {
    setPeriod(key)
    const r = presetRange(key)
    setFrom(r.from)
    setTo(r.to)
  }

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP LAYOUT — Seller Panel Redesign
      ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex flex-col gap-5" style={{ padding: '36px 44px', fontFamily: M.font }}>
        <div className="flex items-center justify-between">
          <h1 style={{ fontSize: 28, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Мои доходы</h1>
          <div className="flex gap-1" style={{ background: '#EAE8E1', borderRadius: 13, padding: 4 }}>
            {[
              { id: 'income',  label: 'Заработок' },
              { id: 'payouts', label: 'Выплаты' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="transition-all"
                style={tab === t.id ? {
                  fontSize: 13.5, fontWeight: 700, color: M.ink, background: '#fff',
                  padding: '9px 22px', borderRadius: 10, boxShadow: '0 1px 3px rgba(20,20,20,.08)',
                  border: 'none', fontFamily: 'inherit', cursor: 'pointer',
                } : {
                  fontSize: 13.5, fontWeight: 600, color: M.sub, padding: '9px 22px',
                  background: 'transparent', border: 'none', fontFamily: 'inherit', cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'income' && (
          <>
            <div className="flex gap-[9px]">
              {PERIOD_PRESETS.map(p => (
                <Chip key={p.key} active={period === p.key} onClick={() => selectPeriod(p.key)} style={{ padding: '9px 18px', fontSize: 13 }}>
                  {p.label}
                </Chip>
              ))}
            </div>

            <div className="grid gap-5" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
              <DarkCard style={{ padding: '28px 30px' }}>
                <span style={{ fontSize: 12.5, color: M.darkSub, fontWeight: 600, letterSpacing: '.02em' }}>К выплате</span>
                <div style={{ fontSize: 50, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1, marginTop: 14 }}>
                  {isLoading ? '—' : fmtAmount(payableAmount)}{' '}
                  <span style={{ fontSize: 26, fontWeight: 600, color: M.darkMuted }}>с</span>
                </div>
              </DarkCard>
              <div className="grid grid-cols-3 gap-3">
                <Card style={{ borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 12, color: M.sub, fontWeight: 600 }}>Доставка</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: M.ink, marginTop: 5 }}>{totalsLoading ? '—' : fmtAmount(totalDeliveryFee)}</div>
                </Card>
                <Card style={{ borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 12, color: M.sub, fontWeight: 600 }}>Комиссия</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: M.ink, marginTop: 5 }}>{commissionPct !== null ? `${commissionPct}%` : '—'}</div>
                </Card>
                <Card style={{ borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 12, color: M.sub, fontWeight: 600 }}>{heroLabel}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: M.ink, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{totalsLoading ? '—' : fmtAmount(totalRevenue)}</div>
                </Card>
              </div>
            </div>

            {isError && (
              <Alert variant="error">{error?.response?.data?.error?.message ?? error?.message ?? 'Ошибка'}</Alert>
            )}

            <div className="card p-4">
              <IncomePeriodFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <div style={{ fontSize: 17, fontWeight: 700, color: M.ink, marginBottom: 12 }}>История начислений</div>
              {isLoading ? (
                <Card className="h-40 animate-pulse" />
              ) : events.length === 0 ? (
                <Card className="p-10 text-center">
                  <p style={{ fontSize: 13, color: M.muted, margin: 0 }}>За выбранный период начислений нет</p>
                </Card>
              ) : (
                <Card style={{ borderRadius: 18, overflow: 'hidden' }}>
                  {events.map((ev, i) => {
                    const breakdown = orderBreakdown(ev, commissionPct)
                    return (
                      <div
                        key={ev.id ?? i}
                        className="flex items-center gap-[14px]"
                        style={{ padding: '16px 22px', borderBottom: i < events.length - 1 ? `1px solid ${M.bg}` : 'none' }}
                      >
                        <div className="flex items-center justify-center flex-shrink-0" style={{ width: 42, height: 42, borderRadius: 12, background: '#EEEDFB', color: M.indigoDeep }}>
                          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M9 8h6M9 12h6" /></svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700, color: M.ink }}>
                            {ev.order_number ? `Заказ ${ev.order_number}` : (EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type)}
                          </div>
                          <div style={{ fontSize: 12.5, color: M.muted, marginTop: 1 }}>
                            {fmtDate(ev.created_at)}
                            {breakdown == null && commissionPct !== null ? ` · комиссия ${commissionPct}%` : ''}
                          </div>
                          {breakdown && (
                            <div style={{ fontSize: 11.5, color: M.faint, marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                              {breakdown}
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: 15, fontWeight: 800, color: M.green, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>+{fmtAmount(ev.amount)} с</span>
                      </div>
                    )
                  })}
                </Card>
              )}
            </div>
          </>
        )}

        {tab === 'payouts' && (
          <>
            <div className="grid gap-5" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
              <DarkCard glow="rgba(217,119,6,.16)" style={{ padding: '28px 30px' }}>
                <div className="flex items-center gap-[7px]">
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FBBF24' }} />
                  <span style={{ fontSize: 12.5, color: M.darkSub, fontWeight: 600, letterSpacing: '.02em' }}>Ожидает выплаты</span>
                </div>
                <div style={{ fontSize: 50, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1, marginTop: 16 }}>
                  {isLoading ? '—' : fmtAmount(payableAmount)}{' '}
                  <span style={{ fontSize: 26, fontWeight: 600, color: M.darkMuted }}>с</span>
                </div>
                {payableAmount > 0 && (
                  <div style={{ fontSize: 13, color: M.darkMuted, marginTop: 12, fontWeight: 500 }}>
                    Следующая выплата · {nextPayoutDate()}
                  </div>
                )}
              </DarkCard>
              <Card style={{ borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: M.sub, fontWeight: 600 }}>Выплачено всего</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: M.ink, marginTop: 4 }}>
                    {fmtAmount(payouts.filter(p => p.status === 'paid').reduce((s, p) => s + (p.amount ?? 0), 0))} с
                  </div>
                </div>
                <div style={{ height: 1, background: '#F0EFEA' }} />
                <div>
                  <div style={{ fontSize: 12, color: M.sub, fontWeight: 600 }}>Следующая выплата</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: M.ink, marginTop: 4 }}>{nextPayoutDate()}</div>
                </div>
              </Card>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <div style={{ fontSize: 17, fontWeight: 700, color: M.ink, marginBottom: 12 }}>История выплат</div>
              {payoutsLoading ? (
                <Card className="h-40 animate-pulse" />
              ) : payouts.length === 0 ? (
                <Card className="p-10 text-center">
                  <CalendarCheck size={28} className="mx-auto mb-3" style={{ color: M.borderAlt }} />
                  <p style={{ fontSize: 13, fontWeight: 600, color: M.sub, margin: 0 }}>Выплат пока нет</p>
                  <p style={{ fontSize: 12, color: M.faint, marginTop: 4 }}>Выплаты появятся после начисления</p>
                </Card>
              ) : (
                <Card style={{ borderRadius: 18, overflow: 'hidden' }}>
                  {payouts.map((p, i) => {
                    const st = PAYOUT_STATUS[p.status] ?? null
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between"
                        style={{ padding: '16px 22px', borderBottom: i < payouts.length - 1 ? `1px solid ${M.bg}` : 'none' }}
                      >
                        <div>
                          <div style={{ fontSize: 17, fontWeight: 800, color: M.ink, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(p.amount)} с</div>
                          <div style={{ fontSize: 12.5, color: M.muted, marginTop: 3 }}>
                            {p.period_start} — {p.period_end}
                            {p.paid_at && <span> · Выплачено {fmtDate(p.paid_at)}</span>}
                            {p.method && <span style={{ color: M.faint }}> · {p.method}</span>}
                          </div>
                        </div>
                        {p.status === 'paid' ? (
                          <span className="inline-flex items-center gap-[5px] flex-shrink-0" style={{ fontSize: 12, fontWeight: 700, color: M.green, background: M.greenBg, padding: '5px 11px', borderRadius: 8 }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>
                            Выплачено
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-[5px] flex-shrink-0" style={{ fontSize: 12, fontWeight: 700, color: M.amber, background: M.amberBg, padding: '5px 11px', borderRadius: 8 }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#D97706' }} />
                            {st?.label ?? p.status}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </Card>
              )}
            </div>
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          MOBILE LAYOUT — Seller Panel Redesign
      ═══════════════════════════════════════════════════════════ */}
      <MobileShell>
        <div className="px-5">
          {/* Header */}
          <h1 style={{ fontSize: 24, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0, paddingTop: 8 }}>Мои доходы</h1>

          {/* Sub-tabs */}
          <div className="flex gap-1" style={{ background: '#EAE8E1', borderRadius: 13, padding: 4, marginTop: 14 }}>
            {[
              { id: 'income',  label: 'Заработок' },
              { id: 'payouts', label: 'Выплаты' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex-1 text-center transition-all"
                style={tab === t.id ? {
                  fontSize: 13, fontWeight: 700, color: M.ink, background: '#fff',
                  padding: 9, borderRadius: 10, boxShadow: '0 1px 3px rgba(20,20,20,.08)',
                  border: 'none', fontFamily: 'inherit', cursor: 'pointer',
                } : {
                  fontSize: 13, fontWeight: 600, color: M.sub, padding: 9,
                  background: 'transparent', border: 'none', fontFamily: 'inherit', cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'income' && (
            <div style={{ marginTop: 14 }}>
              {/* Period presets */}
              <div className="flex gap-[7px]" style={{ marginBottom: 14 }}>
                {PERIOD_PRESETS.map(p => (
                  <Chip key={p.key} active={period === p.key} onClick={() => selectPeriod(p.key)} style={{ padding: '7px 15px' }}>
                    {p.label}
                  </Chip>
                ))}
              </div>

              {/* Payout hero */}
              <DarkCard>
                <span style={{ fontSize: 12.5, color: M.darkSub, fontWeight: 600, letterSpacing: '.02em' }}>К выплате</span>
                <div style={{ fontSize: 42, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1, marginTop: 11 }}>
                  {isLoading ? '—' : fmtAmount(payableAmount)}{' '}
                  <span style={{ fontSize: 24, fontWeight: 600, color: M.darkMuted }}>с</span>
                </div>
              </DarkCard>

              {/* Info chips */}
              <div className="grid grid-cols-3 gap-[9px]" style={{ marginTop: 14 }}>
                <Card style={{ borderRadius: 15, padding: '13px 11px' }}>
                  <div style={{ fontSize: 11, color: M.sub, fontWeight: 600 }}>Доставка</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 4 }}>
                    {totalsLoading ? '—' : fmtAmount(totalDeliveryFee)}
                  </div>
                </Card>
                <Card style={{ borderRadius: 15, padding: '13px 11px' }}>
                  <div style={{ fontSize: 11, color: M.sub, fontWeight: 600 }}>Комиссия</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 4 }}>
                    {commissionPct !== null ? `${commissionPct}%` : '—'}
                  </div>
                </Card>
                <Card style={{ borderRadius: 15, padding: '13px 11px' }}>
                  <div style={{ fontSize: 11, color: M.sub, fontWeight: 600 }}>{heroLabel}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                    {totalsLoading ? '—' : fmtAmount(totalRevenue)}
                  </div>
                </Card>
              </div>

              {/* Formula hint */}
              {commissionPct !== null && (
                <Card style={{ borderRadius: 13, padding: '10px 14px', marginTop: 14, background: '#F3FBF6', border: '1px solid #D9F0E3' }}>
                  <p style={{ fontSize: 12, color: '#065F46', margin: 0 }}>
                    <span style={{ fontWeight: 700 }}>Формула: </span>
                    (Сумма заказа − Доставка) × {commissionPct}%
                  </p>
                </Card>
              )}

              {isError && (
                <div style={{ marginTop: 14 }}>
                  <Alert variant="error">{error?.response?.data?.error?.message ?? error?.message ?? 'Ошибка'}</Alert>
                </div>
              )}

              {/* Accrual history */}
              <div className="flex items-center justify-between" style={{ margin: '22px 4px 12px' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: M.ink }}>История начислений</span>
                {events.length > 0 && <span style={{ fontSize: 13, color: M.muted, fontWeight: 600 }}>{events.length}</span>}
              </div>

              {isLoading ? (
                <Card className="h-40 animate-pulse" />
              ) : events.length === 0 ? (
                <Card className="p-8 text-center">
                  <p style={{ fontSize: 13, color: M.muted, margin: 0 }}>За выбранный период начислений нет</p>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  {events.map((ev, i) => {
                    const breakdown = orderBreakdown(ev, commissionPct)
                    return (
                      <div
                        key={ev.id ?? i}
                        className="flex items-center gap-3"
                        style={{ padding: '14px 15px', borderBottom: i < events.length - 1 ? `1px solid ${M.bg}` : 'none' }}
                      >
                        <div className="flex items-center justify-center flex-shrink-0" style={{ width: 38, height: 38, borderRadius: 11, background: '#EEEDFB', color: M.indigoDeep }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M9 8h6M9 12h6" /></svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="truncate" style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>
                            {ev.order_number ? `Заказ ${ev.order_number}` : (EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type)}
                          </div>
                          <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>
                            {fmtDate(ev.created_at)}
                            {breakdown == null && commissionPct !== null ? ` · комиссия ${commissionPct}%` : ''}
                          </div>
                          {breakdown && (
                            <div style={{ fontSize: 10.5, color: M.faint, marginTop: 1 }}>{breakdown}</div>
                          )}
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 800, color: M.green, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                          +{fmtAmount(ev.amount)} с
                        </span>
                      </div>
                    )
                  })}
                </Card>
              )}
            </div>
          )}

          {tab === 'payouts' && (
            <div style={{ marginTop: 14 }}>
              {/* Pending payout hero */}
              <DarkCard glow="rgba(217,119,6,.16)">
                <div className="flex items-center gap-[7px]">
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FBBF24' }} />
                  <span style={{ fontSize: 12.5, color: M.darkSub, fontWeight: 600, letterSpacing: '.02em' }}>Ожидает выплаты</span>
                </div>
                <div style={{ fontSize: 42, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1, marginTop: 12 }}>
                  {isLoading ? '—' : fmtAmount(payableAmount)}{' '}
                  <span style={{ fontSize: 24, fontWeight: 600, color: M.darkMuted }}>с</span>
                </div>
                {payableAmount > 0 && (
                  <div style={{ fontSize: 12.5, color: M.darkMuted, marginTop: 9, fontWeight: 500 }}>
                    Следующая выплата · {nextPayoutDate()}
                  </div>
                )}
              </DarkCard>

              {/* Payout history */}
              <div className="flex items-center justify-between" style={{ margin: '22px 4px 12px' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: M.ink }}>История выплат</span>
              </div>

              {payoutsLoading ? (
                <Card className="h-40 animate-pulse" />
              ) : payouts.length === 0 ? (
                <Card className="p-8 text-center">
                  <CalendarCheck size={28} className="mx-auto mb-3" style={{ color: M.borderAlt }} />
                  <p style={{ fontSize: 13, fontWeight: 600, color: M.sub, margin: 0 }}>Выплат пока нет</p>
                  <p style={{ fontSize: 12, color: M.faint, marginTop: 4 }}>Выплаты появятся после начисления</p>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  {payouts.map((p, i) => {
                    const st = PAYOUT_STATUS[p.status] ?? null
                    return (
                      <div
                        key={p.id}
                        className="flex items-start justify-between gap-[10px]"
                        style={{ padding: 15, borderBottom: i < payouts.length - 1 ? `1px solid ${M.bg}` : 'none' }}
                      >
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: M.ink, fontVariantNumeric: 'tabular-nums' }}>
                            {fmtAmount(p.amount)} с
                          </div>
                          <div style={{ fontSize: 12, color: M.muted, marginTop: 3 }}>
                            {p.period_start} — {p.period_end}
                            {p.method && <span style={{ color: M.faint }}> · {p.method}</span>}
                          </div>
                          {p.paid_at && (
                            <div style={{ fontSize: 11, color: M.faint, marginTop: 2 }}>Выплачено {fmtDate(p.paid_at)}</div>
                          )}
                        </div>
                        {p.status === 'paid' ? (
                          <span className="inline-flex items-center gap-[5px] flex-shrink-0" style={{ fontSize: 11.5, fontWeight: 700, color: M.green, background: M.greenBg, padding: '4px 10px', borderRadius: 8 }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>
                            Выплачено
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-[5px] flex-shrink-0" style={{ fontSize: 11.5, fontWeight: 700, color: M.amber, background: M.amberBg, padding: '4px 10px', borderRadius: 8 }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#D97706' }} />
                            {st?.label ?? p.status}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </Card>
              )}
            </div>
          )}
        </div>
      </MobileShell>
    </>
  )
}
