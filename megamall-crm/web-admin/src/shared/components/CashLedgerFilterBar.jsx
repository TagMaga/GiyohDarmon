/**
 * CashLedgerFilterBar — 5 filters (Дата/Отправитель/Получатель/Статус/Сумма)
 * for the unified cash ledger table. Mobile: horizontally-scrolling pill
 * row. Desktop: bordered chip row. Each non-date chip opens a small popover
 * with the actual control; only one popover is open at a time.
 */
import { useEffect, useRef, useState } from 'react'
import PeriodRangeFilter from './PeriodRangeFilter'
import SharedFilterChip from './FilterChip'
import FiltersOverflowPanel from './FiltersOverflowPanel'

// Local wrapper: keeps this file's self-managed-popover behavior (outside-
// click to close, render-prop children for the popover body) while using
// the canonical shared FilterChip as the trigger button. Open state is
// controlled by the parent (openKey/onOpenChange) so the "Ещё фильтры"
// panel can open a specific chip's popover from outside.
function FilterChip({ label, active, children, open, onOpenChange }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onOpenChange(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, onOpenChange])

  return (
    <div className="relative" ref={ref}>
      <SharedFilterChip
        label={label}
        active={active}
        onClick={() => onOpenChange(!open)}
        ariaExpanded={open}
        maxWidthClass="max-w-[160px]"
      />
      {open && (
        <div className="absolute z-20 mt-2 w-64 rounded-xl border border-slate-100 bg-white p-3 shadow-lg">
          {children(() => onOpenChange(false))}
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
  trailing,
}) {
  const statusLabel = { '': 'Статус', pending: 'Ожидает', confirmed: 'Принято', rejected: 'Отклонено' }[status] ?? 'Статус'
  const senderLabel = sender ? `Отправитель: ${sender}` : 'Отправитель'
  const receiverLabel = receiver ? `Получатель: ${receiver}` : 'Получатель'
  const amountLabel = (amountMin || amountMax) ? `Сумма: ${amountMin || 0}–${amountMax || '∞'}` : 'Сумма'

  const [openKey, setOpenKey] = useState(null)
  const openProps = (key) => ({ open: openKey === key, onOpenChange: (v) => setOpenKey(v ? key : null) })

  const [overflowOpen, setOverflowOpen] = useState(false)
  // Period isn't counted here or resettable via "Сбросить всё" — see the
  // comment on resetAll below. It's still listed in the panel for visibility.
  const activeFilterCount = [Boolean(sender), Boolean(receiver), Boolean(status), Boolean(amountMin || amountMax)].filter(Boolean).length
  const overflowSections = [
    { key: 'period', label: 'Период', valueLabel: (from || to) ? 'выбран' : null, active: false, onSelect: () => {} },
    { key: 'sender', label: 'Отправитель', valueLabel: sender || null, active: Boolean(sender), onSelect: () => setOpenKey('sender') },
    { key: 'receiver', label: 'Получатель', valueLabel: receiver || null, active: Boolean(receiver), onSelect: () => setOpenKey('receiver') },
    { key: 'status', label: 'Статус', valueLabel: status ? statusLabel : null, active: Boolean(status), onSelect: () => setOpenKey('status') },
    { key: 'amount', label: 'Сумма', valueLabel: (amountMin || amountMax) ? amountLabel.replace('Сумма: ', '') : null, active: Boolean(amountMin || amountMax), onSelect: () => setOpenKey('amount') },
  ]
  // Doesn't reset the period — this bar has no "default" range passed in
  // (unlike FinanceFilterBar's thisMonthRange), so there's no safe value to
  // reset it to; the period chip's own clear (✕) already handles that.
  function resetAll() {
    onSenderChange('')
    onReceiverChange('')
    onStatusChange('')
    onAmountChange({ min: '', max: '' })
  }

  return (
    <div className="relative mb-4">
      {/* Mobile: horizontal scroll of pill chips */}
      <div className="md:hidden">
        <div className="scrollbar-none -mx-5 flex flex-nowrap items-center gap-2 overflow-x-auto px-5 py-[5px]">
          <PeriodRangeFilter from={from} to={to} onChange={onDateChange} />
          <FilterChip label={senderLabel} active={!!sender} {...openProps('sender')}>
            {(close) => (
              <input
                autoFocus type="text" className="input" placeholder="Имя отправителя…"
                value={sender} onChange={(e) => onSenderChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && close()}
              />
            )}
          </FilterChip>
          <FilterChip label={receiverLabel} active={!!receiver} {...openProps('receiver')}>
            {(close) => (
              <input
                autoFocus type="text" className="input" placeholder="Имя получателя…"
                value={receiver} onChange={(e) => onReceiverChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && close()}
              />
            )}
          </FilterChip>
          <FilterChip label={statusLabel} active={!!status} {...openProps('status')}>
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
          <FilterChip label={amountLabel} active={!!(amountMin || amountMax)} {...openProps('amount')}>
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
          <SharedFilterChip
            label={activeFilterCount > 0 ? `Фильтры · ${activeFilterCount}` : 'Ещё фильтры'}
            active={activeFilterCount > 0}
            onClick={() => setOverflowOpen(true)}
            maxWidthClass=""
          />
          {trailing}
        </div>
      </div>

      {/* Desktop: bordered chip row */}
      <div className="hidden md:flex md:flex-wrap md:items-center md:gap-2">
        <PeriodRangeFilter from={from} to={to} onChange={onDateChange} />
        <FilterChip label={senderLabel} active={!!sender} {...openProps('sender')}>
          {(close) => (
            <input
              autoFocus type="text" className="input" placeholder="Имя отправителя…"
              value={sender} onChange={(e) => onSenderChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && close()}
            />
          )}
        </FilterChip>
        <FilterChip label={receiverLabel} active={!!receiver} {...openProps('receiver')}>
          {(close) => (
            <input
              autoFocus type="text" className="input" placeholder="Имя получателя…"
              value={receiver} onChange={(e) => onReceiverChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && close()}
            />
          )}
        </FilterChip>
        <FilterChip label={statusLabel} active={!!status} {...openProps('status')}>
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
        <FilterChip label={amountLabel} active={!!(amountMin || amountMax)} {...openProps('amount')}>
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
        <SharedFilterChip
          label={activeFilterCount > 0 ? `Фильтры · ${activeFilterCount}` : 'Ещё фильтры'}
          active={activeFilterCount > 0}
          onClick={() => setOverflowOpen(true)}
          maxWidthClass=""
        />
        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>

      <FiltersOverflowPanel
        open={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        sections={overflowSections}
        onResetAll={resetAll}
      />
    </div>
  )
}
