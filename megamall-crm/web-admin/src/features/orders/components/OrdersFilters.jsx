/**
 * OrdersFilters — filter bar for Owner Orders Center.
 *
 * Filters: status, team, seller, search.
 * Search is debounced 400ms. All filter changes call onChange({ ...filters }).
 */
import { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
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

  return (
    <div className="card">
      <div className="flex items-center gap-2 px-6 py-3.5 border-b border-slate-50 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchRaw}
            onChange={e => setSearchRaw(e.target.value)}
            placeholder="Поиск по № заказа, клиенту, телефону…"
            className="w-full rounded-[10px] border-0 bg-slate-50 py-2 pl-8 pr-3 text-[12.5px] font-medium text-slate-700 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        {/* Status */}
        <select
          value={filters.status ?? ''}
          onChange={e => set('status', e.target.value)}
          className="min-h-[38px] rounded-[10px] border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-700 outline-none transition-colors hover:bg-slate-50 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">Статус: Все</option>
          {ALL_STATUSES.map(([key, label]) => (
            <option key={key} value={key}>Статус: {label}</option>
          ))}
        </select>

        {/* Team */}
        {teams.length > 0 && (
          <select
            value={filters.team_id ?? ''}
            onChange={e => set('team_id', e.target.value)}
            className="min-h-[38px] rounded-[10px] border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-700 outline-none transition-colors hover:bg-slate-50 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">Команда: Все</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>Команда: {t.name}</option>
            ))}
          </select>
        )}

        {/* Seller */}
        {sellers.length > 0 && (
          <select
            value={filters.seller_id ?? ''}
            onChange={e => set('seller_id', e.target.value)}
            className="min-h-[38px] rounded-[10px] border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-700 outline-none transition-colors hover:bg-slate-50 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">Продавец: Все</option>
            {sellers.map(u => (
              <option key={u.id} value={u.id}>Продавец: {u.full_name ?? u.FullName ?? u.id}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}
