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
import { Search, X, ClipboardList, ChevronDown } from 'lucide-react'
import Badge                           from '../../../shared/components/Badge'
import EmptyState                      from '../../../shared/components/EmptyState'
import PeriodRangeFilter               from '../../../shared/components/PeriodRangeFilter'
import DateRangeBottomSheet            from '../../../shared/components/DateRangeBottomSheet'
import BottomSheet                     from '../../../shared/components/BottomSheet'
import SellerOrderDetailPanel          from '../../seller/components/SellerOrderDetailPanel'
import OrderDetailBottomSheet          from '../../seller/components/OrderDetailBottomSheet'
import { KEYS }                        from '../../../shared/queryKeys'
import { fetchCities }                 from '../../seller/api'
import { SELLER_STATUS_FILTERS, STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import useTeamLeadOrders               from '../hooks/useTeamLeadOrders'
import useTeamOrderTotals              from '../hooks/useTeamOrderTotals'
import useMyTeam                       from '../hooks/useMyTeam'
import useTeamMembers                  from '../../people/hooks/useTeamMembers'
import useEmployeesByIds               from '../../people/hooks/useEmployeesByIds'
import { buildUserMap }                from '../../people/utils/peopleHelpers'
import { M, InitialsAvatar, StatusPill, Chip, PILL_COLORS } from '../../seller/components/mobileUi'
import { toLocalYMD, appToday } from '../../../shared/utils/date'

// ── Mobile filter-chip row (Период | Статус | Пользователь) ────────────────
// Same visual language as FinanceFilterBar's chips: h-9 rounded-full pill,
// filled indigo when active (with an inline ✕ to clear), slate-100 outline
// otherwise (with a chevron-down to hint "opens a sheet").
const MOBILE_CHIP_BASE =
  'inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold transition-colors'
const MOBILE_CHIP_OFF = `${MOBILE_CHIP_BASE} bg-slate-100 text-slate-600 hover:bg-slate-200`
const MOBILE_CHIP_ON  = `${MOBILE_CHIP_BASE} bg-indigo-600 text-white hover:bg-indigo-700`

function MobileFilterChip({ active, onClick, onClear, children }) {
  return (
    <button type="button" onClick={onClick} className={active ? MOBILE_CHIP_ON : MOBILE_CHIP_OFF}>
      {active && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Сбросить"
          onClick={(e) => { e.stopPropagation(); onClear() }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onClear() } }}
          className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full hover:bg-white/20"
        >
          <X size={11} />
        </span>
      )}
      {children}
      {!active && <ChevronDown size={13} className="opacity-50" />}
    </button>
  )
}

// ── Period label helpers (mirrors FinanceFilterBar's "Август"/"Сегодня"/… chip text) ──
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1) }
function addDays(date, days) { const n = new Date(date); n.setDate(n.getDate() + days); return n }
function formatDMY(value) {
  if (!value) return ''
  const [y, m, d] = value.split('-')
  return `${d}.${m}.${y}`
}
function formatMonthName(value) {
  const [y, m, d] = value.split('-').map(Number)
  const s = new Date(y, m - 1, d).toLocaleDateString('ru-RU', { month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const CHIP_DATE_PRESETS = [
  { label: 'Сегодня', get: () => { const t = toLocalYMD(appToday()); return { from: t, to: t } } },
  { label: 'Вчера', get: () => { const y = toLocalYMD(addDays(appToday(), -1)); return { from: y, to: y } } },
  { label: '7 дней', get: () => ({ from: toLocalYMD(addDays(appToday(), -6)), to: toLocalYMD(appToday()) }) },
  { label: '30 дней', get: () => ({ from: toLocalYMD(addDays(appToday(), -29)), to: toLocalYMD(appToday()) }) },
]

function useDebounce(value, delay) {
  const [dv, setDv] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDv(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return dv
}

function currentMonthDefault() {
  const now = appToday()
  return { from: toLocalYMD(startOfMonth(now)), to: toLocalYMD(now) }
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
  const [mobileSheet,  setMobileSheet]  = useState(null) // null | 'date' | 'status' | 'user'

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

  // Status-agnostic totals for the mobile totals card + breakdown strip —
  // needs the full date+seller+search scope regardless of statusFilter, so
  // it's a separate fetch/hook from the paginated `items` above.
  const totalsParams = useMemo(() => ({
    from: dateFrom, to: dateTo,
    ...(sellerId ? { sellerId } : {}),
    ...(search   ? { search }   : {}),
  }), [dateFrom, dateTo, sellerId, search])
  const { scoped: scopedOrders, byStatus, total: totalAll, isLoading: totalsLoading } = useTeamOrderTotals(totalsParams)

  // ── Mobile chip labels / totals card derived state ─────────────────────────
  const thisMonthRange = useMemo(() => {
    const now = appToday()
    return { from: toLocalYMD(startOfMonth(now)), to: toLocalYMD(now) }
  }, [])
  const isThisMonth = dateFrom === thisMonthRange.from && dateTo === thisMonthRange.to
  const periodActive = !isThisMonth
  const periodLabel = useMemo(() => {
    if (isThisMonth) return formatMonthName(dateFrom)
    const matched = CHIP_DATE_PRESETS.find(p => { const r = p.get(); return r.from === dateFrom && r.to === dateTo })
    if (matched) return matched.label
    return `${formatDMY(dateFrom)} — ${formatDMY(dateTo)}`
  }, [dateFrom, dateTo, isThisMonth])

  const statusActive = statusFilter !== 'all'
  const statusLabel = statusActive
    ? (SELLER_STATUS_FILTERS.find(f => f.key === statusFilter)?.label ?? statusFilter)
    : 'Все статусы'

  const sellerActive = !!sellerId
  const sellerName = userMap[sellerId]?.full_name ?? ''
  const userChipLabel = sellerActive ? sellerName : 'Пользователь'

  const currentTotals = statusFilter === 'all' ? totalAll : (byStatus[statusFilter] ?? { count: 0, amount: 0 })
  const totalsCaption = `${statusLabel} · ${periodLabel}${sellerActive && sellerName ? ' · ' + sellerName : ''}`

  const breakdownTiles = useMemo(() => {
    const tiles = [{
      key: 'all', label: 'Все',
      count: totalAll.count, amount: totalAll.amount,
      dot: M.indigo,
    }]
    Object.keys(STATUS_LABELS).forEach(key => {
      const row = byStatus[key]
      const count = row?.count ?? 0
      if (count === 0 && statusFilter !== key) return
      tiles.push({
        key, label: STATUS_LABELS[key],
        count, amount: row?.amount ?? 0,
        dot: PILL_COLORS[STATUS_BADGE[key]]?.dot ?? PILL_COLORS.slate.dot,
      })
    })
    return tiles
  }, [byStatus, totalAll, statusFilter])

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

  // ── Desktop filters ──────────────────────────────────────────────────────
  // Mobile has its own chip row + bottom sheets below (Период | Статус |
  // Пользователь); these two blocks back only the desktop master-detail
  // header now.
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
      <PeriodRangeFilter
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
            <div style={{ fontSize: 16, fontWeight: 800, color: M.ink, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(amount)} с</div>
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

  const mobileList = useMemo(() => {
    const list = statusFilter === 'all' ? scopedOrders : scopedOrders.filter(o => o.status === statusFilter)
    return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [scopedOrders, statusFilter])

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          MOBILE
      ═══════════════════════════════════════════════════════════ */}
      <div className="lg:hidden" style={{ background: M.bg, fontFamily: M.font, minHeight: '100vh', padding: '8px 20px 7.5rem' }}>
        <div className="flex items-baseline gap-[9px]">
          <h1 style={{ fontSize: 24, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Заказы команды</h1>
          <span style={{ fontSize: 14, color: M.muted, fontWeight: 600 }}>{mobileList.length}</span>
        </div>

        <div style={{ marginTop: 14 }} className="space-y-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: M.muted }} />
            <input
              type="text"
              value={rawSearch}
              onChange={e => setRawSearch(e.target.value)}
              placeholder="Номер заказа, комментарий…"
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

          <div className="scrollbar-none -mx-5 flex flex-nowrap items-center gap-2 overflow-x-auto px-5 py-[5px]">
            <MobileFilterChip active={periodActive} onClick={() => setMobileSheet('date')} onClear={() => { setDateFrom(thisMonthRange.from); setDateTo(thisMonthRange.to) }}>
              {periodLabel}
            </MobileFilterChip>
            <MobileFilterChip active={statusActive} onClick={() => setMobileSheet('status')} onClear={() => setStatusFilter('all')}>
              {statusActive ? statusLabel : 'Статус'}
            </MobileFilterChip>
            <MobileFilterChip active={sellerActive} onClick={() => setMobileSheet('user')} onClear={() => setSellerId('')}>
              {userChipLabel}
            </MobileFilterChip>
          </div>
        </div>

        {/* Totals card */}
        <div style={{ marginTop: 14, background: M.dark, borderRadius: 24, padding: '20px 20px 16px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -34, top: -34, width: 140, height: 140, borderRadius: '50%', background: 'rgba(99,102,241,.16)' }} />
          <div style={{ position: 'relative' }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: M.darkMuted, letterSpacing: '.04em', textTransform: 'uppercase' }}>Сумма по фильтру</div>
                <div className="flex items-baseline gap-1.5" style={{ marginTop: 7 }}>
                  <span style={{ fontSize: 34, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(currentTotals.amount)}</span>
                  <span style={{ fontSize: 17, fontWeight: 700, color: M.darkSub }}>с</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div style={{ fontSize: 19, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{currentTotals.count}</div>
                <div style={{ fontSize: 11, color: M.darkMuted, fontWeight: 600 }}>заказов</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: M.darkSub, fontWeight: 600, marginTop: 6 }}>{totalsCaption}</div>

            <div className="scrollbar-none flex gap-2 overflow-x-auto" style={{ margin: '15px -20px -2px', padding: '0 20px 4px' }}>
              {breakdownTiles.map(tile => {
                const active = statusFilter === tile.key
                return (
                  <button
                    key={tile.key}
                    type="button"
                    onClick={() => setStatusFilter(tile.key)}
                    className="flex-shrink-0 text-left"
                    style={{
                      padding: '9px 12px', borderRadius: 13, minWidth: 104,
                      background: active ? 'rgba(99,102,241,.18)' : 'rgba(255,255,255,.05)',
                      border: `1px solid ${active ? 'rgba(129,140,248,.55)' : 'rgba(255,255,255,.08)'}`,
                    }}
                  >
                    <span className="flex items-center gap-[5px]">
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: tile.dot }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: active ? '#C7D2FE' : M.darkSub }}>{tile.label}</span>
                    </span>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: tile.count ? '#fff' : '#5B5B72', marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(tile.amount)}</span>
                    <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: M.darkMuted, marginTop: 1 }}>{tile.count} шт.</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <DateRangeBottomSheet
          open={mobileSheet === 'date'}
          onClose={() => setMobileSheet(null)}
          from={dateFrom}
          to={dateTo}
          onChange={(range) => { setDateFrom(range.from || thisMonthRange.from); setDateTo(range.to || range.from || thisMonthRange.to) }}
        />

        <BottomSheet open={mobileSheet === 'status'} onClose={() => setMobileSheet(null)} title="Статус" >
          <div className="flex flex-wrap gap-[7px] py-1">
            {SELLER_STATUS_FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => { setStatusFilter(f.key); setMobileSheet(null) }}
                className="rounded-full px-3.5 py-2 text-[12.5px] font-bold"
                style={{
                  color: statusFilter === f.key ? '#fff' : '#76766E',
                  background: statusFilter === f.key ? M.dark : '#fff',
                  border: `1px solid ${statusFilter === f.key ? 'transparent' : M.borderAlt}`,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </BottomSheet>

        <BottomSheet open={mobileSheet === 'user'} onClose={() => setMobileSheet(null)} title="Пользователь">
          <div className="flex flex-col gap-[7px] py-1">
            <button
              type="button"
              onClick={() => { setSellerId(''); setMobileSheet(null) }}
              className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left"
              style={{ background: !sellerId ? '#F4F3FF' : '#fff', border: `1px solid ${!sellerId ? '#C7D2FE' : M.border}` }}
            >
              <InitialsAvatar name="Все продавцы" size={26} radius={8} />
              <span style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>Все продавцы</span>
            </button>
            {sellers.map((u, i) => (
              <button
                key={u.id}
                type="button"
                onClick={() => { setSellerId(u.id); setMobileSheet(null) }}
                className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left"
                style={{ background: sellerId === u.id ? '#F4F3FF' : '#fff', border: `1px solid ${sellerId === u.id ? '#C7D2FE' : M.border}` }}
              >
                <InitialsAvatar name={u.full_name ?? u.id} size={26} radius={8} palette={i} />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>{u.full_name ?? u.id}</span>
              </button>
            ))}
          </div>
        </BottomSheet>

        <div style={{ marginTop: 14 }} className="space-y-2.5">

        {totalsLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        )}
        {!totalsLoading && mobileList.length === 0 && (
          <div className="card"><EmptyState icon={<ClipboardList size={24} />} title="Нет заказов" description="Заказы вашей команды появятся здесь." /></div>
        )}
        {!totalsLoading && mobileList.map(o => <MobileCard key={o.id} order={o} />)}
        </div>

        <OrderDetailBottomSheet
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          citiesById={citiesById}
          editBasePath="/team-lead/orders"
          allowEdit={true}
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
