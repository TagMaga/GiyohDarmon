/**
 * OrdersFilters — filter bar for Owner Orders Center.
 *
 * Filters: status, team, seller, search.
 * Search is debounced 400ms. All filter changes call onChange({ ...filters }).
 *
 * Desktop (md+): full-width toolbar, unchanged from before — search box +
 * native selects.
 * Mobile: single horizontally-scrollable pill row (FilterChip triggers),
 * each opening a bottom sheet with the actual picker — same state, same
 * onChange contract, just a different mobile presentation.
 */
import { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { STATUS_LABELS } from '../../../shared/orderStatusConfig'
import FilterChip from '../../../shared/components/FilterChip'
import BottomSheet from '../../../shared/components/BottomSheet'

const ALL_STATUSES = Object.entries(STATUS_LABELS)

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debouncedValue
}

function PickerRow({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-left text-[13.5px] font-semibold transition-colors',
        active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50',
      ].join(' ')}
    >
      {children}
      {active && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-indigo-600" />}
    </button>
  )
}

export default function OrdersFilters({
  filters,
  onChange,
  teams    = [],
  sellers  = [],
}) {
  const [searchRaw, setSearchRaw] = useState(filters.search ?? '')
  const search = useDebounce(searchRaw, 400)
  const [openSheet, setOpenSheet] = useState(null) // null | 'search' | 'status' | 'team' | 'seller'

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

  const activeTeam   = teams.find(t => t.id === filters.team_id)
  const activeSeller = sellers.find(u => u.id === filters.seller_id)

  return (
    <div className="card">
      {/* ── Desktop toolbar — unchanged ─────────────────────────────────── */}
      <div className="hidden md:flex items-center gap-2 px-6 py-3.5 border-b border-slate-50 flex-wrap">
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

      {/* ── Mobile pill row ──────────────────────────────────────────────── */}
      <div className="md:hidden">
        <div className="scrollbar-none flex flex-nowrap items-center gap-2 overflow-x-auto px-4 py-3">
          <FilterChip
            icon={<Search size={13} />}
            active={Boolean(searchRaw.trim())}
            onClick={() => setOpenSheet(openSheet === 'search' ? null : 'search')}
            onClear={() => setSearchRaw('')}
            ariaExpanded={openSheet === 'search'}
          >
            {searchRaw.trim() || 'Поиск'}
          </FilterChip>

          <FilterChip
            active={Boolean(filters.status)}
            onClick={() => setOpenSheet('status')}
            onClear={() => set('status', '')}
            ariaExpanded={openSheet === 'status'}
          >
            {filters.status ? STATUS_LABELS[filters.status] : 'Статус'}
          </FilterChip>

          {teams.length > 0 && (
            <FilterChip
              active={Boolean(filters.team_id)}
              onClick={() => setOpenSheet('team')}
              onClear={() => set('team_id', '')}
              ariaExpanded={openSheet === 'team'}
            >
              {activeTeam?.name ?? 'Команда'}
            </FilterChip>
          )}

          {sellers.length > 0 && (
            <FilterChip
              active={Boolean(filters.seller_id)}
              onClick={() => setOpenSheet('seller')}
              onClear={() => set('seller_id', '')}
              ariaExpanded={openSheet === 'seller'}
            >
              {activeSeller?.full_name ?? activeSeller?.FullName ?? 'Продавец'}
            </FilterChip>
          )}
        </div>

        {/* Inline search field — expands in place, no bottom sheet */}
        {openSheet === 'search' && (
          <div className="relative px-4 pb-3">
            <Search size={14} className="absolute left-7 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              autoFocus
              value={searchRaw}
              onChange={e => setSearchRaw(e.target.value)}
              placeholder="№ заказа, клиент, телефон…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-[14px] font-medium text-slate-700 outline-none focus:border-indigo-300 focus:bg-white"
            />
          </div>
        )}
      </div>

      {/* ── Sheets ───────────────────────────────────────────────────────── */}
      <BottomSheet open={openSheet === 'status'} onClose={() => setOpenSheet(null)} title="Статус">
        <div className="space-y-0.5 pb-1">
          <PickerRow active={!filters.status} onClick={() => { set('status', ''); setOpenSheet(null) }}>Все статусы</PickerRow>
          {ALL_STATUSES.map(([key, label]) => (
            <PickerRow key={key} active={filters.status === key} onClick={() => { set('status', key); setOpenSheet(null) }}>
              {label}
            </PickerRow>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={openSheet === 'team'} onClose={() => setOpenSheet(null)} title="Команда">
        <div className="space-y-0.5 pb-1">
          <PickerRow active={!filters.team_id} onClick={() => { set('team_id', ''); setOpenSheet(null) }}>Все команды</PickerRow>
          {teams.map(t => (
            <PickerRow key={t.id} active={filters.team_id === t.id} onClick={() => { set('team_id', t.id); setOpenSheet(null) }}>
              {t.name}
            </PickerRow>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={openSheet === 'seller'} onClose={() => setOpenSheet(null)} title="Продавец">
        <div className="space-y-0.5 pb-1">
          <PickerRow active={!filters.seller_id} onClick={() => { set('seller_id', ''); setOpenSheet(null) }}>Все продавцы</PickerRow>
          {sellers.map(u => (
            <PickerRow key={u.id} active={filters.seller_id === u.id} onClick={() => { set('seller_id', u.id); setOpenSheet(null) }}>
              {u.full_name ?? u.FullName ?? u.id}
            </PickerRow>
          ))}
        </div>
      </BottomSheet>
    </div>
  )
}
