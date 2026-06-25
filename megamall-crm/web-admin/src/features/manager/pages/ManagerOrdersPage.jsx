/**
 * ManagerOrdersPage — /manager/orders
 *
 * Seller Orders is the UX source of truth.
 * Desktop: master-detail workspace (list left, SellerOrderDetailPanel right).
 * Mobile:  order cards + OrderDetailBottomSheet.
 *
 * Manager can edit orders in statuses: new / confirmed / assigned.
 * Manager sees own orders + team sellers' orders.
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery }                    from '@tanstack/react-query'
import { Search, X, ClipboardList }    from 'lucide-react'
import PageHeader                      from '../../../shared/components/PageHeader'
import Badge                           from '../../../shared/components/Badge'
import EmptyState                      from '../../../shared/components/EmptyState'
import SellerOrderDetailPanel          from '../../seller/components/SellerOrderDetailPanel'
import OrderDetailBottomSheet          from '../../seller/components/OrderDetailBottomSheet'
import { KEYS }                        from '../../../shared/queryKeys'
import { fetchCities }                 from '../../seller/api'
import { SELLER_STATUS_FILTERS, STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import useManagerOrders                from '../hooks/useManagerOrders'
import useMyManagerTeam                from '../hooks/useMyManagerTeam'
import useTeamMembers                  from '../../people/hooks/useTeamMembers'
import useEmployeesByIds               from '../../people/hooks/useEmployeesByIds'
import { buildUserMap }                from '../../people/utils/peopleHelpers'

function useDebounce(value, delay) {
  const [dv, setDv] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDv(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return dv
}

function toYMD(d) { return d.toISOString().slice(0, 10) }
function currentMonthDefault() {
  const now = new Date()
  return { from: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), to: toYMD(now) }
}

export default function ManagerOrdersPage() {
  const def = currentMonthDefault()

  // Filters state
  const [dateFrom,     setDateFrom]     = useState(def.from)
  const [dateTo,       setDateTo]       = useState(def.to)
  const [statusFilter, setStatusFilter] = useState('all')
  const [sellerId,     setSellerId]     = useState('')
  const [rawSearch,    setRawSearch]    = useState('')
  const [page,         setPage]         = useState(1)
  const [detailOrder,  setDetailOrder]  = useState(null)

  const search = useDebounce(rawSearch, 400)

  // Team data
  const { teamId } = useMyManagerTeam()
  const { data: members = [] } = useTeamMembers(teamId)
  const memberIds = useMemo(() => members.map(m => m.user_id).filter(Boolean), [members])
  const { data: teamEmployees = [] } = useEmployeesByIds(memberIds)
  const userMap = useMemo(() => buildUserMap(teamEmployees), [teamEmployees])
  const sellers = useMemo(() =>
    members.map(m => userMap[m.user_id]).filter(u => u && (u.role ?? u.Role) === 'seller'),
    [members, userMap]
  )

  // Cities
  const { data: cities = [] } = useQuery({ queryKey: KEYS.seller.cities, queryFn: fetchCities, staleTime: 10 * 60_000 })
  const citiesById = useMemo(() => Object.fromEntries(cities.map(c => [c.id, c.name])), [cities])

  // Build hook params — reset page when filters change
  const hookParams = useMemo(() => ({
    from:   dateFrom,
    to:     dateTo,
    page,
    limit:  50,
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(sellerId               ? { seller_id: sellerId } : {}),
    ...(search                 ? { search }              : {}),
  }), [dateFrom, dateTo, page, statusFilter, sellerId, search])

  const { items, meta, isLoading, isError, error } = useManagerOrders(hookParams, memberIds)

  // Reset page when filters change (not page itself)
  const prevFilters = useRef({ dateFrom, dateTo, statusFilter, sellerId, search })
  useEffect(() => {
    const p = prevFilters.current
    if (p.dateFrom !== dateFrom || p.dateTo !== dateTo ||
        p.statusFilter !== statusFilter || p.sellerId !== sellerId || p.search !== search) {
      setPage(1)
      prevFilters.current = { dateFrom, dateTo, statusFilter, sellerId, search }
    }
  }, [dateFrom, dateTo, statusFilter, sellerId, search])

  // Keyboard navigation
  const listRef = useRef(null)
  useEffect(() => {
    function handleKey(e) {
      if (!items.length) return
      if (e.key === 'Escape') { setDetailOrder(null); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const idx = detailOrder ? items.findIndex(o => o.id === detailOrder.id) : -1
      if (e.key === 'ArrowDown') {
        const next = items[Math.min(idx + 1, items.length - 1)]
        if (next) setDetailOrder(next)
      } else {
        const prev = items[Math.max(idx - 1, 0)]
        if (prev) setDetailOrder(prev)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [items, detailOrder])

  // ── Filter section (same visual pattern as SellerOrders) ─────────────────
  const filtersSection = (
    <div className="space-y-2.5">
      {/* Status pills */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
        {SELLER_STATUS_FILTERS.map(f => (
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

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={rawSearch}
          onChange={e => setRawSearch(e.target.value)}
          placeholder="Поиск по номеру, клиенту, телефону…"
          className="input pl-9 pr-9"
        />
        {rawSearch && (
          <button type="button" onClick={() => setRawSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Date range + seller filter */}
      <div className="flex gap-2 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input flex-1 min-w-[120px]" />
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="input flex-1 min-w-[120px]" />
        {sellers.length > 0 && (
          <select value={sellerId} onChange={e => setSellerId(e.target.value)} className="input flex-1 min-w-[140px]">
            <option value="">Все продавцы</option>
            {sellers.map(u => <option key={u.id} value={u.id}>{u.full_name ?? u.id}</option>)}
          </select>
        )}
        {(statusFilter !== 'all' || rawSearch || sellerId) && (
          <button
            type="button"
            onClick={() => { setStatusFilter('all'); setRawSearch(''); setSellerId('') }}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors"
          >
            <X size={12} /> Сбросить
          </button>
        )}
      </div>
    </div>
  )

  // ── Shared list row renderer ──────────────────────────────────────────────
  function ListRow({ order }) {
    const isSelected = detailOrder?.id === order.id
    const status = order.status ?? ''
    const amount = order.total_order_amount ?? order.total_amount ?? 0
    const sellerName = userMap[order.seller_id]?.full_name ?? null
    return (
      <button
        onClick={() => setDetailOrder(order)}
        className={`w-full text-left px-4 py-3 transition-colors hover:bg-slate-50 relative
          ${isSelected ? 'bg-indigo-50/70' : ''}`}
        style={{ borderBottom: '1px solid rgba(226,232,240,0.5)' }}
      >
        {isSelected && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-indigo-600 rounded-r-full" />}
        <div className="flex items-start justify-between gap-2 pl-1">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold text-slate-400 leading-none">
              {order.order_number ?? order.id?.slice(0, 8)}
            </p>
            <p className="text-sm font-semibold text-slate-900 mt-1 truncate leading-tight">
              {order.customer?.full_name ?? order.customer_name ?? '—'}
            </p>
            <div className="flex items-center gap-2 mt-1">
              {sellerName && (
                <span className="text-[10px] text-indigo-500 font-medium truncate max-w-[100px]">{sellerName}</span>
              )}
              <span className="text-[10px] text-slate-400">{fmtDate(order.created_at)}</span>
            </div>
          </div>
          <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
            <Badge variant={STATUS_BADGE[status] ?? 'slate'} dot>
              {STATUS_LABELS[status] ?? status}
            </Badge>
            <span className="text-xs font-bold text-slate-800">{fmtAmount(amount)}</span>
          </div>
        </div>
      </button>
    )
  }

  // ── Mobile card ───────────────────────────────────────────────────────────
  function MobileCard({ order }) {
    const status     = order.status ?? ''
    const amount     = order.total_order_amount ?? order.total_amount ?? 0
    const sellerName = userMap[order.seller_id]?.full_name ?? null
    const phone      = order.customer?.phone ?? order.customer_phone ?? null
    return (
      <div
        className="card p-4 active:scale-[0.99] transition-transform"
        style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 8px 24px rgba(16,24,40,0.06)' }}
      >
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {order.order_number ?? order.id?.slice(0, 8)}
            </p>
            <p className="text-[15px] font-bold text-slate-900 mt-0.5 leading-tight truncate">
              {order.customer?.full_name ?? order.customer_name ?? '—'}
            </p>
            {sellerName && <p className="text-xs text-indigo-500 mt-0.5">{sellerName}</p>}
          </div>
          <Badge variant={STATUS_BADGE[status] ?? 'slate'} dot size="md">
            {STATUS_LABELS[status] ?? status}
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-xs text-slate-400">{fmtDate(order.created_at)}</span>
          <span className="text-sm font-black text-slate-900">{fmtAmount(amount)}</span>
        </div>
        <div className="flex gap-2">
          {phone && (
            <a href={`tel:${phone}`}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-semibold min-h-[40px] active:scale-95 transition-transform">
              Позвонить
            </a>
          )}
          <button onClick={() => setDetailOrder(order)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-semibold min-h-[40px] active:scale-95 transition-transform">
            Детали
          </button>
        </div>
      </div>
    )
  }

  const totalCount = meta?.total ?? items.length
  const totalPages = meta?.total_pages ?? 1

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          MOBILE
      ═══════════════════════════════════════════════════════════ */}
      <div className="lg:hidden page-container">
        <PageHeader title="Заказы команды" subtitle={`Всего: ${totalCount}`} />
        <div className="mb-4">{filtersSection}</div>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        )}
        {!isLoading && items.length === 0 && (
          <div className="card"><EmptyState icon={<ClipboardList size={24} />} title="Нет заказов" description="Заказы вашей команды появятся здесь." /></div>
        )}
        {!isLoading && items.map(o => <MobileCard key={o.id} order={o} />)}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-4">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              ← Назад
            </button>
            <span className="text-xs text-slate-500">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              Вперёд →
            </button>
          </div>
        )}

        <OrderDetailBottomSheet
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          citiesById={citiesById}
          editBasePath="/manager/orders"
          allowEdit={true}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════
          DESKTOP MASTER-DETAIL
      ═══════════════════════════════════════════════════════════ */}
      <div
        className="hidden lg:flex overflow-hidden bg-white rounded-b-none"
        style={{ height: 'calc(100vh - 60px)', borderTop: '1px solid rgba(226,232,240,0.7)' }}
      >
        {/* ── Left: order list ── */}
        <div
          className="flex flex-col w-[400px] flex-shrink-0 overflow-hidden"
          style={{ borderRight: '1px solid rgba(226,232,240,0.7)' }}
          ref={listRef}
        >
          {/* Header */}
          <div className="px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(226,232,240,0.7)' }}>
            <div className="mb-3">
              <h1 className="text-lg font-bold text-slate-900">Заказы команды</h1>
              <p className="text-xs text-slate-400 mt-0.5">Всего: {totalCount}</p>
            </div>
            {filtersSection}
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="p-3 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            )}
            {!isLoading && items.length === 0 && (
              <div className="p-6">
                <EmptyState icon={<ClipboardList size={24} />} title="Нет заказов" description="Заказы вашей команды появятся здесь." />
              </div>
            )}
            {!isLoading && items.map(o => <ListRow key={o.id} order={o} />)}
          </div>

          {/* Pagination + keyboard hint */}
          <div className="px-4 py-2.5 flex-shrink-0 flex items-center justify-between gap-2"
            style={{ borderTop: '1px solid rgba(226,232,240,0.7)' }}>
            {totalPages > 1 ? (
              <>
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-30 min-h-[32px] px-2">
                  ← Назад
                </button>
                <span className="text-[11px] text-slate-400">{page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-30 min-h-[32px] px-2">
                  Вперёд →
                </button>
              </>
            ) : (
              <p className="text-[10px] text-slate-400 text-center w-full">↑ ↓ навигация · Esc закрыть</p>
            )}
          </div>
        </div>

        {/* ── Right: detail panel ── */}
        <div className="flex-1 overflow-hidden">
          <SellerOrderDetailPanel
            order={detailOrder}
            onClose={() => setDetailOrder(null)}
            citiesById={citiesById}
            editBasePath="/manager/orders"
            allowEdit={true}
          />
        </div>
      </div>
    </>
  )
}
