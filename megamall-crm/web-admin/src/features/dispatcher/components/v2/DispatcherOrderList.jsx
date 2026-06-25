import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import DispatcherOrderCard from './DispatcherOrderCard'
import EmptyState from '../../../../shared/components/EmptyState'
import Skeleton from '../../../../shared/components/Skeleton'
import { getOrderId, formatOrderLabel, getCourierId } from '../../utils/orderHelpers'
import { resolveCustomer } from '../../utils/resolveCustomer'

const FILTERS = [
  { key: 'all',         label: 'Все' },
  { key: 'new',         label: 'Новые' },
  { key: 'confirmed',   label: 'Подтвержд.' },
  { key: 'assigned',    label: 'Назначен' },
  { key: 'in_delivery', label: 'В пути' },
  { key: 'issue',       label: 'Проблемы' },
  { key: 'delivered',   label: 'Доставлено' },
]

export default function DispatcherOrderList({
  orders, courierMap, counts, isLoading,
  selectedId, onSelect, onAction,
  filter = 'all', onFilterChange,
  courierFilter = null,
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    let list = orders

    // Courier filter takes precedence — overrides status pill
    if (courierFilter === 'unassigned') {
      list = list.filter(o => o.status === 'confirmed' && !getCourierId(o))
    } else if (courierFilter) {
      list = list.filter(o => String(getCourierId(o)) === String(courierFilter))
    } else if (filter !== 'all') {
      list = list.filter(o => o.status === filter)
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(o => {
        const c = resolveCustomer(o, {})
        return (
          formatOrderLabel(o).toLowerCase().includes(q) ||
          (c.full_name ?? '').toLowerCase().includes(q) ||
          (c.phone ?? '').includes(q)
        )
      })
    }
    return list
  }, [orders, filter, courierFilter, search])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search */}
      <div className="px-4 pt-2 pb-1.5 flex-shrink-0">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по заказу, клиенту…"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
          />
        </div>
      </div>

      {/* Status filter pills — hidden when courier filter is active */}
      {!courierFilter && (
        <div className="flex gap-1.5 px-4 pb-2 overflow-x-auto flex-shrink-0 scrollbar-hide">
          {FILTERS.map(f => {
            const count = f.key === 'all' ? counts.all : (counts[f.key] ?? 0)
            return (
              <button
                key={f.key}
                onClick={() => onFilterChange?.(f.key)}
                className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full transition-colors ${
                  filter === f.key
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {f.label}
                {count > 0 && (
                  <span className={`ml-1 font-normal ${filter === f.key ? 'text-indigo-200' : 'text-slate-400'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Courier filter active label */}
      {courierFilter && (
        <div className="px-4 pb-2 flex-shrink-0">
          <div className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 rounded-lg px-3 py-1.5">
            {courierFilter === 'unassigned' ? 'Без курьера' : 'Фильтр по курьеру'}
          </div>
        </div>
      )}

      {/* Order list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16">
            <EmptyState
              title="Заказов нет"
              subtitle={search ? 'Попробуйте другой поиск' : 'Заказы появятся здесь'}
            />
          </div>
        ) : (
          filtered.map(order => (
            <DispatcherOrderCard
              key={getOrderId(order) ?? Math.random()}
              order={order}
              courierMap={courierMap}
              selected={selectedId === getOrderId(order)}
              onSelect={onSelect}
              onAction={onAction}
            />
          ))
        )}
      </div>
    </div>
  )
}
