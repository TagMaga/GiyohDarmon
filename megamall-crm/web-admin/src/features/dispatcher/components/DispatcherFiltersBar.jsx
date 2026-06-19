import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, SlidersHorizontal } from 'lucide-react'
import { STATUS_LABELS } from '../statusConfig'

/**
 * DispatcherFiltersBar — desktop: all controls inline.
 * Mobile: search + "Фильтр" button that opens a bottom sheet.
 */
const DATE_OPTIONS = [
  { value: 'all',      label: 'Все даты'   },
  { value: 'today',    label: 'Сегодня'    },
  { value: 'tomorrow', label: 'Завтра'     },
  { value: 'overdue',  label: 'Просрочено' },
]

const STATUS_FILTER_OPTIONS = [
  'new', 'confirmed', 'assigned', 'in_delivery', 'issue', 'delivered',
]

const selectStyle = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
}

export default function DispatcherFiltersBar({
  filters,
  onChange,
  onClear,
  courierOptions = [],
  cityOptions = [],
  resultCount,
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const set = (patch) => onChange({ ...filters, ...patch })

  const active =
    !!filters.search ||
    !!filters.courier ||
    !!filters.city ||
    !!filters.status ||
    filters.date !== 'all'

  const activeCount = [
    filters.courier,
    filters.city,
    filters.status,
    filters.date !== 'all' ? '1' : '',
  ].filter(Boolean).length

  const selectCls =
    'text-xs text-white/75 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500/40 appearance-none cursor-pointer'

  return (
    <>
      {/* ── DESKTOP: all controls visible ──────────────────────────────── */}
      <div className="hidden md:flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Поиск: номер, клиент, телефон…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs text-white/80 placeholder-white/25 outline-none focus:ring-2 focus:ring-indigo-500/40"
            style={selectStyle}
          />
        </div>

        <div className="flex items-center gap-1.5 text-white/25">
          <SlidersHorizontal size={13} />
        </div>

        {/* Courier */}
        <select value={filters.courier} onChange={(e) => set({ courier: e.target.value })} className={selectCls} style={selectStyle} aria-label="Фильтр по курьеру">
          <option value="">Все курьеры</option>
          {courierOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* City — only when we have city data */}
        {cityOptions.length > 0 && (
          <select value={filters.city} onChange={(e) => set({ city: e.target.value })} className={selectCls} style={selectStyle} aria-label="Фильтр по городу">
            <option value="">Все города</option>
            {cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>
        )}

        {/* Status */}
        <select value={filters.status} onChange={(e) => set({ status: e.target.value })} className={selectCls} style={selectStyle} aria-label="Фильтр по статусу">
          <option value="">Все статусы</option>
          {STATUS_FILTER_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
        </select>

        {/* Date */}
        <select value={filters.date} onChange={(e) => set({ date: e.target.value })} className={selectCls} style={selectStyle} aria-label="Фильтр по дате">
          {DATE_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>

        {typeof resultCount === 'number' && (
          <span className="text-[11px] text-white/30 tabular-nums">{resultCount} заказов</span>
        )}

        {active && (
          <button onClick={onClear} className="flex items-center gap-1 text-[11px] text-white/40 hover:text-white/80 transition-colors px-2 py-1 rounded-lg" style={selectStyle}>
            <X size={12} /> Сбросить
          </button>
        )}
      </div>

      {/* ── MOBILE: search + Фильтр button ─────────────────────────────── */}
      <div className="flex md:hidden items-center gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Поиск…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs text-white/80 placeholder-white/25 outline-none focus:ring-2 focus:ring-indigo-500/40"
            style={selectStyle}
          />
        </div>

        {/* Фильтр button */}
        <button
          onClick={() => setSheetOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 transition-colors"
          style={{
            background: activeCount > 0 ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${activeCount > 0 ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`,
            color: activeCount > 0 ? '#a78bfa' : 'rgba(255,255,255,0.5)',
          }}
        >
          <SlidersHorizontal size={13} />
          Фильтр
          {activeCount > 0 && (
            <span className="ml-0.5 text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center" style={{ background: '#6366f1', color: '#fff' }}>
              {activeCount}
            </span>
          )}
        </button>

        {active && (
          <button onClick={onClear} className="p-1.5 rounded-lg text-white/40 hover:text-white/70 transition-colors" style={selectStyle} aria-label="Сбросить фильтры">
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── Mobile bottom sheet ──────────────────────────────────────────── */}
      {sheetOpen && createPortal(
        <div className="fixed inset-0 z-[200] flex flex-col justify-end">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={() => setSheetOpen(false)} />

          {/* Sheet */}
          <div className="relative rounded-t-2xl overflow-hidden" style={{ background: '#131929', border: '1px solid rgba(255,255,255,0.1)', maxHeight: '85vh' }}>
            {/* Handle */}
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-3 pt-1">
              <span className="text-sm font-bold text-white/90">Фильтры</span>
              <div className="flex items-center gap-3">
                {active && (
                  <button onClick={() => { onClear(); setSheetOpen(false) }} className="text-xs text-indigo-400 font-medium">
                    Сбросить
                  </button>
                )}
                <button onClick={() => setSheetOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="h-px mx-4" style={{ background: 'rgba(255,255,255,0.07)' }} />

            {/* Controls */}
            <div className="px-4 py-4 space-y-4 overflow-y-auto">
              {/* Courier */}
              <div>
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Курьер</p>
                <select
                  value={filters.courier}
                  onChange={(e) => set({ courier: e.target.value })}
                  className="w-full text-sm text-white/80 rounded-xl px-3 py-2.5 outline-none appearance-none"
                  style={selectStyle}
                >
                  <option value="">Все курьеры</option>
                  {courierOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Status */}
              <div>
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Статус</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {['', ...STATUS_FILTER_OPTIONS].map((s) => (
                    <button
                      key={s || 'all'}
                      onClick={() => set({ status: s })}
                      className="py-2 rounded-xl text-xs font-medium transition-colors"
                      style={{
                        background: filters.status === s ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${filters.status === s ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
                        color: filters.status === s ? '#a78bfa' : 'rgba(255,255,255,0.55)',
                      }}
                    >
                      {s ? (STATUS_LABELS[s] ?? s) : 'Все'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date */}
              <div>
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Дата доставки</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {DATE_OPTIONS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => set({ date: d.value })}
                      className="py-2.5 rounded-xl text-xs font-medium transition-colors"
                      style={{
                        background: filters.date === d.value ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${filters.date === d.value ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
                        color: filters.date === d.value ? '#a78bfa' : 'rgba(255,255,255,0.55)',
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* City — only when data available */}
              {cityOptions.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Город</p>
                  <select
                    value={filters.city}
                    onChange={(e) => set({ city: e.target.value })}
                    className="w-full text-sm text-white/80 rounded-xl px-3 py-2.5 outline-none appearance-none"
                    style={selectStyle}
                  >
                    <option value="">Все города</option>
                    {cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Apply */}
            <div className="px-4 pt-2 pb-8">
              <button
                onClick={() => setSheetOpen(false)}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
              >
                {typeof resultCount === 'number' ? `Показать ${resultCount} заказов` : 'Применить'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
