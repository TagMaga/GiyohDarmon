import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Search, Truck, Wallet, AlertTriangle, RefreshCw, X } from 'lucide-react'

const COMMANDS = [
  { key: 'couriers',   label: 'Управление курьерами', icon: <Truck size={14} />,         action: 'viewCouriers', kbd: 'C' },
  { key: 'cash',       label: 'Касса / Инкассация',   icon: <Wallet size={14} />,        action: 'viewCash',     kbd: 'W' },
  { key: 'issues',     label: 'Показать проблемные',  icon: <AlertTriangle size={14} />, action: 'viewIssues',   kbd: 'I' },
  { key: 'refresh',    label: 'Обновить данные',       icon: <RefreshCw size={14} />,    action: 'refresh',      kbd: 'R' },
]

export default function CommandPalette({ open, onClose, onCommand, orders = [] }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const orderResults = query.trim()
    ? orders.filter((o) => {
        const q = query.toLowerCase()
        return (
          (o.order_number ?? '').toLowerCase().includes(q) ||
          (o.customer?.full_name ?? '').toLowerCase().includes(q) ||
          (o.customer?.phone ?? '').toLowerCase().includes(q)
        )
      }).slice(0, 5)
    : []

  const cmdResults = COMMANDS.filter((c) =>
    !query.trim() || c.label.toLowerCase().includes(query.toLowerCase())
  )

  const allResults = [
    ...cmdResults.map((c) => ({ type: 'command', ...c })),
    ...orderResults.map((o) => ({ type: 'order', key: o.id, label: o.order_number ?? o.id?.slice(0, 8), order: o })),
  ]

  function handleKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, allResults.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
    if (e.key === 'Enter') {
      const r = allResults[selected]
      if (r) handleSelect(r)
    }
    if (e.key === 'Escape') onClose()
  }

  function handleSelect(r) {
    if (r.type === 'command') onCommand(r.action)
    if (r.type === 'order')   onCommand('selectOrder', r.order)
    onClose()
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div
        className="relative w-full max-w-lg mx-4 rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: '#FFFFFF', border: '1px solid #EAE8E2' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Backdrop blur bg */}
        <div className="absolute inset-0 backdrop-blur-xl" style={{ background: 'rgba(255,255,255,0.95)' }} />

        <div className="relative">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid #EAE8E2' }}>
            <Search size={16} className="text-[#A3A39A] flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(0) }}
              onKeyDown={handleKey}
              placeholder="Поиск команд или заказов…"
              className="flex-1 bg-transparent text-sm text-[#1C1C1A] placeholder-[#A3A39A] outline-none"
            />
            <button onClick={onClose} className="text-[#A3A39A] hover:text-[#1C1C1A] transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Results */}
          <div className="max-h-80 overflow-y-auto py-2">
            {!query.trim() && (
              <p className="text-[10px] font-bold text-[#A3A39A] uppercase tracking-widest px-4 pb-1">Команды</p>
            )}
            {query.trim() && orderResults.length > 0 && (
              <p className="text-[10px] font-bold text-[#A3A39A] uppercase tracking-widest px-4 pb-1">Заказы</p>
            )}

            {allResults.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-sm text-[#A3A39A]">Ничего не найдено</p>
              </div>
            )}

            {allResults.map((r, i) => (
              <button
                key={r.key}
                onMouseEnter={() => setSelected(i)}
                onClick={() => handleSelect(r)}
                className={[
                  'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  i === selected ? '' : 'hover:bg-[#F0EFEA]',
                ].join(' ')}
                style={i === selected ? { background: '#F0EFEA' } : {}}
              >
                {r.type === 'command' && (
                  <>
                    <span className="text-[#A3A39A] flex-shrink-0">{r.icon}</span>
                    <span className="text-sm text-[#1C1C1A] flex-1">{r.label}</span>
                    <kbd className="text-[10px] text-[#76766E] px-1.5 py-0.5 rounded" style={{ background: '#F0EFEA' }}>
                      {r.kbd}
                    </kbd>
                  </>
                )}
                {r.type === 'order' && (
                  <>
                    <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold text-[#4338CA] flex-shrink-0" style={{ background: '#ECEBFE' }}>
                      #
                    </span>
                    <span className="text-sm text-[#1C1C1A] flex-1 font-mono">{r.label}</span>
                    <span className="text-[10px] text-[#A3A39A]">{r.order?.customer?.full_name ?? ''}</span>
                  </>
                )}
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-4 px-4 py-2.5" style={{ borderTop: '1px solid #EAE8E2' }}>
            <span className="text-[10px] text-[#A3A39A]">↑↓ навигация</span>
            <span className="text-[10px] text-[#A3A39A]">↵ выбрать</span>
            <span className="text-[10px] text-[#A3A39A]">Esc закрыть</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
