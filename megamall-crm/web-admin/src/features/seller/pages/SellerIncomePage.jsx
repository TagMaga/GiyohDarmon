import { useState, useMemo } from 'react'
import Alert from '../../../shared/components/Alert'
import IncomePeriodFilter from '../../hr/components/IncomePeriodFilter'
import IncomeKpiCards from '../../hr/components/IncomeKpiCards'
import IncomeByTypeBreakdown from '../../hr/components/IncomeByTypeBreakdown'
import IncomeEventsTable from '../../hr/components/IncomeEventsTable'
import useMyIncome from '../../hr/hooks/useMyIncome'
import useSellerPayouts from '../hooks/useSellerPayouts'
import { useSellerCompensation, useSellerTeamRank } from '../hooks/useSellerMe'
import { EVENT_TYPE_LABEL } from '../../hr/utils/hrHelpers'
import { CalendarCheck, Percent, Trophy, TrendingUp } from 'lucide-react'
import { fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { M, MobileShell, Card, DarkCard, Chip } from '../components/mobileUi'

function toDateStr(d) { return d.toISOString().slice(0, 10) }

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

/** Previous range of the same length, ending the day before `from` */
function previousRange(from, to) {
  const f = new Date(from + 'T00:00:00')
  const t = new Date(to + 'T00:00:00')
  const days = Math.max(1, Math.round((t - f) / 86400000) + 1)
  const prevTo = new Date(f)
  prevTo.setDate(f.getDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setDate(prevTo.getDate() - days + 1)
  return { from: toDateStr(prevFrom), to: toDateStr(prevTo) }
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

export default function SellerIncomePage() {
  const def = currentMonthRange()
  const [from, setFrom] = useState(def.from)
  const [to, setTo] = useState(def.to)
  const [tab, setTab] = useState('income')
  const [period, setPeriod] = useState('month')

  const todayStr = toDateStr(new Date())
  const { data: todayReport } = useMyIncome({ from: todayStr, to: todayStr })
  const { data: report, isLoading, isError, error } = useMyIncome({ from, to, include_events: true })
  const prev = useMemo(() => previousRange(from, to), [from, to])
  const { data: prevReport } = useMyIncome({ from: prev.from, to: prev.to })
  const { data: payouts = [], isLoading: payoutsLoading } = useSellerPayouts()
  const { data: compensation } = useSellerCompensation()
  const { data: rankData } = useSellerTeamRank()

  const commissionPct = compensation?.commission_percent ?? null
  const rank = rankData?.rank ?? null
  const totalMembers = rankData?.total_members ?? null
  const todayIncome = todayReport?.total_income ?? 0
  const pendingPayout = payouts
    .filter(p => p.status === 'pending')
    .reduce((s, p) => s + (p.amount ?? 0), 0)

  const totalIncome = report?.total_income ?? 0
  const prevIncome = prevReport?.total_income ?? 0
  const deltaPct = prevIncome > 0 ? Math.round(((totalIncome - prevIncome) / prevIncome) * 100) : null
  const events = report?.events ?? []
  const heroLabel = PERIOD_PRESETS.find(p => p.key === period)?.heroLabel ?? 'Заработок за период'

  const selectPeriod = (key) => {
    setPeriod(key)
    const r = presetRange(key)
    setFrom(r.from)
    setTo(r.to)
  }

  const tabBar = (
    <div
      className="flex gap-1 rounded-2xl p-1"
      style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(226,232,240,0.6)' }}
    >
      {[
        { id: 'income',  label: 'Заработок' },
        { id: 'payouts', label: 'Выплаты' },
      ].map(t => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
          style={tab === t.id ? {
            background: 'white',
            color: '#4F46E5',
            boxShadow: '0 2px 8px rgba(16,24,40,0.08)',
          } : { color: '#94A3B8' }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  const incomeContent = (
    <div className="space-y-4">
      <div className="card p-4">
        <IncomePeriodFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
      </div>
      {isError && (
        <Alert variant="error">{error?.response?.data?.error?.message ?? error?.message ?? 'Ошибка'}</Alert>
      )}
      <IncomeKpiCards report={report} loading={isLoading} />
      <div className="card p-5">
        <h2 className="text-sm font-bold text-slate-800 mb-4">Разбивка по типам</h2>
        <IncomeByTypeBreakdown
          byEventType={report?.by_event_type ?? {}}
          totalIncome={report?.total_income ?? 0}
          loading={isLoading}
        />
      </div>
      <div className="card p-5">
        <h2 className="text-sm font-bold text-slate-800 mb-4">История начислений</h2>
        <IncomeEventsTable events={report?.events ?? []} loading={isLoading} />
      </div>
    </div>
  )

  const payoutsContent = (
    <div className="card overflow-hidden">
      {payoutsLoading ? (
        <div className="p-6 text-center text-sm text-slate-400">Загрузка…</div>
      ) : payouts.length === 0 ? (
        <div className="p-10 text-center">
          <CalendarCheck size={32} className="mx-auto mb-3 text-slate-200" />
          <p className="text-sm font-semibold text-slate-500">Выплат пока нет</p>
          <p className="text-xs text-slate-300 mt-1">Выплаты появятся после начисления</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {payouts.map(p => {
            const st = PAYOUT_STATUS[p.status] ?? { label: p.status, cls: 'text-slate-600 bg-slate-100' }
            return (
              <div key={p.id} className="flex items-center justify-between px-5 py-4 gap-4">
                <div>
                  <p className="text-base font-black text-slate-900">{fmtAmount(p.amount)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {p.period_start} — {p.period_end}
                    {p.method && <span className="ml-2 text-slate-300">· {p.method}</span>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                  {p.paid_at && <span className="text-[10px] text-slate-400">{fmtDate(p.paid_at)}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP LAYOUT
      ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:block p-6">
        {/* Desktop header */}
        <div className="flex items-start justify-between mb-7">
          <div>
            <h1 className="page-title">Мои доходы</h1>
            <p className="page-subtitle">Заработок и история выплат</p>
          </div>
          {/* Key stats chips */}
          <div className="flex items-center gap-3">
            {commissionPct !== null && (
              <div
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl"
                style={{ background: 'linear-gradient(135deg,#EEF2FF,#E0E7FF)' }}
              >
                <Percent size={15} className="text-indigo-600" />
                <div>
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wide leading-none">Комиссия</p>
                  <p className="text-sm font-black text-indigo-700">{commissionPct}%</p>
                </div>
              </div>
            )}
            {rank !== null && (
              <div
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl"
                style={{ background: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)' }}
              >
                <Trophy size={15} className="text-amber-500" />
                <div>
                  <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wide leading-none">Рейтинг</p>
                  <p className="text-sm font-black text-amber-700">
                    #{rank}{totalMembers ? `/${totalMembers}` : ''}
                  </p>
                </div>
              </div>
            )}
            <div
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl"
              style={{ background: 'linear-gradient(135deg,#ECFDF5,#D1FAE5)' }}
            >
              <TrendingUp size={15} className="text-emerald-600" />
              <div>
                <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide leading-none">Сегодня</p>
                <p className="text-sm font-black text-emerald-700">{fmtAmount(todayIncome)}</p>
              </div>
            </div>
            {pendingPayout > 0 && (
              <div
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl"
                style={{ background: 'linear-gradient(135deg,#FFF7ED,#FFEDD5)' }}
              >
                <CalendarCheck size={15} className="text-orange-500" />
                <div>
                  <p className="text-[10px] font-bold text-orange-400 uppercase tracking-wide leading-none">К выплате</p>
                  <p className="text-sm font-black text-orange-700">{fmtAmount(pendingPayout)}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Formula hint */}
        {commissionPct !== null && (
          <div
            className="rounded-2xl px-4 py-3 mb-5"
            style={{ background: 'linear-gradient(135deg,#F0FDF4,#DCFCE7)' }}
          >
            <p className="text-xs text-emerald-800">
              <span className="font-semibold">Комиссионная база</span> = Сумма заказа − тариф курьера
              <br />
              <span className="font-semibold">Доход продавца</span> = Комиссионная база × {commissionPct}%
            </p>
          </div>
        )}

        {/* Tab bar */}
        <div className="mb-5">{tabBar}</div>

        {tab === 'income' && incomeContent}
        {tab === 'payouts' && payoutsContent}
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

              {/* Earnings hero */}
              <DarkCard>
                <span style={{ fontSize: 12.5, color: M.darkSub, fontWeight: 600, letterSpacing: '.02em' }}>{heroLabel}</span>
                <div style={{ fontSize: 42, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1, marginTop: 11 }}>
                  {isLoading ? '—' : fmtAmount(totalIncome)}{' '}
                  <span style={{ fontSize: 24, fontWeight: 600, color: M.darkMuted }}>с</span>
                </div>
                {deltaPct !== null && (
                  <div className="flex items-center gap-[7px]" style={{ marginTop: 12 }}>
                    <span
                      className="inline-flex items-center gap-1"
                      style={{
                        fontSize: 12, fontWeight: 700,
                        color: deltaPct >= 0 ? '#34D399' : '#F87171',
                        background: deltaPct >= 0 ? 'rgba(52,211,153,.14)' : 'rgba(248,113,113,.14)',
                        padding: '3px 9px', borderRadius: 8,
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={deltaPct < 0 ? { transform: 'scaleY(-1)' } : undefined}><path d="M7 17 17 7M17 7H8M17 7v9" /></svg>
                      {deltaPct >= 0 ? '+' : ''}{deltaPct}%
                    </span>
                    <span style={{ fontSize: 12, color: M.darkMuted, fontWeight: 500 }}>к прошлому периоду</span>
                  </div>
                )}
              </DarkCard>

              {/* Info chips */}
              <div className="grid grid-cols-3 gap-[9px]" style={{ marginTop: 14 }}>
                <Card style={{ borderRadius: 15, padding: '13px 11px' }}>
                  <div style={{ fontSize: 11, color: M.sub, fontWeight: 600 }}>Комиссия</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 4 }}>
                    {commissionPct !== null ? `${commissionPct}%` : '—'}
                  </div>
                </Card>
                <Card style={{ borderRadius: 15, padding: '13px 11px' }}>
                  <div style={{ fontSize: 11, color: M.sub, fontWeight: 600 }}>Рейтинг</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 4 }}>
                    {rank !== null ? `#${rank}` : '—'}
                    {rank !== null && totalMembers ? <span style={{ fontSize: 12, fontWeight: 600, color: M.muted }}>/{totalMembers}</span> : null}
                  </div>
                </Card>
                <Card style={{ borderRadius: 15, padding: '13px 11px' }}>
                  <div style={{ fontSize: 11, color: M.sub, fontWeight: 600 }}>К выплате</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: M.amber, letterSpacing: '-.01em', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtAmount(pendingPayout)}
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
                  {events.map((ev, i) => (
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
                          {commissionPct !== null ? ` · комиссия ${commissionPct}%` : ''}
                        </div>
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 800, color: M.green, fontVariantNumeric: 'tabular-nums' }}>
                        +{fmtAmount(ev.amount)} с
                      </span>
                    </div>
                  ))}
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
                  {fmtAmount(pendingPayout)}{' '}
                  <span style={{ fontSize: 24, fontWeight: 600, color: M.darkMuted }}>с</span>
                </div>
                {pendingPayout > 0 && (
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
