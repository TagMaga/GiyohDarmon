/**
 * CashLedgerFilterBar — 5 filters (Дата/Отправитель/Получатель/Статус/Сумма)
 * for the unified cash ledger table. Mobile: horizontally-scrolling pill
 * row. Desktop: bordered chip row. Each non-date chip opens a small popover
 * with the actual control; only one popover is open at a time.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import PeriodRangeFilter from './PeriodRangeFilter'

function FilterChip({ label, active, children, mobile = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const base = mobile
    ? 'inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold transition duration-150 active:scale-[0.94]'
    : 'inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-colors'

  const cls = mobile
    ? `${base} ${active ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`
    : `${base} ${active ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={cls}>
        <span className="max-w-[160px] truncate">{label}</span>
        <ChevronDown size={13} className={`opacity-50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-64 rounded-xl border border-slate-100 bg-white p-3 shadow-lg">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export default function CashLedgerFilterBar({
  from, to, onDateChange,
  sender, onSenderChange,
  receiver, onReceiverChange,
  status, onStatusChange,
  amountMin, amountMax, onAmountChange,
}) {
  const statusLabel = { '': 'Статус', pending: 'Ожидает', confirmed: 'Принято', rejected: 'Отклонено' }[status] ?? 'Статус'
  const senderLabel = sender ? `Отправитель: ${sender}` : 'Отправитель'
  const receiverLabel = receiver ? `Получатель: ${receiver}` : 'Получатель'
  const amountLabel = (amountMin || amountMax) ? `Сумма: ${amountMin || 0}–${amountMax || '∞'}` : 'Сумма'

  return (
    <div className="relative mb-4">
      {/* Mobile: horizontal scroll of pill chips */}
      <div className="md:hidden">
        <div className="scrollbar-none -mx-5 flex flex-nowrap items-center gap-2 overflow-x-auto px-5 py-[5px]">
          <PeriodRangeFilter from={from} to={to} onChange={onDateChange} />
          <FilterChip label={senderLabel} active={!!sender} mobile>
            {(close) => (
              <input
                autoFocus type="text" className="input" placeholder="Имя отправителя…"
                value={sender} onChange={(e) => onSenderChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && close()}
              />
            )}
          </FilterChip>
          <FilterChip label={receiverLabel} active={!!receiver} mobile>
            {(close) => (
              <input
                autoFocus type="text" className="input" placeholder="Имя получателя…"
                value={receiver} onChange={(e) => onReceiverChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && close()}
              />
            )}
          </FilterChip>
          <FilterChip label={statusLabel} active={!!status} mobile>
            {(close) => (
              <select
                className="input" value={status}
                onChange={(e) => { onStatusChange(e.target.value); close() }}
              >
                <option value="">Все статусы</option>
                <option value="pending">Ожидает</option>
                <option value="confirmed">Принято</option>
                <option value="rejected">Отклонено</option>
              </select>
            )}
          </FilterChip>
          <FilterChip label={amountLabel} active={!!(amountMin || amountMax)} mobile>
            {() => (
              <div className="flex items-center gap-2">
                <input
                  type="number" min="0" className="input" placeholder="от"
                  value={amountMin} onChange={(e) => onAmountChange({ min: e.target.value, max: amountMax })}
                />
                <span className="text-slate-400">—</span>
                <input
                  type="number" min="0" className="input" placeholder="до"
                  value={amountMax} onChange={(e) => onAmountChange({ min: amountMin, max: e.target.value })}
                />
              </div>
            )}
          </FilterChip>
        </div>
      </div>

      {/* Desktop: bordered chip row */}
      <div className="hidden md:flex md:flex-wrap md:items-center md:gap-2">
        <PeriodRangeFilter from={from} to={to} onChange={onDateChange} />
        <FilterChip label={senderLabel} active={!!sender}>
          {(close) => (
            <input
              autoFocus type="text" className="input" placeholder="Имя отправителя…"
              value={sender} onChange={(e) => onSenderChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && close()}
            />
          )}
        </FilterChip>
        <FilterChip label={receiverLabel} active={!!receiver}>
          {(close) => (
            <input
              autoFocus type="text" className="input" placeholder="Имя получателя…"
              value={receiver} onChange={(e) => onReceiverChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && close()}
            />
          )}
        </FilterChip>
        <FilterChip label={statusLabel} active={!!status}>
          {(close) => (
            <select
              className="input" value={status}
              onChange={(e) => { onStatusChange(e.target.value); close() }}
            >
              <option value="">Все статусы</option>
              <option value="pending">Ожидает</option>
              <option value="confirmed">Принято</option>
              <option value="rejected">Отклонено</option>
            </select>
          )}
        </FilterChip>
        <FilterChip label={amountLabel} active={!!(amountMin || amountMax)}>
          {() => (
            <div className="flex items-center gap-2">
              <input
                type="number" min="0" className="input" placeholder="от"
                value={amountMin} onChange={(e) => onAmountChange({ min: e.target.value, max: amountMax })}
              />
              <span className="text-slate-400">—</span>
              <input
                type="number" min="0" className="input" placeholder="до"
                value={amountMax} onChange={(e) => onAmountChange({ min: amountMin, max: e.target.value })}
              />
            </div>
          )}
        </FilterChip>
      </div>
    </div>
  )
}
