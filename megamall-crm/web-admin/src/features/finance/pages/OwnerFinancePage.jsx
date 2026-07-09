/**
 * OwnerFinancePage — /owner/finance
 *
 * Full owner finance dashboard. Layout:
 *   1. Header (icon + title + subtitle)
 *   2. 6 KPI tiles (from /finance/summary)
 *   3. Two-col on md+: RevenueBreakdownCard | CommissionsBreakdown
 *   4. FinanceEventsTable (paginated ledger)
 *
 * All monetary figures come from the backend — zero client-side aggregation.
 */
import { useState }              from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, PlusCircle, TrendingUp, X } from 'lucide-react'
import Alert                     from '../../../shared/components/Alert'
import DesktopDateRangePicker    from '../../../shared/components/DesktopDateRangePicker'
import MobileDateRangeCalendar   from '../../../shared/components/MobileDateRangeCalendar'
import { postFinanceExpense }    from '../api'
import FinanceSummaryKpis        from '../components/FinanceSummaryKpis'
import RevenueBreakdownCard      from '../components/RevenueBreakdownCard'
import CommissionsBreakdown      from '../components/CommissionsBreakdown'
import FinanceEventsTable        from '../components/FinanceEventsTable'
import useFinanceSummary         from '../hooks/useFinanceSummary'

// ── Date helpers ───────────────────────────────────────────────────────────────

function toYMD(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function thisMonthDefault() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: toYMD(start), to: toYMD(now) }
}

const EXPENSE_CATEGORIES = [
  { value: 'salary', label: 'Зарплата' },
  { value: 'rent', label: 'Аренда' },
  { value: 'marketing', label: 'Маркетинг' },
  { value: 'taxes', label: 'Налоги' },
  { value: 'other', label: 'Другое' },
]

function AddExpenseModal({ open, onClose, onSubmit, loading, error }) {
  const [category, setCategory] = useState('salary')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [localError, setLocalError] = useState('')

  function resetAndClose() {
    setCategory('salary')
    setAmount('')
    setNote('')
    setLocalError('')
    onClose()
  }

  function handleSubmit() {
    const parsedAmount = Number(amount)
    if (amount === '' || isNaN(parsedAmount) || parsedAmount < 0) {
      setLocalError('Введите корректную сумму')
      return
    }
    setLocalError('')
    onSubmit({
      category,
      amount: parsedAmount,
      note: note.trim(),
    })
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm"
      onClick={(event) => { if (event.target === event.currentTarget) resetAndClose() }}
    >
      <div className="w-full max-w-[400px] rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Добавить расход</h2>
            <p className="mt-1 text-xs text-slate-400">Прочие расходы для финансового периода</p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
            aria-label="Закрыть"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">Категория</label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-indigo-300 focus:bg-white"
            >
              {EXPENSE_CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">Сумма (с)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => { setAmount(event.target.value); setLocalError('') }}
              placeholder="10"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none transition-colors focus:border-indigo-300 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">Заметка</label>
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Например: реклама за день"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-colors focus:border-indigo-300 focus:bg-white"
            />
          </div>
        </div>

        {(localError || error) && (
          <p className="mt-3 text-xs font-medium text-rose-600">
            {localError || error?.response?.data?.error?.message || error?.message || 'Не удалось добавить расход'}
          </p>
        )}

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={resetAndClose}
            className="flex-1 rounded-full border border-slate-200 py-2.5 text-[12.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-orange-500 py-2.5 text-[12.5px] font-semibold text-white shadow-[0_4px_10px_rgba(249,115,22,.25)] transition-colors hover:bg-orange-600 disabled:opacity-60"
          >
            <Check size={14} />
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function OwnerFinancePage() {
  const queryClient = useQueryClient()
  const [{ from, to }, setRange] = useState(() => thisMonthDefault())
  const [expenseOpen, setExpenseOpen] = useState(false)

  const summaryParams = { from, to }
  const {
    data:      summary,
    isLoading: summaryLoading,
    isError:   summaryError,
    error:     summaryErr,
  } = useFinanceSummary(summaryParams)

  const expenseMut = useMutation({
    mutationFn: postFinanceExpense,
    onSuccess: () => {
      setExpenseOpen(false)
      queryClient.invalidateQueries({ queryKey: ['finance'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] }) // Finance profit feeds Budget's live balance
    },
  })

  return (
    <div className="p-4 md:p-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 flex-shrink-0">
            <TrendingUp size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Финансы</h1>
            <p className="text-xs text-slate-400">Финансовая сводка бизнеса</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpenseOpen(true)}
            className="inline-flex h-9 flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-orange-200 bg-orange-50 px-3.5 text-[12px] font-semibold text-orange-700 transition-colors hover:border-orange-300 hover:bg-orange-100"
          >
            <PlusCircle size={14} />
            Добавить расход
          </button>

          <DesktopDateRangePicker
            variant="trigger"
            from={from}
            to={to}
            onChange={({ from: nextFrom, to: nextTo }) => setRange({ from: nextFrom, to: nextTo })}
          />
        </div>
      </div>
      <MobileDateRangeCalendar
        className="w-full md:hidden"
        from={from}
        to={to}
        onChange={({ from: nextFrom, to: nextTo }) => setRange({ from: nextFrom, to: nextTo })}
      />

      {/* ── Error alert ─────────────────────────────────────────────────────── */}
      {summaryError && (
        <Alert variant="error">
          {summaryErr?.response?.data?.error?.message ?? summaryErr?.message ?? 'Ошибка загрузки данных'}
        </Alert>
      )}

      {/* ── 6 KPI tiles ─────────────────────────────────────────────────────── */}
      <FinanceSummaryKpis
        summary={summary}
        loading={summaryLoading}
      />

      {/* ── Revenue breakdown + Commissions (side by side on md+) ───────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RevenueBreakdownCard
          revenue={summary?.revenue}
          orders={summary?.orders}
          expenses={summary?.expenses}
          loading={summaryLoading}
        />
        <CommissionsBreakdown
          revenue={summary?.revenue}
          loading={summaryLoading}
        />
      </div>

      {/* ── Financial events ledger ──────────────────────────────────────────── */}
      <div className="card p-5">
        <FinanceEventsTable
          from={from}
          to={to}
          onDateChange={({ from: nextFrom, to: nextTo }) => setRange({ from: nextFrom, to: nextTo })}
        />
      </div>

      <AddExpenseModal
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        onSubmit={(payload) => expenseMut.mutate(payload)}
        loading={expenseMut.isPending}
        error={expenseMut.error}
      />

    </div>
  )
}
