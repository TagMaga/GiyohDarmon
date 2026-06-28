import { useState, useMemo, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '../../../shared/components/PageHeader'
import SellerOrderMobileCard from '../components/SellerOrderMobileCard'
import OrderDetailBottomSheet from '../components/OrderDetailBottomSheet'
import SellerOrderDetailPanel from '../components/SellerOrderDetailPanel'
import Badge from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { SELLER_STATUS_FILTERS, STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { KEYS } from '../../../shared/queryKeys'
import { fetchCities } from '../api'
import useSellerOrders from '../hooks/useSellerOrders'
import { ClipboardList } from 'lucide-react'

export default function SellerOrders() {
  const { orders = [], isLoading } = useSellerOrders()
  const { data: cities = [] } = useQuery({ queryKey: KEYS.seller.cities, queryFn: fetchCities, staleTime: 10 * 60 * 1000 })
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [detailOrder, setDetailOrder] = useState(null)

  const citiesById = useMemo(() => Object.fromEntries(cities.map((c) => [c.id, c.name])), [cities])

  const filtered = useMemo(() => {
    let result = orders
    if (statusFilter !== 'all') result = result.filter((o) => o.status === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((o) =>
        (o.order_number ?? '').toLowerCase().includes(q) ||
        (o.customer?.full_name ?? '').toLowerCase().includes(q) ||
        (o.customer?.phone ?? '').toLowerCase().includes(q)
      )
    }
    return result
  }, [orders, statusFilter, search])

  // Keyboard navigation for desktop list
  const listRef = useRef(null)
  useEffect(() => {
    function handleKey(e) {
      if (!filtered.length) return
      if (e.key === 'Escape') { setDetailOrder(null); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const currentIdx = detailOrder ? filtered.findIndex(o => o.id === detailOrder.id) : -1
      if (e.key === 'ArrowDown') {
        const next = filtered[Math.min(currentIdx + 1, filtered.length - 1)]
        if (next) setDetailOrder(next)
      } else {
        const prev = filtered[Math.max(currentIdx - 1, 0)]
        if (prev) setDetailOrder(prev)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [filtered, detailOrder])

  const filtersSection = (
    <div className="space-y-2.5">
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
        {SELLER_STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
              ${statusFilter === f.key
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по номеру, клиенту, телефону…"
          className="input pl-9 pr-9"
        />
        {search && (
          <button type="button" onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          MOBILE LAYOUT
      ═══════════════════════════════════════════════════════════ */}
      <div className="lg:hidden page-container">
        <PageHeader
          title="Мои заказы"
          subtitle={`Всего: ${orders.length}`}
        />
        <div className="mb-4">{filtersSection}</div>
        <SellerOrderMobileCard
          orders={filtered}
          loading={isLoading}
          showCreate
          citiesById={citiesById}
          onDetail={setDetailOrder}
        />
        <OrderDetailBottomSheet
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          citiesById={citiesById}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════
          DESKTOP MASTER-DETAIL LAYOUT
      ═══════════════════════════════════════════════════════════ */}
      <div
        className="hidden lg:flex overflow-hidden bg-white rounded-b-none"
        style={{
          height: 'calc(100vh - 60px)',
          borderTop: '1px solid rgba(226,232,240,0.7)',
        }}
      >
        {/* ── Left: order list ── */}
        <div
          className="flex flex-col w-[400px] flex-shrink-0 overflow-hidden"
          style={{ borderRight: '1px solid rgba(226,232,240,0.7)' }}
          ref={listRef}
        >
          {/* List header */}
          <div className="px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(226,232,240,0.7)' }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h1 className="text-lg font-bold text-slate-900">Мои заказы</h1>
                <p className="text-xs text-slate-400 mt-0.5">Всего: {orders.length}</p>
              </div>
              <Link to="/seller/orders/create" className="btn btn-primary btn-sm">
                <Plus size={14} />
                Новый
              </Link>
            </div>
            {filtersSection}
          </div>

          {/* List body — scrollable */}
          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="p-3 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            )}

            {!isLoading && filtered.length === 0 && (
              <div className="p-6">
                <EmptyState
                  icon={<ClipboardList size={24} />}
                  title="Нет заказов"
                  description="Заказы появятся здесь после создания."
                />
              </div>
            )}

            {!isLoading && filtered.map((order) => {
              const isSelected = detailOrder?.id === order.id
              return (
                <button
                  key={order.id}
                  onClick={() => setDetailOrder(order)}
                  className={`w-full text-left px-4 py-3 transition-colors hover:bg-slate-50 relative
                    ${isSelected ? 'bg-indigo-50/70' : ''}`}
                  style={{ borderBottom: '1px solid rgba(226,232,240,0.5)' }}
                >
                  {/* Selected indicator */}
                  {isSelected && (
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-indigo-600 rounded-r-full" />
                  )}
                  <div className="flex items-start justify-between gap-2 pl-1">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[10px] font-bold text-slate-400 leading-none">
                        {order.order_number ?? order.id?.slice(0, 8)}
                      </p>
                      <p className="text-sm font-semibold text-slate-900 mt-1 truncate leading-tight">
                        {order.customer?.full_name ?? '—'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {order.city_id && citiesById[order.city_id] && (
                          <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                            {citiesById[order.city_id]}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400">{fmtDate(order.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                      <Badge variant={STATUS_BADGE[order.status] ?? 'slate'} dot>
                        {STATUS_LABELS[order.status] ?? order.status}
                      </Badge>
                      <span className="text-xs font-bold text-slate-800">
                        {fmtAmount(order.total_order_amount ?? order.total_amount)}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Keyboard hint */}
          {filtered.length > 0 && (
            <div className="px-4 py-2.5 flex-shrink-0" style={{ borderTop: '1px solid rgba(226,232,240,0.7)' }}>
              <p className="text-[10px] text-slate-400 text-center">↑ ↓ навигация · Esc закрыть</p>
            </div>
          )}
        </div>

        {/* ── Right: detail panel ── */}
        <div className="flex-1 overflow-hidden">
          <SellerOrderDetailPanel
            order={detailOrder}
            onClose={() => setDetailOrder(null)}
            citiesById={citiesById}
          />
        </div>
      </div>
    </>
  )
}
