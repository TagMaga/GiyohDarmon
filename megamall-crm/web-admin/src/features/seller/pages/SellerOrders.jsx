import { useState, useMemo, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Plus, Search, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import SellerOrderMobileCard from '../components/SellerOrderMobileCard'
import { M, MobileShell, Chip, StatusPill } from '../components/mobileUi'
import OrderDetailBottomSheet from '../components/OrderDetailBottomSheet'
import SellerOrderDetailPanel from '../components/SellerOrderDetailPanel'
import EmptyState from '../../../shared/components/EmptyState'
import { SELLER_STATUS_FILTERS, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { KEYS } from '../../../shared/queryKeys'
import { fetchCities } from '../api'
import useSellerOrders from '../hooks/useSellerOrders'
import { ClipboardList } from 'lucide-react'

export default function SellerOrders() {
  const location = useLocation()
  const { orders = [], isLoading } = useSellerOrders()
  const { data: cities = [] } = useQuery({ queryKey: KEYS.seller.cities, queryFn: fetchCities, staleTime: 10 * 60 * 1000 })
  const [statusFilter, setStatusFilter] = useState(location.state?.statusFilter ?? 'all')
  const [search, setSearch] = useState('')
  const [detailOrder, setDetailOrder] = useState(null)

  const citiesById = useMemo(() => Object.fromEntries(cities.map((c) => [c.id, c.name])), [cities])

  const statusCounts = useMemo(() => {
    const counts = {}
    for (const o of orders) counts[o.status] = (counts[o.status] ?? 0) + 1
    return counts
  }, [orders])

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
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: M.muted }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по номеру, клиенту, телефону…"
          className="w-full outline-none"
          style={{ border: `1px solid ${M.borderAlt}`, background: '#fff', borderRadius: 12, padding: '9px 32px 9px 32px', fontFamily: 'inherit', fontSize: 13, color: M.ink }}
        />
        {search && (
          <button type="button" onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: M.muted }}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
        {SELLER_STATUS_FILTERS.map((f) => (
          <Chip key={f.key} active={statusFilter === f.key} onClick={() => setStatusFilter(f.key)} style={{ padding: '6px 12px', fontSize: 12 }}>
            {f.label}
          </Chip>
        ))}
      </div>
    </div>
  )

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          MOBILE LAYOUT — Seller Panel Redesign
      ═══════════════════════════════════════════════════════════ */}
      <MobileShell>
        <div className="px-5">
          {/* Header */}
          <div className="flex items-baseline gap-[9px]" style={{ padding: '8px 0 0' }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Мои заказы</h1>
            <span style={{ fontSize: 14, color: M.muted, fontWeight: 600 }}>{orders.length}</span>
          </div>

          {/* Search */}
          <div className="relative" style={{ marginTop: 14 }}>
            <Search size={17} className="absolute left-[14px] top-1/2 -translate-y-1/2" style={{ color: M.muted }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по клиенту, номеру…"
              className="w-full outline-none"
              style={{
                border: `1px solid ${M.borderAlt}`, background: '#fff', borderRadius: 13,
                padding: '11px 40px 11px 40px', fontFamily: 'inherit', fontSize: 13.5, color: M.ink,
              }}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: M.muted }}>
                <X size={15} />
              </button>
            )}
          </div>

          {/* Filter chips */}
          <div className="flex gap-[7px] overflow-x-auto scrollbar-none" style={{ marginTop: 12, paddingBottom: 2 }}>
            {SELLER_STATUS_FILTERS.map((f) => {
              const count = f.key === 'all' ? orders.length : statusCounts[f.key] ?? 0
              return (
                <Chip key={f.key} active={statusFilter === f.key} onClick={() => setStatusFilter(f.key)}>
                  {f.label}{count > 0 ? ` ${count}` : ''}
                </Chip>
              )
            })}
          </div>

          {/* List */}
          <div style={{ marginTop: 14 }}>
            <SellerOrderMobileCard
              orders={filtered}
              loading={isLoading}
              showCreate
              citiesById={citiesById}
              onDetail={setDetailOrder}
            />
          </div>
        </div>
        <OrderDetailBottomSheet
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          citiesById={citiesById}
        />
      </MobileShell>

      {/* ═══════════════════════════════════════════════════════════
          DESKTOP MASTER-DETAIL LAYOUT — Seller Panel Redesign
      ═══════════════════════════════════════════════════════════ */}
      <div
        className="hidden lg:flex overflow-hidden"
        style={{ height: '100vh', background: M.bg, fontFamily: M.font }}
      >
        {/* ── Left: order list ── */}
        <div
          className="flex flex-col w-[400px] flex-shrink-0 overflow-hidden"
          style={{ borderRight: `1px solid ${M.border}` }}
          ref={listRef}
        >
          {/* List header */}
          <div className="flex-shrink-0" style={{ padding: '28px 24px 18px' }}>
            <div className="flex items-baseline justify-between mb-4">
              <div className="flex items-baseline gap-2">
                <h1 style={{ fontSize: 22, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Мои заказы</h1>
                <span style={{ fontSize: 13, color: M.muted, fontWeight: 600 }}>{orders.length}</span>
              </div>
              <Link
                to="/seller/orders/create"
                className="flex items-center gap-1.5 transition-transform active:scale-[0.97]"
                style={{ background: M.indigo, color: '#fff', fontSize: 12.5, fontWeight: 700, padding: '7px 12px', borderRadius: 10 }}
              >
                <Plus size={13} />
                Новый
              </Link>
            </div>
            {filtersSection}
          </div>

          {/* List body — scrollable */}
          <div className="flex-1 overflow-y-auto" style={{ padding: '0 12px' }}>
            {isLoading && (
              <div className="space-y-2 p-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: M.border }} />
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
                  className="w-full text-left transition-colors relative"
                  style={{
                    padding: '13px 12px', borderRadius: 14, marginBottom: 4,
                    background: isSelected ? '#F5F4FE' : 'transparent',
                  }}
                >
                  {/* Selected indicator */}
                  {isSelected && (
                    <div className="absolute rounded-r-full" style={{ left: 0, top: 8, bottom: 8, width: 3, background: M.indigo }} />
                  )}
                  <div className="flex items-start justify-between gap-2 pl-1">
                    <div className="min-w-0 flex-1">
                      <p style={{ fontSize: 11, fontWeight: 700, color: M.faint, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                        {order.order_number ?? order.id?.slice(0, 8)}
                      </p>
                      <p className="truncate" style={{ fontSize: 14, fontWeight: 700, color: M.ink, marginTop: 4 }}>
                        {order.customer?.full_name ?? '—'}
                      </p>
                      <div className="flex items-center gap-2" style={{ marginTop: 5 }}>
                        {order.city_id && citiesById[order.city_id] && (
                          <span style={{ fontSize: 10.5, color: '#76766E', fontWeight: 600, background: '#F0EFEA', padding: '2px 7px', borderRadius: 6 }}>
                            {citiesById[order.city_id]}
                          </span>
                        )}
                        <span style={{ fontSize: 10.5, color: M.muted }}>{fmtDate(order.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                      <StatusPill status={order.status} />
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: M.ink }}>
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
            <div className="flex-shrink-0" style={{ padding: '10px 12px', borderTop: `1px solid ${M.border}` }}>
              <p className="text-center" style={{ fontSize: 10.5, color: M.faint }}>↑ ↓ навигация · Esc закрыть</p>
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
