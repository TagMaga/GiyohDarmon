/**
 * TeamOrdersFilters — lighter filter bar for Team Lead orders.
 * Filters: date range, status, seller (own team only), search (debounced).
 */
import { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { STATUS_LABELS } from '../../../shared/orderStatusConfig'

const ALL_STATUSES = Object.entries(STATUS_LABELS)

function useDebounce(value, delay) {
  const [dv, setDv] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDv(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return dv
}

export default function TeamOrdersFilters({ filters, onChange, sellers = [] }) {
  const [raw, setRaw] = useState(filters.search ?? '')
  const search        = useDebounce(raw, 400)
  const prev          = useRef(filters.search ?? '')

  useEffect(() => {
    if (search !== prev.current) {
      prev.current = search
      onChange({ ...filters, search, page: 1 })
    }
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  function set(key, val) { onChange({ ...filters, [key]: val, page: 1 }) }

  const hasActive = !!(filters.status || filters.seller_id || filters.from || filters.to || (filters.search ?? '').trim())

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text" value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder="Номер заказа, клиент, телефон…"
            className="input pl-8 w-full"
          />
          {raw && (
            <button onClick={() => setRaw('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 min-h-[28px] min-w-[28px] flex items-center justify-center">
              <X size={13} />
            </button>
          )}
        </div>
        <input type="date" value={filters.from ?? ''} onChange={e => set('from', e.target.value)} className="input sm:w-36" />
        <input type="date" value={filters.to   ?? ''} onChange={e => set('to',   e.target.value)} className="input sm:w-36" />
      </div>

      <div className="flex flex-wrap gap-3">
        <select value={filters.status ?? ''} onChange={e => set('status', e.target.value)} className="input flex-1 min-w-[140px]">
          <option value="">Все статусы</option>
          {ALL_STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {sellers.length > 0 && (
          <select value={filters.seller_id ?? ''} onChange={e => set('seller_id', e.target.value)} className="input flex-1 min-w-[140px]">
            <option value="">Все продавцы</option>
            {sellers.map(u => <option key={u.id} value={u.id}>{u.full_name ?? u.FullName ?? u.id}</option>)}
          </select>
        )}

        <select value={filters.limit ?? 25} onChange={e => onChange({ ...filters, limit: Number(e.target.value), page: 1 })} className="input w-24 flex-shrink-0">
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>

        {hasActive && (
          <button onClick={() => { setRaw(''); onChange({ page: 1, limit: filters.limit ?? 25 }) }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors min-h-[44px]">
            <X size={13} /> Сбросить
          </button>
        )}
      </div>
    </div>
  )
}
