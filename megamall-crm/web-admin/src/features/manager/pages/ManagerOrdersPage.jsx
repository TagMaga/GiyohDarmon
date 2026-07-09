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
import { Search, X, ClipboardList, ChevronDown } from 'lucide-react'
import Badge                           from '../../../shared/components/Badge'
import EmptyState                      from '../../../shared/components/EmptyState'
import BottomSheet                     from '../../../shared/components/BottomSheet'
import DesktopDateRangePicker          from '../../../shared/components/DesktopDateRangePicker'
import MobileDateRangeCalendar         from '../../../shared/components/MobileDateRangeCalendar'
import SellerOrderDetailPanel          from '../../seller/components/SellerOrderDetailPanel'
import OrderDetailBottomSheet          from '../../seller/components/OrderDetailBottomSheet'
import { M, InitialsAvatar, StatusPill, Chip } from '../../seller/components/mobileUi'
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

function toYMD(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}
function fromYMD(value) {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}
function addDays(date, days) { const n = new Date(date); n.setDate(n.getDate() + days); return n }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1) }
function endOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0) }
function addMonths(date, months) { return new Date(date.getFullYear(), date.getMonth() + months, 1) }
function formatDMY(value) {
  const d = fromYMD(value)
  if (!d) return ''
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
function formatHuman(value) {
  const d = fromYMD(value)
  if (!d) return ''
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}
function formatMonthLabel(date) { return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) }
function parseDMY(text) {
  const m = text.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (!m) return null
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function currentMonthDefault() {
  const now = new Date()
  return { from: toYMD(startOfMonth(now)), to: toYMD(now) }
}

function periodChipLabel(from, to) {
  if (!from || !to) return 'Период'
  const start = fromYMD(from)
  const end = fromYMD(to)
  if (!start || !end) return 'Период'
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
  const isMonthToDate = from === toYMD(startOfMonth(start)) && to === toYMD(new Date())
  if (sameMonth && isMonthToDate) {
    return start.toLocaleDateString('ru-RU', { month: 'long' }).replace(/^./, ch => ch.toUpperCase())
  }
  const fmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' })
  return sameMonth ? `${fmt.format(start)}-${fmt.format(end)}` : `${fmt.format(start)} | ${fmt.format(end)}`
}

const DATE_PRESETS = [
  { label: 'Сегодня', get: () => { const t = toYMD(new Date()); return { from: t, to: t } } },
  { label: 'Вчера', get: () => { const y = toYMD(addDays(new Date(), -1)); return { from: y, to: y } } },
  { label: '7 дней', get: () => ({ from: toYMD(addDays(new Date(), -6)), to: toYMD(new Date()) }) },
  { label: '30 дней', get: () => ({ from: toYMD(addDays(new Date(), -29)), to: toYMD(new Date()) }) },
  { label: 'Этот месяц', get: () => ({ from: toYMD(startOfMonth(new Date())), to: toYMD(new Date()) }) },
]
const WEEKDAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']

const CHIP_BASE = 'inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold transition duration-150 font-sans active:scale-[0.94]'
const CHIP_OFF = `${CHIP_BASE} bg-slate-100 text-slate-600 hover:bg-slate-200`
const CHIP_ON = `${CHIP_BASE} bg-indigo-600 text-white hover:bg-indigo-700`

function FilterChip({ flipKey, active, onClick, onClear, children }) {
  return (
    <button type="button" data-flip-key={flipKey} onClick={onClick} className={active ? CHIP_ON : CHIP_OFF}>
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
      {!active && <ChevronDown size={13} className="opacity-50 transition-transform duration-200" />}
    </button>
  )
}

function PresetPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'h-8 rounded-full px-3 text-xs font-semibold transition-colors',
        active ? 'border border-indigo-600 bg-indigo-50 text-indigo-700' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function MonthGrid({ month, from, to, onPick }) {
  const days = useMemo(() => {
    const first = startOfMonth(month)
    const offset = (first.getDay() + 6) % 7
    const cells = []
    for (let i = 0; i < offset; i += 1) cells.push(null)
    const total = endOfMonth(month).getDate()
    for (let d = 1; d <= total; d += 1) cells.push(new Date(month.getFullYear(), month.getMonth(), d))
    return cells
  }, [month])

  return (
    <div className="pb-1 pt-3">
      <p className="mb-2 text-[15px] font-bold capitalize text-slate-900">{formatMonthLabel(month)}</p>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          if (!day) return <div key={`e-${i}`} className="h-[42px]" />
          const value = toYMD(day)
          const edge = value === from || value === to
          const inRange = Boolean(from && to && value > from && value < to)
          return (
            <button
              key={value}
              type="button"
              onClick={() => onPick(day)}
              className={[
                'h-[42px] select-none rounded-full text-[13.5px] font-semibold transition-colors',
                edge ? 'bg-indigo-600 text-white' : inRange ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100',
              ].join(' ')}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function ManagerOrdersPage() {
  const def = currentMonthDefault()

  // Filters state
  const [dateFrom,     setDateFrom]     = useState(def.from)
  const [dateTo,       setDateTo]       = useState(def.to)
  const [statusFilter, setStatusFilter] = useState('all')
  const [sellerId,     setSellerId]     = useState('')
  const [rawSearch,    setRawSearch]    = useState('')
  const [minAmount,    setMinAmount]    = useState('')
  const [maxAmount,    setMaxAmount]    = useState('')
  const [page,         setPage]         = useState(1)
  const [detailOrder,  setDetailOrder]  = useState(null)
  const [sheet,        setSheet]        = useState(null) // null | 'period' | 'user' | 'amount'
  const [draft,        setDraft]        = useState({})
  const [monthCount,   setMonthCount]   = useState(2)

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
  const selectedSeller = useMemo(() => sellers.find(u => u.id === sellerId) ?? null, [sellers, sellerId])

  // Mobile chip row: Период / Пользователь / Сумма, each opening a bottom sheet.
  function openSheet(kind) {
    if (kind === 'period') {
      setDraft({ from: dateFrom, to: dateTo, fromTxt: formatDMY(dateFrom), toTxt: formatDMY(dateTo) })
      setMonthCount(2)
    } else if (kind === 'user') setDraft({ sel: sellerId })
    else if (kind === 'amount') setDraft({ min: minAmount, max: maxAmount })
    setSheet(kind)
  }
  function closeSheet() { setSheet(null); setDraft({}) }
  function patchDraft(patch) { setDraft(d => ({ ...d, ...patch })) }
  function applySheet() {
    if (sheet === 'period') {
      if (draft.from) { setDateFrom(draft.from); setDateTo(draft.to || draft.from) }
    } else if (sheet === 'user') {
      setSellerId(draft.sel || '')
    } else if (sheet === 'amount') {
      setMinAmount(draft.min || ''); setMaxAmount(draft.max || '')
    }
    closeSheet()
  }

  function pickDay(day) {
    const value = toYMD(day)
    let nextFrom = draft.from, nextTo = draft.to
    if (!nextFrom || (nextFrom && nextTo)) { nextFrom = value; nextTo = '' }
    else if (value < nextFrom) { nextTo = nextFrom; nextFrom = value }
    else { nextTo = value }
    patchDraft({ from: nextFrom, to: nextTo, fromTxt: formatDMY(nextFrom), toTxt: formatDMY(nextTo) })
  }
  function onTypeDateFrom(e) {
    const text = e.target.value
    const value = parseDMY(text)
    patchDraft(value ? { fromTxt: text, from: value } : { fromTxt: text })
  }
  function onTypeDateTo(e) {
    const text = e.target.value
    const value = parseDMY(text)
    patchDraft(value ? { toTxt: text, to: value } : { toTxt: text })
  }

  const periodActive = dateFrom !== def.from || dateTo !== def.to
  const periodLabel = periodChipLabel(dateFrom, dateTo)
  const amountOn = Boolean(minAmount || maxAmount)
  const amountLabel = amountOn
    ? (minAmount && maxAmount ? `${minAmount}–${maxAmount}` : minAmount ? `от ${minAmount}` : `до ${maxAmount}`)
    : 'Сумма'

  const periodBaseMonth = useMemo(() => startOfMonth(fromYMD(dateFrom) ?? fromYMD(dateTo) ?? addMonths(new Date(), -1)), [dateFrom, dateTo])
  const periodMonths = useMemo(() => Array.from({ length: monthCount }, (_, i) => addMonths(periodBaseMonth, i)), [periodBaseMonth, monthCount])
  const periodCtaLabel = (() => {
    if (!draft.from) return 'Выберите даты'
    const toTxt = draft.to && draft.to !== draft.from ? ` – ${formatHuman(draft.to)}` : ''
    return `Показать результаты — ${formatHuman(draft.from)}${toTxt}`
  })()
  const periodCTA = (
    <button
      type="button"
      onClick={applySheet}
      className="flex h-[50px] w-full items-center justify-center rounded-full bg-indigo-600 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(79,70,229,.28)] transition-colors hover:bg-indigo-700"
    >
      {periodCtaLabel}
    </button>
  )

  const sheetCTA = (
    <button
      type="button"
      onClick={applySheet}
      className="flex h-[50px] w-full items-center justify-center rounded-full bg-indigo-600 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(79,70,229,.28)] transition-colors hover:bg-indigo-700"
    >
      Применить
    </button>
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

  // Сумма has no backend param — filter the current page client-side (mobile chip only).
  const visibleItems = useMemo(() => {
    if (!amountOn) return items
    const min = minAmount ? Number(minAmount) : -Infinity
    const max = maxAmount ? Number(maxAmount) : Infinity
    return items.filter(o => {
      const amt = o.total_order_amount ?? o.total_amount ?? 0
      return amt >= min && amt <= max
    })
  }, [items, amountOn, minAmount, maxAmount])

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

  // ── Filters (same split pattern as TeamLeadOrders) ────────────────────────
  const quickFilters = (
    <div className="space-y-2.5">
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
        variant="trigger"
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

  // ── Shared list row renderer ──────────────────────────────────────────────
  function ListRow({ order }) {
    const isSelected = detailOrder?.id === order.id
    const status = order.status ?? ''
    const amount = order.total_order_amount ?? order.total_amount ?? 0
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
  const mobileCount = amountOn ? visibleItems.length : totalCount
  const totalPages = meta?.total_pages ?? 1

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          MOBILE
      ═══════════════════════════════════════════════════════════ */}
      <div className="lg:hidden" style={{ background: M.bg, fontFamily: M.font, minHeight: '100vh', padding: '8px 20px 7.5rem' }}>
        <div className="flex items-baseline gap-[9px]">
          <h1 style={{ fontSize: 24, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Заказы команды</h1>
          <span style={{ fontSize: 14, color: M.muted, fontWeight: 600 }}>{mobileCount}</span>
        </div>

        <div style={{ marginTop: 14 }} className="space-y-3">
          {quickFilters}
          <div className="scrollbar-none -mx-5 flex flex-nowrap items-center gap-2 overflow-x-auto px-5 py-[5px]">
            <FilterChip flipKey="period" active={periodActive} onClick={() => openSheet('period')} onClear={() => { setDateFrom(def.from); setDateTo(def.to) }}>
              {periodLabel}
            </FilterChip>
            <FilterChip flipKey="user" active={Boolean(sellerId)} onClick={() => openSheet('user')} onClear={() => setSellerId('')}>
              {selectedSeller?.full_name ?? 'Пользователь'}
            </FilterChip>
            <FilterChip flipKey="amount" active={amountOn} onClick={() => openSheet('amount')} onClear={() => { setMinAmount(''); setMaxAmount('') }}>
              {amountLabel}
            </FilterChip>
          </div>
        </div>

        <BottomSheet open={sheet === 'period'} onClose={closeSheet} title="Выбор периода" footer={periodCTA}>
          <div className="mb-1 mt-1.5 flex items-center gap-2.5">
            <input
              type="text"
              inputMode="numeric"
              placeholder="дд.мм.гггг"
              value={draft.fromTxt ?? ''}
              onChange={onTypeDateFrom}
              aria-label="Дата от"
              className="h-[42px] min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-sm font-semibold text-slate-900 outline-none focus:border-indigo-300 focus:bg-white"
            />
            <span className="flex-shrink-0 font-semibold text-slate-400">—</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="дд.мм.гггг"
              value={draft.toTxt ?? ''}
              onChange={onTypeDateTo}
              aria-label="Дата до"
              className="h-[42px] min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-sm font-semibold text-slate-900 outline-none focus:border-indigo-300 focus:bg-white"
            />
          </div>

          <div className="mb-1 mt-3 flex flex-wrap gap-2">
            {DATE_PRESETS.map((preset) => {
              const range = preset.get()
              const active = draft.from === range.from && draft.to === range.to
              return (
                <PresetPill key={preset.label} active={active} onClick={() => patchDraft({ ...range, fromTxt: formatDMY(range.from), toTxt: formatDMY(range.to) })}>
                  {preset.label}
                </PresetPill>
              )
            })}
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((d) => <span key={d} className="text-[11px] font-bold text-slate-400">{d}</span>)}
          </div>
          {periodMonths.map((month, i) => (
            <MonthGrid key={i} month={month} from={draft.from} to={draft.to} onPick={pickDay} />
          ))}
          <button
            type="button"
            onClick={() => setMonthCount((c) => c + 1)}
            className="mt-1 w-full rounded-lg py-2 text-center text-[12px] font-bold text-indigo-600 hover:bg-indigo-50"
          >
            Показать следующий месяц
          </button>
        </BottomSheet>

        <BottomSheet open={sheet === 'user'} onClose={closeSheet} title="Пользователь" footer={sheetCTA}>
          <button
            type="button"
            onClick={() => setDraft({ sel: '' })}
            className={`flex w-full items-center rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition-colors ${!draft.sel ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}
          >
            Все продавцы
          </button>
          {sellers.map(u => (
            <button
              key={u.id}
              type="button"
              onClick={() => setDraft({ sel: u.id })}
              className={`flex w-full items-center rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition-colors ${draft.sel === u.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {u.full_name ?? u.id}
            </button>
          ))}
        </BottomSheet>

        <BottomSheet open={sheet === 'amount'} onClose={closeSheet} title="Сумма" footer={sheetCTA}>
          <div className="grid grid-cols-2 gap-6 py-3.5">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-400">От</span>
              <input
                type="number" min="0" step="0.01" placeholder="0"
                value={draft.min ?? ''} onChange={(e) => setDraft(d => ({ ...d, min: e.target.value }))}
                className="w-full border-0 border-b-2 border-slate-200 bg-transparent py-1 text-[22px] font-bold text-slate-900 outline-none focus:border-indigo-400"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-400">До</span>
              <input
                type="number" min="0" step="0.01" placeholder="∞"
                value={draft.max ?? ''} onChange={(e) => setDraft(d => ({ ...d, max: e.target.value }))}
                className="w-full border-0 border-b-2 border-slate-200 bg-transparent py-1 text-[22px] font-bold text-slate-900 outline-none focus:border-indigo-400"
              />
            </label>
          </div>
        </BottomSheet>

        <div style={{ marginTop: 14 }} className="space-y-2.5">
          {isLoading && (
            <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
            </div>
          )}
          {!isLoading && visibleItems.length === 0 && (
            <div className="card"><EmptyState icon={<ClipboardList size={24} />} title="Нет заказов" description="Заказы вашей команды появятся здесь." /></div>
          )}
          {!isLoading && visibleItems.map(o => <MobileCard key={o.id} order={o} />)}

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
          editBasePath="/manager/orders"
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
