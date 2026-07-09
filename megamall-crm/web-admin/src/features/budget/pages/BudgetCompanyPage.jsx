import { useState, useCallback } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import {
  ArrowDownCircle, ArrowUpCircle,
  X, Check, Pencil, Plus, Minus,
} from 'lucide-react'
import useBudgetSummary from '../hooks/useBudgetSummary'
import useBudgetTransactions from '../hooks/useBudgetTransactions'
import { postBudgetIncome, postBudgetWithdrawal } from '../api'
import EditBudgetTransactionModal from '../components/EditBudgetTransactionModal'
import DesktopDateRangePicker from '../../../shared/components/DesktopDateRangePicker'
import Alert from '../../../shared/components/Alert'

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt = (v) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

// ── Type config — Company Budget only ever shows top-ups and owner withdrawals ─
const TYPE_CFG = {
  manual_income:    { label: 'Пополнение',           badge: 'bg-emerald-50 text-emerald-700', amtClass: 'text-emerald-600', sign: '+' },
  owner_withdrawal: { label: 'Списание',             badge: 'bg-red-50 text-red-700',         amtClass: 'text-rose-600',    sign: '-' },
}

const TYPE_CHIPS = [
  { key: '',                 label: 'Все' },
  { key: 'manual_income',    label: 'Пополнения' },
  { key: 'owner_withdrawal', label: 'Списания' },
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

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, valueClass = 'text-slate-900', subColor = 'text-slate-400', featured = false }) {
  return (
    <div className={`${featured ? 'bg-indigo-50 border-indigo-100' : 'bg-white border-slate-100'} rounded-[16px] border px-5 py-5 sm:px-6`}>
      <p className={`text-[11px] font-bold uppercase tracking-[0.06em] mb-3 ${featured ? 'text-indigo-600' : 'text-slate-400'}`}>
        {label}
      </p>
      <p className={`${featured ? 'text-[36px]' : 'text-[24px]'} font-extrabold tracking-tight leading-none tabular-nums ${valueClass}`}>
        {value}
      </p>
      {sub && <p className={`text-[12px] font-semibold mt-2 ${subColor}`}>{sub}</p>}
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
    if (isNaN(amt) || amt < 0) { setErr('Введите корректную сумму'); return }
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

        <label className="block text-[11.5px] font-semibold text-slate-500 mb-1.5">Сумма (с)</label>
        <input
          type="number"
          min="0"
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
          Текущий баланс: <span className="font-bold text-slate-700">{fmt(balance)}</span> с
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

// ── Mobile view (< lg) ──────────────────────────────────────────────────────────
const MOBILE_TYPE_CHIPS = [
  { key: '',                 label: 'Все',       Icon: null  },
  { key: 'manual_income',    label: 'Пополнения', Icon: Plus  },
  { key: 'owner_withdrawal', label: 'Списания',   Icon: Minus },
]

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function MobileTxRow({ tx, onClick }) {
  const cfg = TYPE_CFG[tx.transaction_type] ?? TYPE_CFG.manual_income
  const isIncome = tx.transaction_type === 'manual_income'
  const date = new Date(tx.created_at)
  const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-slate-50 px-4 py-3 text-left last:border-b-0 min-h-[44px]"
    >
      <span className={`flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full ${isIncome ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-rose-600'}`}>
        {isIncome ? <ArrowDownCircle size={17} /> : <ArrowUpCircle size={17} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold text-slate-900">{tx.note || cfg.label}</span>
          <EditedMarker tx={tx} />
        </div>
        <div className="mt-0.5 text-[11px] font-medium text-slate-400">
          {isSameDay(date, new Date()) ? timeStr : dateStr}{tx.created_by_name ? ` · ${tx.created_by_name}` : ''}
        </div>
      </div>
      <span className={`whitespace-nowrap text-[14.5px] font-extrabold tabular-nums ${cfg.amtClass}`}>
        {cfg.sign}{fmt(tx.amount)} с
      </span>
    </button>
  )
}

function MobileBudgetView({
  balance, sumLoading, sumError, onRetrySummary, allTimeProfit, allTimeSumLoading, summary,
  incomeCount, withdrawalCount, items, txLoading,
  typeFilter, onTypeFilter, onIncome, onWithdrawal, onEditTx,
}) {
  const today = new Date()
  const todayItems = items.filter((t) => isSameDay(new Date(t.created_at), today))
  const earlierItems = items.filter((t) => !isSameDay(new Date(t.created_at), today))
  const todayLabel = `Сегодня, ${today.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`

  return (
    <div className="p-4 pb-8 space-y-3.5" style={{ background: '#F2F4F7' }}>
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-950">Бюджет</h1>
      </div>

      {sumError && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <span className="text-[12.5px] font-semibold text-red-700">Не удалось загрузить баланс</span>
          <button onClick={onRetrySummary} className="text-[12.5px] font-bold text-red-700 underline flex-shrink-0">Повторить</button>
        </div>
      )}

      {/* Hero balance card */}
      <div
        className="rounded-[24px] px-5 pt-[22px] pb-[18px]"
        style={{ background: 'linear-gradient(135deg,#4f46e5,#4338ca)', boxShadow: '0 12px 32px rgba(79,70,229,.28)' }}
      >
        <div className="text-[11px] font-bold uppercase tracking-[.08em] text-indigo-100/85">Баланс сейчас</div>
        <div className="mt-2 text-[40px] font-extrabold leading-none tracking-tight text-white tabular-nums">
          {sumLoading || sumError ? '—' : fmt(balance)} <span className="text-[22px] font-bold text-indigo-100/80">с</span>
        </div>
        <div className="mt-2 text-[12px] font-semibold text-emerald-300">
          {sumLoading || sumError || allTimeSumLoading ? '—' : `↗ ${fmt(allTimeProfit)} с из чистой прибыли за всё время`}
        </div>
        <div className="mt-[18px] flex gap-2.5">
          <button
            onClick={onIncome}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-white text-[13.5px] font-bold text-indigo-700"
          >
            <Plus size={16} strokeWidth={2.4} />Пополнить
          </button>
          <button
            onClick={onWithdrawal}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border border-white/35 bg-white/10 text-[13.5px] font-bold text-white"
          >
            <Minus size={16} strokeWidth={2.4} />Списать
          </button>
        </div>
      </div>

      {/* Mini KPIs */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Пополнения</div>
          <div className="mt-1.5 text-[16px] font-extrabold tabular-nums text-emerald-600">{sumLoading || sumError ? '—' : `+${fmt(summary?.manual_top_ups)}`}</div>
          <div className="mt-0.5 text-[10.5px] font-semibold text-slate-400">{incomeCount} {incomeCount === 1 ? 'операция' : 'операции'}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Списания</div>
          <div className="mt-1.5 text-[16px] font-extrabold tabular-nums text-rose-600">{sumLoading || sumError ? '—' : `-${fmt(summary?.owner_withdrawals)}`}</div>
          <div className="mt-0.5 text-[10.5px] font-semibold text-slate-400">{withdrawalCount} {withdrawalCount === 1 ? 'операция' : 'операции'}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Прибыль</div>
          <div className="mt-1.5 text-[16px] font-extrabold tabular-nums text-slate-950">{sumLoading || sumError ? '—' : fmt(summary?.profit_from_finance)}</div>
          <div className="mt-0.5 text-[10.5px] font-semibold text-slate-400">из финансов</div>
        </div>
      </div>

      {/* Operations list */}
      <div className="overflow-hidden rounded-[20px] border border-slate-100 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
          <span className="text-[16px] font-extrabold text-slate-950">История операций</span>
          <div className="inline-flex gap-[3px] rounded-full bg-slate-100 p-[3px]">
            {MOBILE_TYPE_CHIPS.map((c) => (
              <button
                key={c.key}
                onClick={() => onTypeFilter(c.key)}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold transition-all ${typeFilter === c.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                {c.Icon ? <c.Icon size={12} strokeWidth={3} /> : c.label}
              </button>
            ))}
          </div>
        </div>

        {txLoading ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-slate-400">Загрузка…</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-slate-400">Транзакции не найдены</div>
        ) : (
          <>
            {todayItems.length > 0 && (
              <>
                <div className="px-4 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{todayLabel}</div>
                {todayItems.map((t) => <MobileTxRow key={t.id} tx={t} onClick={() => onEditTx(t)} />)}
              </>
            )}
            {earlierItems.length > 0 && (
              <>
                <div className="px-4 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Ранее</div>
                {earlierItems.map((t) => <MobileTxRow key={t.id} tx={t} onClick={() => onEditTx(t)} />)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BudgetCompanyPage() {
  const qc = useQueryClient()

  const [range, setRange] = useState(() => computePresetRange('this_month'))

  // Other filters
  const [typeFilter, setTypeFilter]   = useState('')
  const [page, setPage]               = useState(1)

  // Modals
  const [incomeOpen, setIncomeOpen]         = useState(false)
  const [withdrawalOpen, setWithdrawalOpen] = useState(false)
  const [editingTx, setEditingTx]           = useState(null)

  const sharedParams = {
    ...(range?.from && { from: range.from }),
    ...(range?.to   && { to: range.to }),
  }

  const txParams = {
    ...sharedParams,
    ...(typeFilter && { type: typeFilter }),
    page, limit: 50,
  }
  const incomeCountParams = { ...sharedParams, type: 'manual_income', page: 1, limit: 1 }
  const withdrawalCountParams = { ...sharedParams, type: 'owner_withdrawal', page: 1, limit: 1 }

  const { data: summary, isLoading: sumLoading, isError: sumError, error: sumErrorObj, refetch: refetchSummary } = useBudgetSummary(sharedParams)
  const { data: allTimeSummary, isLoading: allTimeSumLoading } = useBudgetSummary()
  const { data: txData,  isLoading: txLoading  } = useBudgetTransactions(txParams)
  const { data: incomeTxData } = useBudgetTransactions(incomeCountParams)
  const { data: withdrawalTxData } = useBudgetTransactions(withdrawalCountParams)

  const balance = summary?.balance ?? 0
  const allTimeProfit = allTimeSummary?.profit_from_finance ?? 0
  const items   = txData?.items ?? []
  const meta    = txData?.meta  ?? {}
  const incomeCount = incomeTxData?.meta?.total ?? 0
  const withdrawalCount = withdrawalTxData?.meta?.total ?? 0

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['budget'] })
  }, [qc])

  const incomeMut     = useMutation({ mutationFn: postBudgetIncome,     onSuccess: () => { setIncomeOpen(false); invalidate() } })
  const withdrawalMut = useMutation({ mutationFn: postBudgetWithdrawal, onSuccess: () => { setWithdrawalOpen(false); invalidate() } })

  return (
    <>
      {/* Mobile-first view (< lg) */}
      <div className="lg:hidden">
        <MobileBudgetView
          balance={balance}
          sumLoading={sumLoading}
          sumError={sumError}
          onRetrySummary={refetchSummary}
          allTimeProfit={allTimeProfit}
          allTimeSumLoading={allTimeSumLoading}
          summary={summary}
          incomeCount={incomeCount}
          withdrawalCount={withdrawalCount}
          items={items}
          txLoading={txLoading}
          typeFilter={typeFilter}
          onTypeFilter={(key) => { setTypeFilter(key); setPage(1) }}
          onIncome={() => setIncomeOpen(true)}
          onWithdrawal={() => setWithdrawalOpen(true)}
          onEditTx={setEditingTx}
        />
      </div>

    <div className="hidden lg:block animate-fade-in bg-slate-100/70 rounded-[22px] p-6 pb-8 space-y-7">

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[28px] font-extrabold text-slate-950 tracking-tight leading-tight">Бюджет компании</h1>
          <p className="text-[15px] font-semibold text-slate-400 mt-1">Баланс, пополнения и списания владельца</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DesktopDateRangePicker
            from={range?.from ?? ''}
            to={range?.to ?? ''}
            onChange={(nextRange) => { setRange({ from: nextRange.from, to: nextRange.to }); setPage(1) }}
            align="right"
          />
          <button
            onClick={() => setWithdrawalOpen(true)}
            className="min-h-10 px-5 rounded-[10px] border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[15px] font-bold transition-all shadow-sm"
          >
            - Списать
          </button>
          <button
            onClick={() => setIncomeOpen(true)}
            className="min-h-10 px-5 rounded-[10px] border-none bg-indigo-600 hover:bg-indigo-700 text-white text-[15px] font-bold transition-all shadow-sm"
          >
            + Пополнить
          </button>
        </div>
      </div>

      {sumError && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Alert variant="error" title="Не удалось загрузить баланс">
            {sumErrorObj?.response?.data?.error?.message ?? sumErrorObj?.message ?? 'Проверьте соединение и попробуйте снова.'}
          </Alert>
          <button
            onClick={() => refetchSummary()}
            className="min-h-10 px-4 rounded-[10px] border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[13.5px] font-bold transition-all shadow-sm flex-shrink-0"
          >
            Повторить
          </button>
        </div>
      )}

      {/* KPI grid — balance is all-time, other cards are scoped to the selected date range */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr] gap-3">
        <KpiCard
          label="Баланс сейчас"
          value={sumLoading || sumError ? '—' : `${fmt(balance)} с`}
          sub={sumLoading || sumError || allTimeSumLoading ? '—' : `${fmt(allTimeProfit)} с из чистой прибыли за всё время`}
          subColor="text-emerald-500"
          valueClass="text-indigo-950"
          featured
        />
        <KpiCard
          label="Пополнения"
          value={sumLoading || sumError ? '—' : `+${fmt(summary?.manual_top_ups)} с`}
          sub={`${incomeCount} ${incomeCount === 1 ? 'операция' : 'операции'}`}
          valueClass="text-emerald-600"
        />
        <KpiCard
          label="Списания"
          value={sumLoading || sumError ? '—' : `-${fmt(summary?.owner_withdrawals)} с`}
          sub={`${withdrawalCount} ${withdrawalCount === 1 ? 'операция' : 'операции'}`}
          valueClass="text-rose-600"
        />
        <KpiCard
          label="Прибыль за период"
          value={sumLoading || sumError ? '—' : `${fmt(summary?.profit_from_finance)} с`}
          sub="из финансов"
          valueClass="text-slate-950"
        />
      </div>

      {/* Transaction table */}
      <div className="bg-white rounded-[16px] border border-slate-100 shadow-sm overflow-hidden">

        {/* Table header + filters */}
        <div className="px-5 sm:px-6 pt-5 pb-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
            <h2 className="text-[19px] font-bold text-slate-950">
              История операций
            </h2>
            <div className="inline-flex self-start sm:self-auto gap-1 bg-slate-100 rounded-[10px] p-[3px]">
              {TYPE_CHIPS.map(c => (
                <button
                  key={c.key}
                  onClick={() => { setTypeFilter(c.key); setPage(1) }}
                  className={`px-3 py-1.5 rounded-[7px] text-[13px] font-bold transition-all whitespace-nowrap ${
                    typeFilter === c.key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Дата','Заметка','Тип','Сумма',''].map(h => (
                  <th key={h} className={`px-5 sm:px-6 py-3 text-[12px] font-extrabold text-slate-400 uppercase tracking-wide border-y border-slate-100 ${h === 'Сумма' || h === '' ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {txLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    {[...Array(5)].map((__, j) => (
                      <td key={j} className="px-5 sm:px-6 py-4">
                        <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: j === 1 ? '180px' : j === 3 ? '90px' : '70px' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 sm:px-6 py-12 text-center text-[13px] text-slate-400">
                    Транзакции не найдены
                  </td>
                </tr>
              ) : (
                items.map((t) => {
                  const cfg = TYPE_CFG[t.transaction_type] ?? TYPE_CFG.manual_income
                  const date = new Date(t.created_at)
                  const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
                  return (
                    <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 sm:px-6 py-4 text-[15px] text-slate-500 whitespace-nowrap tabular-nums">
                        {dateStr}
                      </td>
                      <td className="px-5 sm:px-6 py-4 text-[15px] font-medium text-slate-900 min-w-[260px]">
                        <span>{t.note || '—'}</span>
                        <span className="ml-2"><EditedMarker tx={t} /></span>
                        {t.created_by_name && <span className="block text-[11px] font-semibold text-slate-300 mt-1">{t.created_by_name}</span>}
                      </td>
                      <td className="px-5 sm:px-6 py-4">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-[12px] font-bold ${cfg.badge}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className={`px-5 sm:px-6 py-4 text-[15px] font-extrabold whitespace-nowrap tabular-nums text-right ${cfg.amtClass}`}>
                        {cfg.sign}{fmt(t.amount)} с
                      </td>
                      <td className="px-5 sm:px-6 py-4 text-right">
                        <button
                          onClick={() => setEditingTx(t)}
                          className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-indigo-100 inline-flex items-center justify-center text-slate-400 hover:text-indigo-600 transition-colors"
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
    </>
  )
}
