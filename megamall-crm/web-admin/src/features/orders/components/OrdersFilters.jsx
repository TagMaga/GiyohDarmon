/**
 * OrdersFilters — filter bar for Owner Orders Center.
 *
 * Filters: date range, status, team, seller, manager, courier, product, search.
 * Search is debounced 400ms. All filter changes call onChange({ ...filters }).
 */
import { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { STATUS_LABELS } from '../../../shared/orderStatusConfig'

const ALL_STATUSES = Object.entries(STATUS_LABELS)

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debouncedValue
}

export default function OrdersFilters({
  filters,
  onChange,
  teams    = [],
  sellers  = [],
  managers = [],
  couriers = [],
  products = [],
}) {
  const [searchRaw, setSearchRaw] = useState(filters.search ?? '')
  const search = useDebounce(searchRaw, 400)

  // Push debounced search upstream
  const prevSearch = useRef(filters.search ?? '')
  useEffect(() => {
    if (search !== prevSearch.current) {
      prevSearch.current = search
      onChange({ ...filters, search, page: 1 })
    }
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  function set(key, value) {
    onChange({ ...filters, [key]: value, page: 1 })
  }

  function clearAll() {
    setSearchRaw('')
    onChange({ page: 1, limit: filters.limit ?? 25 })
  }

  const hasActive = !!(
    filters.status || filters.team_id || filters.seller_id ||
    filters.manager_id || filters.courier_id || filters.no_courier ||
    filters.from || filters.to || (filters.search ?? '').trim()
  )

  return (
    <div className="card p-4 space-y-3">
      {/* Row 1: search + date range */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchRaw}
            onChange={e => setSearchRaw(e.target.value)}
            placeholder="Номер заказа, клиент, телефон…"
            className="input pl-8 w-full"
          />
          {searchRaw && (
            <button
              onClick={() => setSearchRaw('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 min-h-[28px] min-w-[28px] flex items-center justify-center"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Date from */}
        <input
          type="date"
          value={filters.from ?? ''}
          onChange={e => set('from', e.target.value)}
          className="input sm:w-36"
          title="Дата от"
        />

        {/* Date to */}
        <input
          type="date"
          value={filters.to ?? ''}
          onChange={e => set('to', e.target.value)}
          className="input sm:w-36"
          title="Дата до"
        />
      </div>

      {/* Row 2: dropdowns */}
      <div className="flex flex-wrap gap-3">
        {/* Status */}
        <select
          value={filters.status ?? ''}
          onChange={e => set('status', e.target.value)}
          className="input flex-1 min-w-[140px]"
        >
          <option value="">Все статусы</option>
          {ALL_STATUSES.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        {/* Team */}
        {teams.length > 0 && (
          <select
            value={filters.team_id ?? ''}
            onChange={e => set('team_id', e.target.value)}
            className="input flex-1 min-w-[140px]"
          >
            <option value="">Все команды</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}

        {/* Seller */}
        {sellers.length > 0 && (
          <select
            value={filters.seller_id ?? ''}
            onChange={e => set('seller_id', e.target.value)}
            className="input flex-1 min-w-[140px]"
          >
            <option value="">Все продавцы</option>
            {sellers.map(u => (
              <option key={u.id} value={u.id}>{u.full_name ?? u.FullName ?? u.id}</option>
            ))}
          </select>
        )}

        {/* Manager */}
        {managers.length > 0 && (
          <select
            value={filters.manager_id ?? ''}
            onChange={e => set('manager_id', e.target.value)}
            className="input flex-1 min-w-[140px]"
          >
            <option value="">Все менеджеры</option>
            {managers.map(u => (
              <option key={u.id} value={u.id}>{u.full_name ?? u.FullName ?? u.id}</option>
            ))}
          </select>
        )}

        {/* Courier */}
        {couriers.length > 0 && (
          <select
            value={filters.no_courier ? '__none__' : (filters.courier_id ?? '')}
            onChange={e => {
              const value = e.target.value
              if (value === '__none__') {
                onChange({ ...filters, courier_id: '', no_courier: true, page: 1 })
              } else {
                onChange({ ...filters, courier_id: value, no_courier: false, page: 1 })
              }
            }}
            className="input flex-1 min-w-[140px]"
          >
            <option value="">Все курьеры</option>
            <option value="__none__">Без курьера</option>
            {couriers.map(c => (
              <option key={c.courier_id} value={c.courier_id}>{c.full_name ?? c.phone ?? c.courier_id}</option>
            ))}
          </select>
        )}

        {/* Page size */}
        <select
          value={filters.limit ?? 25}
          onChange={e => onChange({ ...filters, limit: Number(e.target.value), page: 1 })}
          className="input w-24 flex-shrink-0"
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>

        {/* Clear */}
        {hasActive && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors min-h-[44px] flex-shrink-0"
          >
            <X size={13} /> Сбросить
          </button>
        )}
      </div>
    </div>
  )
}
