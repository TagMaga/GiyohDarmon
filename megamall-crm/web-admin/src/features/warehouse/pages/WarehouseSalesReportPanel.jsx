import { useMemo, useState } from 'react'
import { BarChart2, Calendar } from 'lucide-react'
import EmptyState from '../../../shared/components/EmptyState'
import Alert from '../../../shared/components/Alert'
import useSalesReport from '../hooks/useSalesReport'
import { fmtMoney } from '../utils/warehouseHelpers'

function toDateInput(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

const PRESETS = [
  { id: 'today', label: 'Сегодня', from: () => new Date() },
  { id: '7d', label: '7 дней', from: () => daysAgo(6) },
  { id: '30d', label: '30 дней', from: () => daysAgo(29) },
  { id: 'month', label: 'Этот месяц', from: () => new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
  { id: 'year', label: 'Этот год', from: () => new Date(new Date().getFullYear(), 0, 1) },
  { id: 'all', label: 'Всё время', from: () => null },
]

function rowValue(row, snake, pascal) {
  return row[snake] ?? row[pascal] ?? 0
}

// Sales report for the warehouse "Отчёты" tab: total units sold, revenue,
// COGS, and profit per product for a chosen date range. Backed by
// GET /inventory/reports/sales-by-product, which aggregates in SQL rather
// than pulling the full movement feed client-side (a year of sales can be
// thousands of rows).
export default function SalesReportPanel() {
  const [preset, setPreset] = useState('30d')
  const [dateFrom, setDateFrom] = useState(() => toDateInput(daysAgo(29)))
  const [dateTo, setDateTo] = useState(() => toDateInput(new Date()))

  function applyPreset(p) {
    setPreset(p.id)
    const from = p.from()
    setDateFrom(from ? toDateInput(from) : '')
    setDateTo(from ? toDateInput(new Date()) : '')
  }

  const params = useMemo(() => ({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }), [dateFrom, dateTo])

  const { data: rows = [], isPending, error } = useSalesReport(params)

  const totals = useMemo(() => rows.reduce((acc, r) => {
    acc.quantity += rowValue(r, 'quantity_sold', 'QuantitySold')
    acc.revenue += rowValue(r, 'revenue', 'Revenue')
    acc.cogs += rowValue(r, 'cogs', 'COGS')
    acc.profit += rowValue(r, 'profit', 'Profit')
    return acc
  }, { quantity: 0, revenue: 0, cogs: 0, profit: 0 }), [rows])

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)] lg:grid-cols-[auto_1fr] lg:items-center">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              className={[
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                preset === p.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              ].join(' ')}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Calendar size={14} className="text-slate-400" />
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => { setPreset('custom'); setDateFrom(e.target.value) }}
              className="input py-1.5 text-xs"
            />
          </label>
          <span className="text-xs text-slate-400">—</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => { setPreset('custom'); setDateTo(e.target.value) }}
            className="input py-1.5 text-xs"
          />
        </div>
      </section>

      {error && (
        <Alert variant="error" title="Ошибка загрузки отчёта">
          {error?.response?.data?.error?.message ?? error?.message}
        </Alert>
      )}

      {!error && !isPending && rows.length === 0 && (
        <EmptyState icon={<BarChart2 size={22} />} title="Продаж за период нет" description="Измените диапазон дат." />
      )}

      {!error && rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)] sm:grid-cols-4">
            <TotalTile label="Товаров продано" value={totals.quantity.toLocaleString('ru-RU')} />
            <TotalTile label="Выручка" value={fmtMoney(totals.revenue)} />
            <TotalTile label="Себестоимость" value={fmtMoney(totals.cogs)} />
            <TotalTile label="Прибыль" value={fmtMoney(totals.profit)} tone="emerald" />
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)] lg:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 text-left">Товар</th>
                  <th className="px-3 py-2.5 text-right">Продано, шт.</th>
                  <th className="px-3 py-2.5 text-right">Выручка</th>
                  <th className="px-3 py-2.5 text-right">Себестоимость</th>
                  <th className="px-3 py-2.5 text-right">Прибыль</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => <ReportRow key={r.product_id ?? r.ProductID} row={r} />)}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-sm font-bold">
                <tr>
                  <td className="px-3 py-2.5">Итого</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{totals.quantity.toLocaleString('ru-RU')}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(totals.revenue)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(totals.cogs)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{fmtMoney(totals.profit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="space-y-2.5 lg:hidden">
            {rows.map((r) => <ReportCard key={r.product_id ?? r.ProductID} row={r} />)}
          </div>
        </>
      )}
    </div>
  )
}

function TotalTile({ label, value, tone }) {
  return (
    <div className="border-b border-r border-slate-100 px-3 py-3 last:border-r-0 sm:[&:nth-child(4n)]:border-r-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 truncate text-base font-bold tabular-nums ${tone === 'emerald' ? 'text-emerald-700' : 'text-slate-950'}`}>{value}</p>
    </div>
  )
}

function ReportRow({ row }) {
  const name = row.product_name ?? row.ProductName ?? '—'
  const sku = row.sku ?? row.SKU ?? '—'
  const qty = rowValue(row, 'quantity_sold', 'QuantitySold')
  const revenue = rowValue(row, 'revenue', 'Revenue')
  const cogs = rowValue(row, 'cogs', 'COGS')
  const profit = rowValue(row, 'profit', 'Profit')
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-2.5">
        <p className="truncate font-bold text-slate-900">{name}</p>
        <p className="font-mono text-xs text-slate-400">{sku}</p>
      </td>
      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-950">{qty.toLocaleString('ru-RU')}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmtMoney(revenue)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{fmtMoney(cogs)}</td>
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-700">{fmtMoney(profit)}</td>
    </tr>
  )
}

function ReportCard({ row }) {
  const name = row.product_name ?? row.ProductName ?? '—'
  const sku = row.sku ?? row.SKU ?? '—'
  const qty = rowValue(row, 'quantity_sold', 'QuantitySold')
  const revenue = rowValue(row, 'revenue', 'Revenue')
  const cogs = rowValue(row, 'cogs', 'COGS')
  const profit = rowValue(row, 'profit', 'Profit')
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-950">{name}</p>
          <p className="font-mono text-xs text-slate-400">{sku}</p>
        </div>
        <p className="flex-shrink-0 text-lg font-bold tabular-nums text-slate-950">{qty.toLocaleString('ru-RU')}</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2.5 text-center text-xs">
        <div>
          <p className="font-semibold text-slate-700">{fmtMoney(revenue)}</p>
          <p className="mt-0.5 text-slate-400">Выручка</p>
        </div>
        <div>
          <p className="font-semibold text-slate-500">{fmtMoney(cogs)}</p>
          <p className="mt-0.5 text-slate-400">Себест.</p>
        </div>
        <div>
          <p className="font-semibold text-emerald-700">{fmtMoney(profit)}</p>
          <p className="mt-0.5 text-slate-400">Прибыль</p>
        </div>
      </div>
    </article>
  )
}
