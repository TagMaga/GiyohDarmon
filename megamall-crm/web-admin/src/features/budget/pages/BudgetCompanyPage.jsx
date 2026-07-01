import { useState, useCallback, useMemo } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, ChevronRight,
  TrendingUp, CalendarDays, X, Check, Search, Pencil,
} from 'lucide-react'
import useBudgetSummary from '../hooks/useBudgetSummary'
import useBudgetTransactions from '../hooks/useBudgetTransactions'
import useBudgetCreators from '../hooks/useBudgetCreators'
import { postBudgetIncome, postBudgetWithdrawal } from '../api'
import EditBudgetTransactionModal from '../components/EditBudgetTransactionModal'

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt = (v) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

// ── Type config — Company Budget only ever shows top-ups and owner withdrawals ─
const TYPE_CFG = {
  manual_income:    { label: 'Пополнение',           badge: 'bg-emerald-50 text-emerald-700', amtClass: 'text-emerald-600', sign: '+' },
  owner_withdrawal: { label: 'Списание владельцем',  badge: 'bg-red-50 text-red-700',         amtClass: 'text-red-600',     sign: '-' },
}

const TYPE_CHIPS = [
  { key: '',                 label: 'Все' },
  { key: 'manual_income',    label: 'Пополнения' },
  { key: 'owner_withdrawal', label: 'Списания' },
]

// ── Date range presets ─────────────────────────────────────────────────────────
const DATE_PRESETS = [
  { key: 'today',      label: 'Сегодня' },
  { key: 'yesterday',  label: 'Вчера' },
  { key: '7d',         label: '7 дней' },
  { key: '30d',        label: '30 дней' },
  { key: 'this_month', label: 'Этот месяц' },
  { key: 'prev_month', label: 'Прошлый месяц' },
  { key: 'custom',     label: 'Период' },
]

function toYMD(date) {
  return date.toISOString().slice(0, 10)
}

function computePresetRange(key) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (key) {
    case 'today':
      return { from: toYMD(today), to: toYMD(today) }
    case 'yesterday': {
      const d = new Date(today); d.setDate(d.getDate() - 1)
      return { from: toYMD(d), to: toYMD(d) }
    }
    case '7d': {
      const s = new Date(today); s.setDate(s.getDate() - 6)
      return { from: toYMD(s), to: toYMD(today) }
    }
    case '30d': {
      const s = new Date(today); s.setDate(s.getDate() - 29)
      return { from: toYMD(s), to: toYMD(today) }
    }
    case 'this_month': {
      const s = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: toYMD(s), to: toYMD(today) }
    }
    case 'prev_month': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const e = new Date(today.getFullYear(), today.getMonth(), 0)
      return { from: toYMD(s), to: toYMD(e) }
    }
    default:
      return null // custom — caller supplies its own from/to
  }
}

// ── Date range filter ─────────────────────────────────────────────────────────
function DateRangeFilter({ preset, onPresetChange, customFrom, customTo, onCustomFromChange, onCustomToChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 bg-slate-50 rounded-[10px] p-[3px]">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => onPresetChange(p.key)}
            className={`px-3 py-1.5 rounded-[7px] text-[11.5px] font-semibold transition-all whitespace-nowrap ${
              preset === p.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => onCustomFromChange(e.target.value)}
            className="px-2.5 py-1.5 rounded-[9px] border-[1.5px] border-slate-200 focus:border-indigo-400 outline-none text-[11.5px] text-slate-600 bg-white w-[130px] transition-colors"
          />
          <span className="text-slate-300 text-[11px]">—</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => onCustomToChange(e.target.value)}
            className="px-2.5 py-1.5 rounded-[9px] border-[1.5px] border-slate-200 focus:border-indigo-400 outline-none text-[11.5px] text-slate-600 bg-white w-[130px] transition-colors"
          />
        </div>
      )}
    </div>
  )
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, subColor = 'text-slate-400', icon: Icon, topColor }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-5 ${topColor ? `border-t-[3px] ${topColor}` : ''}`}>
      <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
        {Icon && <Icon size={12} />}{label}
      </p>
      <p className="text-[22px] font-bold text-slate-900 tracking-tight leading-none">{value}</p>
      {sub && <p className={`text-[10.5px] font-medium mt-1.5 ${subColor}`}>{sub}</p>}
    </div>
  )
}

// ── Modal (Add top-up / Add withdrawal) ────────────────────────────────────────
function Modal({ open, onClose, title, sub, iconBg, iconColor, Icon, onSubmit, loading, balance, isWithdrawal }) {
  const [amount, setAmount] = useState('')
  const [note, setNote]     = useState('')
  const [err, setErr]       = useState('')

  function handleSubmit() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setErr('Введите сумму больше нуля'); return }
    if (isWithdrawal && amt > balance) { setErr('Недостаточно средств на балансе'); return }
    setErr('')
    onSubmit({ amount: amt, note: note.trim() })
  }

  function handleClose() {
    setAmount(''); setNote(''); setErr(''); onClose()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="bg-white rounded-[20px] shadow-2xl w-[360px] max-w-[94vw] p-7 relative animate-fade-in">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
        >
          <X size={14} />
        </button>

        <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${iconBg}`}>
          <Icon size={20} className={iconColor} />
        </div>
        <h2 className="text-[15px] font-bold text-slate-900 mb-1">{title}</h2>
        <p className="text-[11.5px] text-slate-400 mb-5">{sub}</p>

        <label className="block text-[11.5px] font-semibold text-slate-500 mb-1.5">Сумма (TJS)</label>
        <input
          type="number"
          min="1"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setErr('') }}
          placeholder="50 000"
          className="w-full px-4 py-2.5 rounded-xl border-[1.5px] border-slate-200 focus:border-indigo-400 outline-none text-[14px] font-semibold bg-slate-50 focus:bg-white mb-3 transition-colors"
        />

        <label className="block text-[11.5px] font-semibold text-slate-500 mb-1.5">Примечание</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={isWithdrawal ? 'Личные нужды владельца' : 'Инвестиция от партнёров'}
          className="w-full px-4 py-2.5 rounded-xl border-[1.5px] border-slate-200 focus:border-indigo-400 outline-none text-[13px] bg-slate-50 focus:bg-white mb-1 transition-colors"
        />

        {err && <p className="text-red-500 text-[11px] mt-1 mb-1">{err}</p>}

        <p className="text-[11px] text-slate-400 mb-5 mt-2">
          Текущий баланс: <span className="font-bold text-slate-700">{fmt(balance)}</span> TJS
        </p>

        <div className="flex gap-2">
          <button
            onClick={handleClose}
            className="flex-1 py-2.5 rounded-full border border-slate-200 text-slate-600 text-[12.5px] font-semibold hover:bg-slate-50 transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className={`flex-1 py-2.5 rounded-full text-white text-[12.5px] font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-60 ${
              isWithdrawal ? 'bg-red-500 hover:bg-red-600 shadow-[0_4px_10px_rgba(239,68,68,.3)]'
                            : 'bg-emerald-500 hover:bg-emerald-600 shadow-[0_4px_10px_rgba(16,185,129,.3)]'
            }`}
          >
            <Check size={14} />Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

function EditedMarker({ tx }) {
  if (!tx?.is_edited) return null
  const edits = Number(tx.edit_count || 0)
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50/90 px-2 py-0.5 text-[10px] font-bold leading-4 text-amber-700"
      title={tx.last_edited_at ? `Изменено ${new Date(tx.last_edited_at).toLocaleString('ru-RU')}` : 'Изменено'}
    >
      <Pencil size={10} />
      Изменено{edits > 1 ? ` ${edits}` : ''}
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BudgetCompanyPage() {
  const qc = useQueryClient()

  // Date range
  const [preset, setPreset]       = useState('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]     = useState('')
  const range = preset === 'custom' ? { from: customFrom, to: customTo } : computePresetRange(preset)

  // Other filters
  const [typeFilter, setTypeFilter]   = useState('')
  const [search, setSearch]           = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [page, setPage]               = useState(1)

  // Modals
  const [incomeOpen, setIncomeOpen]         = useState(false)
  const [withdrawalOpen, setWithdrawalOpen] = useState(false)
  const [editingTx, setEditingTx]           = useState(null)

  const sharedParams = {
    ...(range?.from && { from: range.from }),
    ...(range?.to   && { to: range.to }),
    ...(ownerFilter && { created_by: ownerFilter }),
  }

  const txParams = {
    ...sharedParams,
    ...(typeFilter && { type: typeFilter }),
    ...(search     && { search }),
    page, limit: 50,
  }

  const { data: summary, isLoading: sumLoading } = useBudgetSummary(sharedParams)
  const { data: txData,  isLoading: txLoading  } = useBudgetTransactions(txParams)
  const { data: creators = [] } = useBudgetCreators()

  const balance = summary?.balance ?? 0
  const items   = txData?.items ?? []
  const meta    = txData?.meta  ?? {}

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['budget'] })
  }, [qc])

  const incomeMut     = useMutation({ mutationFn: postBudgetIncome,     onSuccess: () => { setIncomeOpen(false); invalidate() } })
  const withdrawalMut = useMutation({ mutationFn: postBudgetWithdrawal, onSuccess: () => { setWithdrawalOpen(false); invalidate() } })

  const todayPos = (summary?.today_change ?? 0) >= 0

  const ownerName = useMemo(
    () => creators.find((c) => c.id === ownerFilter)?.full_name,
    [creators, ownerFilter],
  )

  function handlePresetChange(key) {
    setPreset(key)
    setPage(1)
  }

  return (
    <div className="animate-fade-in space-y-6 p-6 pb-16">

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Бюджет компании</h1>
          <p className="text-xs text-slate-400 mt-0.5">Доступные средства компании</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWithdrawalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-red-500 hover:bg-red-600 text-white text-[12.5px] font-semibold shadow-[0_4px_10px_rgba(239,68,68,.25)] transition-all"
          >
            <ArrowUpCircle size={14} />Списание владельцем
          </button>
          <button
            onClick={() => setIncomeOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-[12.5px] font-semibold shadow-[0_4px_10px_rgba(16,185,129,.25)] transition-all"
          >
            <ArrowDownCircle size={14} />Пополнение
          </button>
        </div>
      </div>

      {/* Hero balance card — Company/Current Balance is always all-time, unaffected by the date filter */}
      <div className="relative overflow-hidden rounded-[20px] bg-indigo-600 px-7 py-6 text-white">
        <div className="absolute right-[-30px] top-[-30px] w-40 h-40 rounded-full bg-white/[.06]" />
        <div className="absolute left-[40px] bottom-[-50px] w-28 h-28 rounded-full bg-white/[.05]" />
        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/60 mb-1.5">
              Баланс компании · Текущий баланс
            </p>
            {sumLoading ? (
              <div className="h-10 w-48 bg-white/20 rounded-xl animate-pulse" />
            ) : (
              <p className="text-[36px] font-bold tracking-tight leading-none">
                {fmt(balance)} <span className="text-[18px] opacity-60 font-medium">TJS</span>
              </p>
            )}
            <p className={`mt-2 text-[12px] font-medium flex items-center gap-1 ${todayPos ? 'text-emerald-300' : 'text-red-300'}`}>
              <ChevronRight size={12} className={todayPos ? 'rotate-90' : '-rotate-90'} />
              {todayPos ? '+' : ''}{fmt(summary?.today_change ?? 0)} TJS сегодня
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50 mb-1">Авто-прибыль из Финансов</p>
            <p className="text-[14px] font-bold text-sky-300">{fmt(summary?.profit_from_finance ?? 0)} TJS</p>
            <p className="text-[10px] text-white/40 mt-0.5">за выбранный период</p>
          </div>
        </div>
      </div>

      {/* Date range filter */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3">
        <DateRangeFilter
          preset={preset}
          onPresetChange={handlePresetChange}
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={(v) => { setCustomFrom(v); setPage(1) }}
          onCustomToChange={(v) => { setCustomTo(v); setPage(1) }}
        />
      </div>

      {/* KPI grid — all scoped to the selected date range */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Всего пришло"
          value={sumLoading ? '—' : `${fmt(summary?.total_received)} TJS`}
          sub="прибыль + пополнения"
          subColor="text-emerald-500"
          icon={ArrowDownCircle}
          topColor="border-t-emerald-400"
        />
        <KpiCard
          label="Прибыль из Финансов"
          value={sumLoading ? '—' : `${fmt(summary?.profit_from_finance)} TJS`}
          sub="авто-перенос"
          icon={TrendingUp}
          topColor="border-t-indigo-400"
        />
        <KpiCard
          label="Пополнения"
          value={sumLoading ? '—' : `${fmt(summary?.manual_top_ups)} TJS`}
          subColor="text-emerald-500"
          icon={ArrowDownCircle}
          topColor="border-t-emerald-400"
        />
        <KpiCard
          label="Списания владельцем"
          value={sumLoading ? '—' : `${fmt(summary?.owner_withdrawals)} TJS`}
          subColor="text-red-500"
          icon={ArrowUpCircle}
          topColor="border-t-red-400"
        />
      </div>

      {/* Transaction table */}
      <div className="bg-white rounded-[16px] border border-slate-100 shadow-sm overflow-hidden">

        {/* Table header + filters */}
        <div className="px-5 pt-4 pb-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-bold text-slate-900 flex items-center gap-2">
              <Wallet size={14} className="text-slate-400" />История транзакций
            </h2>
            <span className="text-[11px] text-slate-400 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-full">
              {meta?.total ?? items.length} операций
            </span>
          </div>

          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-50">
            {/* Type chips */}
            <div className="flex gap-1 bg-slate-50 rounded-[10px] p-[3px]">
              {TYPE_CHIPS.map(c => (
                <button
                  key={c.key}
                  onClick={() => { setTypeFilter(c.key); setPage(1) }}
                  className={`px-3 py-1.5 rounded-[7px] text-[11.5px] font-semibold transition-all whitespace-nowrap ${
                    typeFilter === c.key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Owner filter */}
            <select
              value={ownerFilter}
              onChange={(e) => { setOwnerFilter(e.target.value); setPage(1) }}
              className="px-2.5 py-1.5 rounded-[9px] border-[1.5px] border-slate-200 focus:border-indigo-400 outline-none text-[11.5px] font-medium text-slate-600 bg-white transition-colors"
            >
              <option value="">Все сотрудники</option>
              {creators.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>

            {/* Search */}
            <div className="flex items-center gap-2 flex-1 min-w-[140px] relative">
              <Search size={13} className="absolute left-3 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Поиск по примечанию…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                className="w-full pl-8 pr-3 py-1.5 rounded-[9px] border-[1.5px] border-slate-200 focus:border-indigo-400 outline-none text-[12px] bg-white transition-colors"
              />
            </div>
          </div>
          {ownerName && (
            <p className="text-[11px] text-slate-400 pt-2">
              Показаны операции сотрудника: <span className="font-semibold text-slate-600">{ownerName}</span>
            </p>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Дата','Тип','Сумма','Примечание','Создал','Изменено',''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 border-b border-slate-100">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {txLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    {[...Array(7)].map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: j === 2 ? '80px' : j === 3 ? '140px' : '60px' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[12px] text-slate-400">
                    Транзакции не найдены
                  </td>
                </tr>
              ) : (
                items.map((t) => {
                  const cfg = TYPE_CFG[t.transaction_type] ?? TYPE_CFG.manual_income
                  const date = new Date(t.created_at)
                  const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
                  const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                  return (
                    <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 text-[11.5px] text-slate-400 whitespace-nowrap">
                        {dateStr}<br/><span className="text-[10.5px] text-slate-300">{timeStr}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${cfg.badge}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-[12.5px] font-bold whitespace-nowrap tabular-nums ${cfg.amtClass}`}>
                        {cfg.sign}{fmt(t.amount)} TJS
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-500 max-w-[180px] truncate">{t.note || '—'}</td>
                      <td className="px-4 py-3 text-[11.5px] text-slate-400">{t.created_by_name || 'Авто'}</td>
                      <td className="px-4 py-3">
                        <EditedMarker tx={t} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setEditingTx(t)}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-indigo-100 flex items-center justify-center text-slate-400 hover:text-indigo-600 transition-colors"
                          title="Редактировать"
                        >
                          <Pencil size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta?.total_pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-50">
            <p className="text-[11px] text-slate-400">
              Страница {meta.page} из {meta.total_pages}
            </p>
            <div className="flex gap-1.5">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11.5px] font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                ←
              </button>
              <button
                disabled={page >= meta.total_pages}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11.5px] font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add top-up modal */}
      <Modal
        open={incomeOpen}
        onClose={() => setIncomeOpen(false)}
        title="Пополнение баланса"
        sub="Внешние средства (заём, вклад владельца и т.д.)"
        iconBg="bg-emerald-50"
        iconColor="text-emerald-600"
        Icon={ArrowDownCircle}
        onSubmit={(data) => incomeMut.mutate(data)}
        loading={incomeMut.isPending}
        balance={balance}
        isWithdrawal={false}
      />

      {/* Add owner withdrawal modal */}
      <Modal
        open={withdrawalOpen}
        onClose={() => setWithdrawalOpen(false)}
        title="Списание владельцем"
        sub="Личное изъятие средств со счёта компании"
        iconBg="bg-red-50"
        iconColor="text-red-600"
        Icon={ArrowUpCircle}
        onSubmit={(data) => withdrawalMut.mutate(data)}
        loading={withdrawalMut.isPending}
        balance={balance}
        isWithdrawal
      />

      {/* Edit transaction modal (with history) */}
      <EditBudgetTransactionModal
        transaction={editingTx}
        onClose={() => setEditingTx(null)}
        onSuccess={invalidate}
      />
    </div>
  )
}
