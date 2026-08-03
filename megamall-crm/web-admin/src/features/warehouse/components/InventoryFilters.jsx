import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { appToday } from '../../../shared/utils/date'

export const MAIN_WAREHOUSE_ID = '00000000-0000-0000-0000-000000000001'

export const STATUS_FILTER_OPTIONS = [
  { value: 'in_stock', label: 'В наличии' },
  { value: 'low_stock', label: 'Мало' },
  { value: 'out_of_stock', label: 'Нет в наличии' },
  { value: 'reserved', label: 'Есть в резерве' },
  { value: 'courier', label: 'У курьеров' },
  { value: 'in_transfer', label: 'В передаче' },
]

export const EXPIRY_FILTER_OPTIONS = [
  { value: 'expired', label: 'Просрочено' },
  { value: 'today', label: 'Истекает сегодня' },
  { value: 'days_7', label: 'Осталось 1–7 дней' },
  { value: 'days_14', label: 'Осталось 8–14 дней' },
  { value: 'days_30', label: 'Осталось 15–30 дней' },
  { value: 'unknown', label: 'Срок не указан' },
]

export function MultiSelectFilter({ label, options, value, onChange, searchable = false }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', closeOnOutsideClick)
      document.addEventListener('keydown', closeOnEscape)
    }
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const visibleOptions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return options
      .filter((option) => option.value)
      .filter((option) => !q ||
        option.label.toLowerCase().includes(q) ||
        option.description?.toLowerCase().includes(q))
  }, [options, query])

  function toggle(optionValue) {
    onChange(value.includes(optionValue)
      ? value.filter((item) => item !== optionValue)
      : [...value, optionValue])
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className={`flex min-h-[40px] min-w-[150px] items-center justify-between gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors ${
          value.length
            ? 'border-indigo-200 bg-indigo-50 text-indigo-800'
            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="flex items-center gap-1.5">
          {value.length > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">
              {value.length}
            </span>
          )}
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="fixed inset-x-3 top-1/2 z-[100] max-h-[70vh] -translate-y-1/2 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[320px] sm:translate-y-0">
          {searchable && (
            <label className="mb-2 flex min-h-[36px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5">
              <Search size={14} className="text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Найти: ${label.toLowerCase()}…`}
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
              />
            </label>
          )}
          <div className="max-h-64 overflow-y-auto">
            {visibleOptions.length === 0 ? (
              <p className="px-2 py-5 text-center text-xs text-slate-400">Ничего не найдено</p>
            ) : visibleOptions.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={value.includes(option.value)}
                  onChange={() => toggle(option.value)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-700">{option.label}</span>
                  {option.description && <span className="block truncate text-[11px] text-slate-400">{option.description}</span>}
                </span>
              </label>
            ))}
          </div>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-2 w-full border-t border-slate-100 px-2 pt-2 text-left text-xs font-semibold text-rose-600"
            >
              Очистить выбор
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function InventoryFilterBar({
  search,
  onSearch,
  productOptions,
  locationOptions,
  selectedProducts,
  onProducts,
  selectedWarehouses,
  onWarehouses,
  selectedStatuses,
  onStatuses,
  selectedExpiry,
  onExpiry,
  resultCount,
  className = '',
}) {
  const activeFilterCount =
    selectedProducts.length + selectedWarehouses.length + selectedStatuses.length + selectedExpiry.length

  function reset() {
    onProducts([])
    onWarehouses([])
    onStatuses([])
    onExpiry([])
    onSearch('')
  }

  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)] ${className}`}>
      <div className="flex flex-wrap gap-2">
        <label className="flex min-h-[40px] min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
          <Search size={17} className="text-slate-400" />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Поиск по товару, SKU или штрихкоду…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </label>
        <MultiSelectFilter label="Товары" options={productOptions} value={selectedProducts} onChange={onProducts} searchable />
        <MultiSelectFilter label="Склады" options={locationOptions} value={selectedWarehouses} onChange={onWarehouses} searchable />
        <MultiSelectFilter label="Статус" options={STATUS_FILTER_OPTIONS} value={selectedStatuses} onChange={onStatuses} />
        <MultiSelectFilter label="Срок годности" options={EXPIRY_FILTER_OPTIONS} value={selectedExpiry} onChange={onExpiry} />
        {(activeFilterCount > 0 || search) && (
          <button
            type="button"
            onClick={reset}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X size={15} /> Сбросить
          </button>
        )}
      </div>
      {activeFilterCount > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
          <SlidersHorizontal size={13} />
          Активных фильтров: {activeFilterCount}. Найдено товаров: {resultCount}.
        </p>
      )}
    </section>
  )
}

export function aggregateStocks(stocks = []) {
  return stocks.reduce((totals, stock) => {
    const quantity = stock.quantity ?? 0
    const reserved = stock.reserved_quantity ?? 0
    const blocked = stock.blocked_quantity ?? 0
    const available = stock.available_quantity ?? Math.max(0, quantity - reserved - blocked)
    const isMain = stock.location?.type === 'main'
    totals.quantity += quantity
    totals.reserved += reserved
    totals.blocked += blocked
    totals.available += available
    if (isMain) {
      totals.mainQuantity += quantity
      totals.mainReserved += reserved
      totals.mainBlocked += blocked
    } else {
      totals.courierQuantity += quantity
      totals.courierReserved += reserved
    }
    return totals
  }, {
    quantity: 0,
    reserved: 0,
    blocked: 0,
    available: 0,
    mainQuantity: 0,
    mainReserved: 0,
    mainBlocked: 0,
    courierQuantity: 0,
    courierReserved: 0,
  })
}

export function getDerivedStockStatus(metrics, inv) {
  if (metrics.quantity <= 0) return 'out_of_stock'
  const lowThreshold = inv?.low_stock_threshold ?? inv?.LowStockThreshold ?? 0
  if (metrics.available <= lowThreshold) return 'low_stock'
  return 'in_stock'
}

export function getExpiryBucket(expiryDate) {
  if (!expiryDate) return 'unknown'
  const [year, month, day] = String(expiryDate).split('-').map(Number)
  if (!year || !month || !day) return 'unknown'
  // expiry_date is a bare calendar date, so "today" must be the Dushanbe
  // calendar day — the browser's would bucket a batch as expiring a day early
  // or late for part of every day.
  const now = appToday()
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const expiryUtc = Date.UTC(year, month - 1, day)
  const days = Math.round((expiryUtc - todayUtc) / 86_400_000)
  if (days < 0) return 'expired'
  if (days === 0) return 'today'
  if (days <= 7) return 'days_7'
  if (days <= 14) return 'days_14'
  if (days <= 30) return 'days_30'
  return 'later'
}

export function getLocationDisplayName(location) {
  if (location?.type === 'main') return location.name || 'Главный склад'
  const name = location?.name?.replace(/^Склад курьера:\s*/i, '') || 'Без имени'
  return `Курьер ${name}`
}

export function DistributionText({ stocks = [], compact = false }) {
  const entries = stocks
    .filter((stock) => (stock.quantity ?? 0) > 0)
    .map((stock) => ({
      id: stock.warehouse_id,
      label: stock.location?.type === 'main'
        ? 'Главный'
        : getLocationDisplayName(stock.location),
      quantity: stock.quantity ?? 0,
    }))
    .sort((a, b) => {
      if (a.id === MAIN_WAREHOUSE_ID) return -1
      if (b.id === MAIN_WAREHOUSE_ID) return 1
      return b.quantity - a.quantity
    })

  if (!entries.length) return <span className="text-xs text-slate-400">Остатков нет</span>

  const fullText = entries.map((entry) => `${entry.label} — ${entry.quantity}`).join(' · ')
  const visible = entries.slice(0, compact ? 2 : 3)
  return (
    <p className="max-w-[360px] text-xs leading-5 text-slate-600" title={fullText}>
      {visible.map((entry, index) => (
        <span key={entry.id}>
          {index > 0 && <span className="text-slate-300"> · </span>}
          <span className="font-medium">{entry.label}</span>
          {' — '}
          <span className="font-bold tabular-nums text-slate-800">{entry.quantity}</span>
        </span>
      ))}
      {entries.length > visible.length && (
        <span className="ml-1 font-semibold text-indigo-600">+{entries.length - visible.length}</span>
      )}
    </p>
  )
}
