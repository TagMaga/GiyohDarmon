/**
 * TeamLeadOrdersPage — /team-lead/orders
 *
 * Seller Orders is the UX source of truth.
 * Desktop: master-detail workspace (list left, SellerOrderDetailPanel right).
 * Mobile:  order cards + OrderDetailBottomSheet.
 *
 * Team Lead is read-only (no order editing). Can add comments.
 * Shows seller name in list rows and detail panel.
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery }                    from '@tanstack/react-query'
import { Search, X, ClipboardList, SlidersHorizontal } from 'lucide-react'
import Badge                           from '../../../shared/components/Badge'
import EmptyState                      from '../../../shared/components/EmptyState'
import DesktopDateRangePicker          from '../../../shared/components/DesktopDateRangePicker'
import MobileDateRangeCalendar         from '../../../shared/components/MobileDateRangeCalendar'
import SellerOrderDetailPanel          from '../../seller/components/SellerOrderDetailPanel'
import OrderDetailBottomSheet          from '../../seller/components/OrderDetailBottomSheet'
import { KEYS }                        from '../../../shared/queryKeys'
import { fetchCities }                 from '../../seller/api'
import { SELLER_STATUS_FILTERS, STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import useTeamLeadOrders               from '../hooks/useTeamLeadOrders'
import useMyTeam                       from '../hooks/useMyTeam'
import useTeamMembers                  from '../../people/hooks/useTeamMembers'
import useEmployeesByIds               from '../../people/hooks/useEmployeesByIds'
import { buildUserMap }                from '../../people/utils/peopleHelpers'
import { M, InitialsAvatar, StatusPill, Chip } from '../../seller/components/mobileUi'

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

export default function TeamLeadOrdersPage() {
  const def = currentMonthDefault()

  // Filters
  const [dateFrom,     setDateFrom]     = useState(def.from)
  const [dateTo,       setDateTo]       = useState(def.to)
  const [statusFilter, setStatusFilter] = useState('all')
  const [sellerId,     setSellerId]     = useState('')
  const [rawSearch,    setRawSearch]    = useState('')
  const [page,         setPage]         = useState(1)
  const [detailOrder,  setDetailOrder]  = useState(null)
  const [filtersOpen,  setFiltersOpen]  = useState(false)

  const search = useDebounce(rawSearch, 400)

  // Team data
  const { teamId } = useMyTeam()
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

  // Hook params
  const hookParams = useMemo(() => ({
    from:  dateFrom,
    to:    dateTo,
    page,
    limit: 50,
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(sellerId               ? { seller_id: sellerId } : {}),
    ...(search                 ? { search }              : {}),
  }), [dateFrom, dateTo, page, statusFilter, sellerId, search])

  const { items, meta, isLoading } = useTeamLeadOrders(hookParams, memberIds)

  // Reset page on filter change
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

  // ── Filters ───────────────────────────────────────────────────────────────
  // Split so mobile can show search + status chips inline (matching the
  // mockup) while date range / seller stay behind the "advanced filters" sheet.
  const quickFilters = (
    <div className="space-y-2.5">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: M.muted }} />
        <input
          type="text"
          value={rawSearch}
          onChange={e => setRawSearch(e.target.value)}
          placeholder="Поиск по продавцу, клиенту…"
          className="w-full outline-none"
          style={{ border: `1px solid ${M.borderAlt}`, background: '#fff', borderRadius: 13, padding: '11px 14px 11px 40px', fontFamily: 'inherit', fontSize: 13.5, color: M.ink }}
        />
        {rawSearch && (
          <button type="button" onClick={() => setRawSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: M.muted }}>
            <X size={14} />
          </button>
        )}
      </div>

      {/* Status chips */}
      <div className="flex gap-[7px] overflow-x-auto scrollbar-none pb-0.5">
        {SELLER_STATUS_FILTERS.map(f => (
          <Chip key={f.key} active={statusFilter === f.key} onClick={() => setStatusFilter(f.key)}>
            {f.label}
          </Chip>
        ))}
      </div>
    </div>
  )

  const advancedFilters = (
    <div className="flex gap-2 flex-wrap">
      <DesktopDateRangePicker
        from={dateFrom}
        to={dateTo}
        onChange={(range) => { setDateFrom(range.from); setDateTo(range.to) }}
      />
      <MobileDateRangeCalendar
        className="w-full md:hidden"
        from={dateFrom}
        to={dateTo}
        onChange={(range) => { setDateFrom(range.from); setDateTo(range.to) }}
      />
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
  )

  const filtersSection = (
    <div className="space-y-2.5">
      {quickFilters}
      {advancedFilters}
    </div>
  )

  // ── List row ──────────────────────────────────────────────────────────────
  function ListRow({ order }) {
    const isSelected = detailOrder?.id === order.id
    const status     = order.status ?? ''
    const amount     = order.total_order_amount ?? order.total_amount ?? 0
    const sellerName = userMap[order.seller_id]?.full_name ?? order.seller?.full_name ?? null
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
    const sellerName = userMap[order.seller_id]?.full_name ?? order.seller?.full_name ?? null
    const phone      = order.customer?.phone ?? order.customer_phone ?? null
    return (
      <div
        className="active:scale-[0.99] transition-transform"
        style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 16, padding: 15 }}
      >
        {sellerName && (
          <div className="flex items-center gap-[6px] mb-[9px]">
            <InitialsAvatar name={sellerName} size={20} radius={6} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#76766E' }}>{sellerName}</span>
          </div>
        )}
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <p style={{ fontSize: 11, fontWeight: 700, color: M.faint, fontVariantNumeric: 'tabular-nums' }}>
              {order.order_number ?? order.id?.slice(0, 8)}
            </p>
            <p style={{ fontSize: 15, fontWeight: 700, color: M.ink, marginTop: 3 }} className="truncate">
              {order.customer?.full_name ?? order.customer_name ?? '—'}
            </p>
            <p style={{ fontSize: 12, color: M.muted, marginTop: 3 }}>{fmtDate(order.created_at)}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <StatusPill status={status} />
            <div style={{ fontSize: 16, fontWeight: 800, color: M.ink, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(amount)} смн</div>
          </div>
        </div>
        <div className="flex gap-2" style={{ marginTop: 13 }}>
          {phone && (
            <a href={`tel:${phone}`}
              className="flex-1 flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
              style={{ background: M.greenBg, color: M.green, fontSize: 13, fontWeight: 700, padding: 10, borderRadius: 11, minHeight: 40 }}>
              Позвонить
            </a>
          )}
          <button onClick={() => setDetailOrder(order)}
            className="flex-1 flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
            style={{ background: M.indigoBg, color: M.indigoDeep, fontSize: 13, fontWeight: 700, padding: 10, borderRadius: 11, minHeight: 40, border: 'none' }}>
            Детали →
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
      <div className="lg:hidden" style={{ background: M.bg, fontFamily: M.font, minHeight: '100vh', padding: '8px 20px 7.5rem' }}>
        <div className="flex items-baseline gap-[9px]">
          <h1 style={{ fontSize: 24, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Заказы команды</h1>
          <span style={{ fontSize: 14, color: M.muted, fontWeight: 600 }}>{totalCount}</span>
        </div>

        <div style={{ marginTop: 14 }} className="space-y-3">
          {quickFilters}
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="w-full min-h-[40px] flex items-center justify-between active:scale-[0.99] transition-transform"
            style={{ background: '#fff', border: `1px solid ${M.borderAlt}`, borderRadius: 12, padding: '9px 14px', fontSize: 13, fontWeight: 700, color: M.ink }}
          >
            <span>Период и продавец</span>
            <SlidersHorizontal size={15} style={{ color: M.muted }} />
          </button>
        </div>

        {filtersOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close filters"
              onClick={() => setFiltersOpen(false)}
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
            />
            <div className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-white p-4 pb-[calc(env(safe-area-inset-bottom,0px)+18px)] shadow-[0_-24px_60px_rgba(15,23,42,0.18)]">
              <div className="mx-auto mb-4 h-1 w-11 rounded-full bg-slate-200" />
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-base font-black text-slate-950">Период и продавец</p>
                  <p className="text-xs text-slate-400">Диапазон дат и конкретный продавец</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"
                >
                  <X size={18} />
                </button>
              </div>
              {advancedFilters}
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="mt-4 w-full min-h-[46px] rounded-2xl bg-slate-950 text-white text-sm font-black"
              >
                Применить
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 14 }} className="space-y-2.5">

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
        </div>

        <OrderDetailBottomSheet
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          citiesById={citiesById}
          editBasePath="/team-lead/orders"
          allowEdit={false}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════
          DESKTOP MASTER-DETAIL
      ═══════════════════════════════════════════════════════════ */}
      <div
        className="hidden lg:flex overflow-hidden bg-white rounded-b-none"
        style={{ height: '100vh' }}
      >
        {/* ── Left: order list ── */}
        <div
          className="flex flex-col w-[400px] flex-shrink-0 overflow-hidden"
          style={{ borderRight: '1px solid rgba(226,232,240,0.7)' }}
          ref={listRef}
        >
          <div className="px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(226,232,240,0.7)' }}>
            <div className="mb-3">
              <h1 className="text-lg font-bold text-slate-900">Заказы команды</h1>
              <p className="text-xs text-slate-400 mt-0.5">Всего: {totalCount}</p>
            </div>
            {filtersSection}
          </div>

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

        {/* ── Right: detail panel (read-only for TL) ── */}
        <div className="flex-1 overflow-hidden">
          <SellerOrderDetailPanel
            order={detailOrder}
            onClose={() => setDetailOrder(null)}
            citiesById={citiesById}
            editBasePath="/team-lead/orders"
            allowEdit={false}
          />
        </div>
      </div>
    </>
  )
}
