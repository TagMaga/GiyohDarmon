/**
 * FinanceFilterBar — replaces the old DesktopDateRangePicker(chip) + DirectionFilter +
 * <select> + AmountRangeFilter + two <input search> row in FinanceEventsTable.
 *
 * Every filter is a pill chip. Filled chips are indigo and carry a ✕ to clear
 * just that filter. Период / Тип / Сумма / Пользователь / Заказ open a
 * BottomSheet with a "Готово" (or "Показать результаты — <dates>" for period)
 * CTA — nothing is applied until that button is pressed. Пополнение/Списание
 * are simple two-state toggle chips (no sheet), same behavior as before.
 *
 * Props:
 *   from, to                 {string}   YYYY-MM-DD
 *   onDateChange              {(next:{from,to}) => void}
 *   direction                 {''|'income'|'expense'}
 *   onDirectionChange          {(next) => void}
 *   eventType                 {string}
 *   onEventTypeChange          {(value) => void}
 *   expenseCategory            {string}   only meaningful when eventType === 'business_expense'
 *   onExpenseCategoryChange     {(value) => void}
 *   minAmount, maxAmount       {string}
 *   onAmountChange             {(min, max) => void}
 *   userSearch                 {string}
 *   onUserChange                {(value) => void}
 *   userOptions                 {Array<{id, label}>}
 *   orderSearch                  {string}
 *   onOrderChange                 {(value) => void}
 *   orderOptions                  {Array<{id, label}>}
 *   action                          {ReactNode}  optional, rendered before the chips (e.g. "Добавить расход")
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import BottomSheet from '../../../shared/components/BottomSheet'
import { INCOME_EVENT_TYPES, EXPENSE_EVENT_TYPES, EXPENSE_CATEGORY_LABEL } from '../../hr/utils/hrHelpers'

// Base display order of the reorderable chips (Период is pinned before all of
// these and never reorders). Whichever chip gets a value first moves to the
// front, right after Период — "active filters bubble left". Пополнение/Списание
// are two independent entries (not a fixed pair) so an inactive one falls
// back with the rest instead of trailing whichever sibling is active.
const FILTER_ORDER_KEYS = ['income', 'expense', 'type', 'amount', 'user', 'order']

// ── Event types (income vs expense grouping + Russian labels for the sheet) ─

const EVENT_TYPE_OPTIONS = [
  { value: 'company_revenue_earned', label: 'Доход компании' },
  { value: 'company_revenue_confirmed', label: 'Доход компании подтвержден' },
  { value: 'seller_commission_earned', label: 'Комиссия продавца' },
  { value: 'seller_commission_confirmed', label: 'Комиссия продавца подтверждена' },
  { value: 'seller_commission_cancelled', label: 'Комиссия продавца отменена' },
  { value: 'manager_personal_commission_earned', label: 'Комиссия менеджера (личная)' },
  { value: 'manager_personal_commission_confirmed', label: 'Комиссия менеджера (личная) подтверждена' },
  { value: 'manager_team_commission_earned', label: 'Комиссия менеджера (команда)' },
  { value: 'manager_team_commission_confirmed', label: 'Комиссия менеджера (команда) подтверждена' },
  { value: 'team_lead_pool_earned', label: 'Пул руководителя' },
  { value: 'team_lead_pool_confirmed', label: 'Пул руководителя подтвержден' },
  { value: 'courier_fee_earned', label: 'Доставка курьеру' },
  { value: 'courier_fee_confirmed', label: 'Доставка курьеру подтверждена' },
  { value: 'cash_collected', label: 'Наличные собраны' },
  { value: 'cash_handed_over', label: 'Наличные сданы' },
  { value: 'business_expense', label: 'Расход' },
  { value: 'team_lead_payout', label: 'Выплата · Тимлид → Менеджер' },
  { value: 'manager_payout', label: 'Выплата · Менеджер → Продавец' },
  { value: 'owner_payout', label: 'Выплата · Владелец' },
]

// Расход sub-categories, shown nested under the "Расход" row in the Тип sheet.
const EXPENSE_CATEGORY_OPTIONS = Object.entries(EXPENSE_CATEGORY_LABEL).map(([value, label]) => ({ value, label }))

// ── Date helpers ──────────────────────────────────────────────────────────────

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
function formatMonthName(value) {
  const d = fromYMD(value)
  if (!d) return ''
  const s = d.toLocaleDateString('ru-RU', { month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function formatMonthLabel(date) { return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) }
function parseDMY(text) {
  const m = text.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (!m) return null
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const DATE_PRESETS = [
  { label: 'Сегодня', get: () => { const t = toYMD(new Date()); return { from: t, to: t } } },
  { label: 'Вчера', get: () => { const y = toYMD(addDays(new Date(), -1)); return { from: y, to: y } } },
  { label: '7 дней', get: () => ({ from: toYMD(addDays(new Date(), -6)), to: toYMD(new Date()) }) },
  { label: '30 дней', get: () => ({ from: toYMD(addDays(new Date(), -29)), to: toYMD(new Date()) }) },
  { label: 'Этот месяц', get: () => ({ from: toYMD(startOfMonth(new Date())), to: toYMD(new Date()) }) },
]
const AMOUNT_PRESETS = [
  { label: 'до 100', min: '', max: '100' },
  { label: '100–500', min: '100', max: '500' },
  { label: '500–1000', min: '500', max: '1000' },
  { label: '1000+', min: '1000', max: '' },
]
const WEEKDAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']

const ACCENT = '#4F46E5' // indigo-600, matches the app's existing accent

const CHIP_BASE =
  'inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold transition duration-150 font-sans active:scale-[0.94]'
const CHIP_OFF = `${CHIP_BASE} bg-slate-100 text-slate-600 hover:bg-slate-200`
const CHIP_ON = `${CHIP_BASE} bg-indigo-600 text-white hover:bg-indigo-700`

function Chip({ flipKey, active, open, onClick, onClear, chevron, children }) {
  return (
    <button type="button" data-flip-key={flipKey} onClick={onClick} className={active ? CHIP_ON : CHIP_OFF}>
      {active && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Сбросить"
          onClick={(e) => { e.stopPropagation(); onClear() }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onClear() } }}
          className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full hover:bg-white/20 animate-[chipPopIn_180ms_cubic-bezier(.34,1.56,.64,1)]"
        >
          <X size={11} />
        </span>
      )}
      {children}
      {!active && chevron && (
        <ChevronDown size={13} className={`opacity-50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      )}
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

function Radio({ active }) {
  return (
    <span
      className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-[1.5px]"
      style={{ borderColor: active ? ACCENT : '#cbd5e1' }}
    >
      {active && <span className="h-2 w-2 rounded-full" style={{ background: ACCENT }} />}
    </span>
  )
}

export default function FinanceFilterBar({
  from, to, onDateChange,
  direction, onDirectionChange,
  eventType, onEventTypeChange,
  expenseCategory, onExpenseCategoryChange,
  minAmount, maxAmount, onAmountChange,
  userSearch, onUserChange, userOptions = [],
  orderSearch, onOrderChange, orderOptions = [],
  action = null,
}) {
  const [sheet, setSheet] = useState(null) // null | 'period' | 'type' | 'amount' | 'user' | 'order'
  const [draft, setDraft] = useState({})
  const [monthCount, setMonthCount] = useState(2)

  function openSheet(kind) {
    if (kind === 'period') {
      setDraft({ from, to, fromTxt: formatDMY(from), toTxt: formatDMY(to) })
      setMonthCount(2)
    } else if (kind === 'type') {
      setDraft({ value: eventType, category: expenseCategory })
    } else if (kind === 'amount') {
      setDraft({ min: minAmount, max: maxAmount })
    } else if (kind === 'user') {
      setDraft({ q: '', sel: userSearch })
    } else if (kind === 'order') {
      setDraft({ q: '', sel: orderSearch })
    }
    setSheet(kind)
  }
  function closeSheet() { setSheet(null); setDraft({}) }
  function patchDraft(patch) { setDraft((d) => ({ ...d, ...patch })) }

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

  const baseMonth = useMemo(() => startOfMonth(fromYMD(from) ?? fromYMD(to) ?? addMonths(new Date(), -1)), [from, to])
  const months = useMemo(() => Array.from({ length: monthCount }, (_, i) => addMonths(baseMonth, i)), [baseMonth, monthCount])

  const scopedTypeOptions = useMemo(() => {
    const income = EVENT_TYPE_OPTIONS.filter((o) => INCOME_EVENT_TYPES.has(o.value))
    const expense = EVENT_TYPE_OPTIONS.filter((o) => EXPENSE_EVENT_TYPES.has(o.value))
    return { income, expense }
  }, [])

  const selectedTypeLabel = eventType === 'business_expense' && expenseCategory
    ? `Расход · ${EXPENSE_CATEGORY_LABEL[expenseCategory] ?? expenseCategory}`
    : EVENT_TYPE_OPTIONS.find((o) => o.value === eventType)?.label

  const userMatches = useMemo(() => {
    const q = (draft.q || '').toLowerCase()
    return userOptions.filter((o) => !q || o.label.toLowerCase().includes(q))
  }, [userOptions, draft.q])
  const orderMatches = useMemo(() => {
    const q = (draft.q || '').toLowerCase()
    return orderOptions.filter((o) => !q || o.label.toLowerCase().includes(q))
  }, [orderOptions, draft.q])

  function applySheet() {
    if (sheet === 'period') {
      if (!draft.from) { closeSheet(); return }
      onDateChange({ from: draft.from, to: draft.to || draft.from })
    } else if (sheet === 'type') {
      onEventTypeChange(draft.value || '')
      onExpenseCategoryChange(draft.value === 'business_expense' ? (draft.category || '') : '')
    } else if (sheet === 'amount') {
      onAmountChange(draft.min || '', draft.max || '')
    } else if (sheet === 'user') {
      onUserChange(draft.sel || '')
    } else if (sheet === 'order') {
      onOrderChange(draft.sel || '')
    }
    closeSheet()
  }

  const ctaLabel = (() => {
    if (sheet === 'period') {
      if (!draft.from) return 'Выберите даты'
      const toTxt = draft.to && draft.to !== draft.from ? ` – ${formatHuman(draft.to)}` : ''
      return `Показать результаты — ${formatHuman(draft.from)}${toTxt}`
    }
    if ((sheet === 'user' || sheet === 'order') && draft.sel) return `Выбрать — ${draft.sel}`
    return 'Готово'
  })()

  const CTA = (
    <button
      type="button"
      onClick={applySheet}
      className="flex h-[50px] w-full items-center justify-center rounded-full bg-indigo-600 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(79,70,229,.28)] transition-colors hover:bg-indigo-700"
    >
      {ctaLabel}
    </button>
  )

  const amountOn = Boolean(minAmount || maxAmount)

  // "This month" is the neutral default range (chip shows just the month
  // name, no ✕). Any other range — a preset or a custom pick — counts as an
  // active filter: raw dates (or the matched preset's label) + ✕ to clear
  // back to the current month.
  const thisMonthRange = useMemo(() => {
    const now = new Date()
    return { from: toYMD(startOfMonth(now)), to: toYMD(now) }
  }, [])
  const isThisMonth = Boolean(from) && from === thisMonthRange.from && (to || from) === thisMonthRange.to
  const periodActive = Boolean(from) && !isThisMonth
  const periodLabel = useMemo(() => {
    if (!from) return 'Период'
    if (isThisMonth) return formatMonthName(from)
    const matched = DATE_PRESETS.find((preset) => {
      const range = preset.get()
      return range.from === from && range.to === (to || from)
    })
    if (matched) return matched.label
    return `${formatDMY(from)} — ${formatDMY(to || from)}`
  }, [from, to, isThisMonth])

  // Active filters bubble to the front of the chip row, in the order they
  // were set, right after the (always-pinned) Период chip.
  const activationOrderRef = useRef({})
  const activationCounterRef = useRef(0)
  const isFilterActive = {
    income: direction === 'income',
    expense: direction === 'expense',
    type: Boolean(eventType),
    amount: amountOn,
    user: Boolean(userSearch),
    order: Boolean(orderSearch),
  }
  FILTER_ORDER_KEYS.forEach((key) => {
    if (isFilterActive[key]) {
      if (!activationOrderRef.current[key]) activationOrderRef.current[key] = ++activationCounterRef.current
    } else {
      delete activationOrderRef.current[key]
    }
  })
  const orderedFilterKeys = useMemo(() => (
    [...FILTER_ORDER_KEYS].sort((a, b) => {
      const orderA = activationOrderRef.current[a]
      const orderB = activationOrderRef.current[b]
      if (orderA && orderB) return orderA - orderB
      if (orderA) return -1
      if (orderB) return 1
      return FILTER_ORDER_KEYS.indexOf(a) - FILTER_ORDER_KEYS.indexOf(b)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [isFilterActive.income, isFilterActive.expense, isFilterActive.type, isFilterActive.amount, isFilterActive.user, isFilterActive.order])

  // FLIP: when a chip's position shifts (bubbling to the front, or a
  // neighbor's label changing width), slide it from its old spot into the
  // new one instead of snapping — same idea for every chip keyed with
  // data-flip-key below.
  const rowRef = useRef(null)
  const flipRectsRef = useRef(new Map())
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const nodes = Array.from(row.querySelectorAll('[data-flip-key]'))
    const nextRects = new Map()
    nodes.forEach((node) => nextRects.set(node.getAttribute('data-flip-key'), node.getBoundingClientRect()))

    const toAnimate = []
    nodes.forEach((node) => {
      const key = node.getAttribute('data-flip-key')
      const prev = flipRectsRef.current.get(key)
      const next = nextRects.get(key)
      if (!prev || !next) return
      const dx = prev.left - next.left
      if (Math.abs(dx) < 1) return
      node.style.transition = 'none'
      node.style.transform = `translateX(${dx}px)`
      toAnimate.push(node)
    })

    if (toAnimate.length) {
      void row.offsetWidth // force reflow so the "from" transform above commits before animating
      requestAnimationFrame(() => {
        toAnimate.forEach((node) => {
          node.style.transition = 'transform 320ms cubic-bezier(.22,1,.36,1)'
          node.style.transform = ''
        })
      })
    }

    flipRectsRef.current = nextRects
  })

  return (
    <div className="relative">
      <div ref={rowRef} className="scrollbar-none -mx-5 flex flex-nowrap items-center gap-2 overflow-x-auto px-5 py-[5px]">
        {action}

        <Chip flipKey="period" active={periodActive} open={sheet === 'period'} onClick={() => openSheet('period')} onClear={() => onDateChange(thisMonthRange)} chevron>
          {periodLabel}
        </Chip>

        {orderedFilterKeys.map((key) => {
          if (key === 'income' || key === 'expense') {
            return (
              <Chip
                key={key}
                flipKey={key}
                active={direction === key}
                onClick={() => onDirectionChange(direction === key ? '' : key)}
                onClear={() => onDirectionChange('')}
              >
                {key === 'income' ? 'Пополнение' : 'Списание'}
              </Chip>
            )
          }
          if (key === 'type') {
            return (
              <Chip key={key} flipKey="type" active={Boolean(eventType)} open={sheet === 'type'} onClick={() => openSheet('type')} onClear={() => { onEventTypeChange(''); onExpenseCategoryChange('') }} chevron>
                {eventType ? selectedTypeLabel : 'Тип операции'}
              </Chip>
            )
          }
          if (key === 'amount') {
            return (
              <Chip key={key} flipKey="amount" active={amountOn} open={sheet === 'amount'} onClick={() => openSheet('amount')} onClear={() => onAmountChange('', '')} chevron>
                {amountOn ? (minAmount && maxAmount ? `${minAmount}–${maxAmount}` : minAmount ? `от ${minAmount}` : `до ${maxAmount}`) : 'Сумма'}
              </Chip>
            )
          }
          if (key === 'user') {
            return (
              <Chip key={key} flipKey="user" active={Boolean(userSearch)} open={sheet === 'user'} onClick={() => openSheet('user')} onClear={() => onUserChange('')} chevron>
                {userSearch || 'Пользователь'}
              </Chip>
            )
          }
          return (
            <Chip key={key} flipKey="order" active={Boolean(orderSearch)} open={sheet === 'order'} onClick={() => openSheet('order')} onClear={() => onOrderChange('')} chevron>
              {orderSearch || 'Заказ'}
            </Chip>
          )
        })}
      </div>

      <BottomSheet open={sheet === 'period'} onClose={closeSheet} title="Выбор периода" footer={CTA}>
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
        {months.map((month, i) => (
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

      <BottomSheet open={sheet === 'type'} onClose={closeSheet} title="Тип операции" footer={CTA}>
        <TypeRow label="Все типы" active={!draft.value} onClick={() => patchDraft({ value: '', category: '' })} />
        {direction !== 'expense' && (
          <TypeGroup title="Пополнение" options={scopedTypeOptions.income} selected={draft.value} onPick={(v) => patchDraft({ value: v, category: '' })} />
        )}
        {direction !== 'income' && (
          <TypeGroup
            title="Списание"
            options={scopedTypeOptions.expense}
            selected={draft.value}
            selectedCategory={draft.category}
            onPick={(v) => patchDraft({ value: v, category: '' })}
            onPickCategory={(c) => patchDraft({ value: 'business_expense', category: c })}
          />
        )}
      </BottomSheet>

      <BottomSheet open={sheet === 'amount'} onClose={closeSheet} title="Сумма в сомони" footer={CTA}>
        <div className="grid grid-cols-2 gap-6 py-3.5">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-400">От</span>
            <input
              type="number" min="0" step="0.01" placeholder="0"
              value={draft.min ?? ''} onChange={(e) => patchDraft({ min: e.target.value })}
              className="w-full border-0 border-b-2 border-slate-200 bg-transparent py-1 text-[22px] font-bold text-slate-900 outline-none focus:border-indigo-400"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-400">До</span>
            <input
              type="number" min="0" step="0.01" placeholder="∞"
              value={draft.max ?? ''} onChange={(e) => patchDraft({ max: e.target.value })}
              className="w-full border-0 border-b-2 border-slate-200 bg-transparent py-1 text-[22px] font-bold text-slate-900 outline-none focus:border-indigo-400"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {AMOUNT_PRESETS.map((preset) => {
            const active = (draft.min || '') === preset.min && (draft.max || '') === preset.max
            return (
              <PresetPill key={preset.label} active={active} onClick={() => patchDraft({ min: preset.min, max: preset.max })}>
                {preset.label}
              </PresetPill>
            )
          })}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'user'} onClose={closeSheet} title="Пользователь" footer={CTA}>
        <SearchPickerList q={draft.q ?? ''} onQ={(v) => patchDraft({ q: v })} placeholder="Имя сотрудника…" matches={userMatches} selected={draft.sel} onPick={(label) => patchDraft({ sel: draft.sel === label ? '' : label })} />
      </BottomSheet>

      <BottomSheet open={sheet === 'order'} onClose={closeSheet} title="Заказ" footer={CTA}>
        <SearchPickerList q={draft.q ?? ''} onQ={(v) => patchDraft({ q: v })} placeholder="Номер заказа…" matches={orderMatches} selected={draft.sel} onPick={(label) => patchDraft({ sel: draft.sel === label ? '' : label })} />
      </BottomSheet>
    </div>
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

function TypeRow({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition-colors ${active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}
    >
      <Radio active={active} />
      {label}
    </button>
  )
}

function TypeGroup({ title, options, selected, selectedCategory, onPick, onPickCategory }) {
  return (
    <div className="mb-1.5">
      <p className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</p>
      {options.map((o) => (
        o.value === 'business_expense' ? (
          <ExpenseTypeGroup
            key={o.value}
            label={o.label}
            active={selected === o.value}
            selectedCategory={selectedCategory}
            onPick={() => onPick(o.value)}
            onPickCategory={onPickCategory}
          />
        ) : (
          <TypeRow key={o.value} label={o.label} active={selected === o.value} onClick={() => onPick(o.value)} />
        )
      ))}
    </div>
  )
}

// "Расход" plus its category sub-rows (Расход · Маркетинг, Расход · Налоги, …),
// indented under the parent row. Picking "Расход" itself means "all categories".
function ExpenseTypeGroup({ label, active, selectedCategory, onPick, onPickCategory }) {
  return (
    <div>
      <TypeRow label={label} active={active && !selectedCategory} onClick={onPick} />
      <div className="ml-4 border-l border-slate-100 pl-2.5">
        {EXPENSE_CATEGORY_OPTIONS.map((c) => (
          <TypeRow
            key={c.value}
            label={c.label}
            active={active && selectedCategory === c.value}
            onClick={() => onPickCategory(c.value)}
          />
        ))}
      </div>
    </div>
  )
}

function SearchPickerList({ q, onQ, placeholder, matches, selected, onPick }) {
  return (
    <>
      <div className="relative mb-2 mt-1.5">
        <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder={placeholder}
          className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:bg-white"
        />
      </div>
      {matches.map((item) => {
        const active = selected === item.label
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.label)}
            className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors ${active ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
          >
            <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[12px] font-bold text-indigo-700">
              {item.label.slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-slate-900">{item.label}</span>
            {active && <span className="flex-shrink-0 text-indigo-600">✓</span>}
          </button>
        )
      })}
      {matches.length === 0 && <p className="my-3 text-center text-[12.5px] text-slate-400">Ничего не найдено</p>}
    </>
  )
}
