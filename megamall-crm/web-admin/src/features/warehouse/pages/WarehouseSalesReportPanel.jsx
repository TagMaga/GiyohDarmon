import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart2, CalendarDays, ChevronDown, Package, Search, X } from 'lucide-react'
import EmptyState from '../../../shared/components/EmptyState'
import Alert from '../../../shared/components/Alert'
import useSalesReport from '../hooks/useSalesReport'
import useProducts from '../hooks/useProducts'
import { fmtMoney, getId, getProductImageSrcSet, getProductImageVariant, getProductName, getProductSku } from '../utils/warehouseHelpers'

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
  const [productIds, setProductIds] = useState([])

  function applyPreset(p) {
    setPreset(p.id)
    const from = p.from()
    setDateFrom(from ? toDateInput(from) : '')
    setDateTo(from ? toDateInput(new Date()) : '')
  }

  function applyCustomDates(from, to) {
    setPreset('custom')
    setDateFrom(from)
    setDateTo(to)
  }

  const params = useMemo(() => ({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }), [dateFrom, dateTo])

  const { data: rows = [], isPending, error } = useSalesReport(params)
  const { data: products = [] } = useProducts()

  const visibleRows = useMemo(() => {
    if (productIds.length === 0) return rows
    const selected = new Set(productIds)
    return rows.filter((r) => selected.has(r.product_id ?? r.ProductID))
  }, [rows, productIds])

  const totals = useMemo(() => visibleRows.reduce((acc, r) => {
    acc.quantity += rowValue(r, 'quantity_sold', 'QuantitySold')
    acc.revenue += rowValue(r, 'revenue', 'Revenue')
    acc.cogs += rowValue(r, 'cogs', 'COGS')
    acc.profit += rowValue(r, 'profit', 'Profit')
    return acc
  }, { quantity: 0, revenue: 0, cogs: 0, profit: 0 }), [visibleRows])

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodFilter preset={preset} dateFrom={dateFrom} dateTo={dateTo} onPreset={applyPreset} onCustom={applyCustomDates} />
          <ProductFilter products={products} selected={productIds} onChange={setProductIds} />
        </div>
      </section>

      {error && (
        <Alert variant="error" title="Ошибка загрузки отчёта">
          {error?.response?.data?.error?.message ?? error?.message}
        </Alert>
      )}

      {!error && !isPending && visibleRows.length === 0 && (
        <EmptyState icon={<BarChart2 size={22} />} title="Продаж за период нет" description="Измените диапазон дат или товары." />
      )}

      {!error && visibleRows.length > 0 && (
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
                {visibleRows.map((r) => <ReportRow key={r.product_id ?? r.ProductID} row={r} />)}
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
            {visibleRows.map((r) => <ReportCard key={r.product_id ?? r.ProductID} row={r} />)}
          </div>
        </>
      )}
    </div>
  )
}

// ── Filter dropdowns ─────────────────────────────────────────────────────────

function useClickOutside(ref, onOutside) {
  useEffect(() => {
    function handlePointer(e) { if (ref.current && !ref.current.contains(e.target)) onOutside() }
    function handleKey(e) { if (e.key === 'Escape') onOutside() }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function DropdownTrigger({ icon, active, open, onClick, onClear, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={[
        'inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-colors',
        active ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
      ].join(' ')}
    >
      {icon}
      <span className="max-w-[220px] truncate">{children}</span>
      {active ? (
        <span
          role="button"
          tabIndex={0}
          aria-label="Сбросить"
          onClick={(e) => { e.stopPropagation(); onClear() }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onClear() } }}
          className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full hover:bg-indigo-100"
        >
          <X size={11} />
        </span>
      ) : (
        <ChevronDown size={13} className={`opacity-50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      )}
    </button>
  )
}

function PeriodFilter({ preset, dateFrom, dateTo, onPreset, onCustom }) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(dateFrom)
  const [draftTo, setDraftTo] = useState(dateTo)
  const rootRef = useRef(null)
  useClickOutside(rootRef, () => setOpen(false))

  function toggle() {
    if (!open) { setDraftFrom(dateFrom); setDraftTo(dateTo) }
    setOpen((o) => !o)
  }

  const activePreset = PRESETS.find((p) => p.id === preset)
  const label = activePreset
    ? activePreset.label
    : (dateFrom && dateTo ? `${dateFrom} — ${dateTo}` : 'Период')

  return (
    <div className="relative" ref={rootRef}>
      <DropdownTrigger
        icon={<CalendarDays size={14} className="opacity-60" />}
        active={preset !== '30d'}
        open={open}
        onClick={toggle}
        onClear={() => onPreset(PRESETS.find((p) => p.id === '30d'))}
      >
        {label}
      </DropdownTrigger>
      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-[300px] rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xl">
          <div className="flex flex-col gap-0.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onPreset(p); setOpen(false) }}
                className={[
                  'flex min-h-[34px] items-center rounded-lg px-2.5 text-left text-xs font-semibold transition-colors',
                  preset === p.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50',
                ].join(' ')}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
            <input
              type="date"
              value={draftFrom}
              max={draftTo || undefined}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="input h-8 min-w-0 flex-1 px-2 text-xs"
            />
            <span className="text-xs text-slate-400">—</span>
            <input
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(e) => setDraftTo(e.target.value)}
              className="input h-8 min-w-0 flex-1 px-2 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => { onCustom(draftFrom, draftTo); setOpen(false) }}
            disabled={!draftFrom || !draftTo}
            className="mt-3 h-9 w-full rounded-full bg-indigo-600 text-xs font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Применить
          </button>
        </div>
      )}
    </div>
  )
}

function ProductThumb({ product }) {
  const image = getProductImageVariant(product, 'thumbnail')
  if (image) {
    return (
      <img
        src={image}
        srcSet={getProductImageSrcSet(product)}
        sizes="28px"
        loading="lazy"
        alt=""
        className="h-7 w-7 flex-shrink-0 rounded-md border border-slate-200 object-cover"
      />
    )
  }
  return (
    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-slate-400">
      <Package size={13} />
    </div>
  )
}

function ProductFilter({ products, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const rootRef = useRef(null)
  useClickOutside(rootRef, () => setOpen(false))

  const matches = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return products
    return products.filter((p) => getProductName(p).toLowerCase().includes(query) || getProductSku(p).toLowerCase().includes(query))
  }, [products, q])

  function toggleProduct(id) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  }

  const selectedProducts = useMemo(
    () => products.filter((p) => selected.includes(getId(p))),
    [products, selected],
  )
  const label = selectedProducts.length === 0
    ? 'Товар'
    : selectedProducts.length === 1
      ? getProductName(selectedProducts[0])
      : `Товары · ${selectedProducts.length}`

  return (
    <div className="relative" ref={rootRef}>
      <DropdownTrigger
        icon={<Package size={14} className="opacity-60" />}
        active={selected.length > 0}
        open={open}
        onClick={() => setOpen((o) => !o)}
        onClear={() => onChange([])}
      >
        {label}
      </DropdownTrigger>
      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-[320px] rounded-2xl border border-slate-200 bg-white p-2.5 shadow-2xl">
          <div className="relative mb-2">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск товара…"
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-900 outline-none focus:border-indigo-300 focus:bg-white"
            />
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {matches.map((p) => {
              const id = getId(p)
              const isSelected = selected.includes(id)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleProduct(id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors ${isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                >
                  <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-[1.5px] ${isSelected ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'}`}>
                    {isSelected && <span className="h-1.5 w-1.5 rounded-sm bg-white" />}
                  </span>
                  <ProductThumb product={p} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-slate-900">{getProductName(p)}</span>
                    <span className="block truncate font-mono text-[10.5px] text-slate-400">{getProductSku(p)}</span>
                  </span>
                </button>
              )
            })}
            {matches.length === 0 && <p className="my-3 text-center text-[12px] text-slate-400">Ничего не найдено</p>}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-2 h-8 w-full rounded-lg text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              Сбросить выбор
            </button>
          )}
        </div>
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
