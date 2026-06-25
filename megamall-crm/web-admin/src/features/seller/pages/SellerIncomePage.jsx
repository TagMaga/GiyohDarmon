import { useState } from 'react'
import Alert from '../../../shared/components/Alert'
import IncomePeriodFilter from '../../hr/components/IncomePeriodFilter'
import IncomeKpiCards from '../../hr/components/IncomeKpiCards'
import IncomeByTypeBreakdown from '../../hr/components/IncomeByTypeBreakdown'
import IncomeEventsTable from '../../hr/components/IncomeEventsTable'
import useMyIncome from '../../hr/hooks/useMyIncome'
import useSellerPayouts from '../hooks/useSellerPayouts'
import { useSellerCompensation, useSellerTeamRank } from '../hooks/useSellerMe'
import { CalendarCheck, Percent, Trophy, TrendingUp } from 'lucide-react'
import { fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'

function toDateStr(d) { return d.toISOString().slice(0, 10) }

function currentMonthRange() {
  const now = new Date()
  return {
    from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateStr(now),
  }
}

const PAYOUT_STATUS = {
  paid:    { label: 'Выплачено', cls: 'text-emerald-700 bg-emerald-50' },
  pending: { label: 'Ожидает',  cls: 'text-amber-700 bg-amber-50' },
}

export default function SellerIncomePage() {
  const def = currentMonthRange()
  const [from, setFrom] = useState(def.from)
  const [to, setTo] = useState(def.to)
  const [tab, setTab] = useState('income')

  const todayStr = toDateStr(new Date())
  const { data: todayReport } = useMyIncome({ from: todayStr, to: todayStr })
  const { data: report, isLoading, isError, error } = useMyIncome({ from, to, include_events: true })
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
      <div className="hidden lg:block">
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
          MOBILE LAYOUT
      ═══════════════════════════════════════════════════════════ */}
      <div className="lg:hidden min-h-screen" style={{ background: '#F2F4F7' }}>
        {/* Mobile hero */}
        <div
          className="relative overflow-hidden px-5 pt-10 pb-8 mb-1"
          style={{
            background: 'linear-gradient(135deg, #059669 0%, #0D9488 100%)',
            borderRadius: '0 0 32px 32px',
            boxShadow: '0 8px 32px rgba(5,150,105,0.35)',
          }}
        >
          <div className="absolute top-0 right-0 w-48 h-48 rounded-full bg-white/5 -translate-y-16 translate-x-16" />
          <div className="absolute bottom-0 left-8 w-24 h-24 rounded-full bg-white/5 translate-y-8" />
          <div className="relative z-10">
            <p className="text-sm font-medium text-emerald-100">Сегодня заработано</p>
            <p className="text-[42px] font-black text-white tracking-tight leading-none mt-1">
              {fmtAmount(todayIncome)}
            </p>
            <p className="text-xs text-emerald-200 mt-2">По доставленным заказам сегодня</p>
          </div>
        </div>

        <div className="px-4 pb-28 space-y-4 pt-4">
          {/* Info strip */}
          <div className="grid grid-cols-3 gap-3">
            {commissionPct !== null && (
              <div className="card p-3 flex flex-col items-center text-center gap-1">
                <div className="w-7 h-7 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <Percent size={14} className="text-indigo-600" />
                </div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Комиссия</p>
                <p className="text-base font-black text-slate-900">{commissionPct}%</p>
              </div>
            )}
            {rank !== null && (
              <div className="card p-3 flex flex-col items-center text-center gap-1">
                <div className="w-7 h-7 rounded-xl bg-amber-50 flex items-center justify-center">
                  <Trophy size={14} className="text-amber-500" />
                </div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Рейтинг</p>
                <p className="text-base font-black text-slate-900">
                  #{rank}
                  {totalMembers && <span className="text-xs font-normal text-slate-400">/{totalMembers}</span>}
                </p>
              </div>
            )}
            {pendingPayout > 0 && (
              <div className="card p-3 flex flex-col items-center text-center gap-1">
                <div className="w-7 h-7 rounded-xl bg-orange-50 flex items-center justify-center">
                  <CalendarCheck size={14} className="text-orange-500" />
                </div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">К выплате</p>
                <p className="text-xs font-black text-orange-600">{fmtAmount(pendingPayout)}</p>
              </div>
            )}
          </div>

          {/* Formula hint */}
          {commissionPct !== null && (
            <div className="rounded-2xl px-4 py-3" style={{ background: 'linear-gradient(135deg,#F0FDF4,#DCFCE7)' }}>
              <p className="text-xs text-emerald-800">
                <span className="font-semibold">Формула: </span>
                (Сумма заказа − Доставка) × {commissionPct}%
              </p>
            </div>
          )}

          {/* Tab bar */}
          {tabBar}

          {tab === 'income' && incomeContent}
          {tab === 'payouts' && payoutsContent}
        </div>
      </div>
    </>
  )
}
