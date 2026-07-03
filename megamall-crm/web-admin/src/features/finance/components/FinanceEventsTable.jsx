/**
 * FinanceEventsTable — paginated financial event ledger for the owner.
 *
 * Uses GET /finance/events (all event types including company_revenue_earned).
 *
 * Features:
 *   - event_type, order_id, user_id, amount range filters
 *   - pagination (prev/next + page indicator)
 *   - desktop table + mobile card stack
 *
 * Props:
 *   from     {string}  YYYY-MM-DD
 *   to       {string}  YYYY-MM-DD
 *   action   {ReactNode} optional header action
 */
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, RotateCcw, Pencil } from 'lucide-react'
import EditFinanceExpenseModal from './EditFinanceExpenseModal'
import Badge              from '../../../shared/components/Badge'
import EmptyState         from '../../../shared/components/EmptyState'
import { CardSkeleton }   from '../../../shared/components/Skeleton'
import useEmployees       from '../../people/hooks/useEmployees'
import { buildUserMap, userName } from '../../people/utils/peopleHelpers'
import useOwnerOrders     from '../../orders/hooks/useOwnerOrders'
import { formatOrderLabel, getOrderId } from '../../dispatcher/utils/orderHelpers'
import useFinanceEvents   from '../hooks/useFinanceEvents'
import {
  fmtMoney,
  fmtDateTime,
  EVENT_TYPE_LABEL,
  EVENT_TYPE_BADGE,
} from '../../hr/utils/hrHelpers'

// Finance-specific event type options for the filter dropdown
const EVENT_TYPE_OPTIONS = [
  { value: '',                                    label: 'Все типы' },
  { value: 'company_revenue_earned',              label: 'Доход компании' },
  { value: 'company_revenue_confirmed',           label: 'Доход компании подтвержден' },
  { value: 'seller_commission_earned',            label: 'Комиссия продавца' },
  { value: 'seller_commission_confirmed',         label: 'Комиссия продавца подтверждена' },
  { value: 'seller_commission_cancelled',         label: 'Комиссия продавца отменена' },
  { value: 'manager_personal_commission_earned',  label: 'Комиссия менеджера (личная)' },
  { value: 'manager_personal_commission_confirmed', label: 'Комиссия менеджера (личная) подтверждена' },
  { value: 'manager_team_commission_earned',      label: 'Комиссия менеджера (команда)' },
  { value: 'manager_team_commission_confirmed',   label: 'Комиссия менеджера (команда) подтверждена' },
  { value: 'team_lead_pool_earned',               label: 'Пул руководителя' },
  { value: 'team_lead_pool_confirmed',            label: 'Пул руководителя подтвержден' },
  { value: 'courier_fee_earned',                  label: 'Доставка курьеру' },
  { value: 'courier_fee_confirmed',               label: 'Доставка курьеру подтверждена' },
  { value: 'cash_collected',                      label: 'Наличные собраны' },
  { value: 'cash_handed_over',                    label: 'Наличные сданы' },
  { value: 'business_expense',                    label: 'Расход' },
  { value: 'team_lead_payout',                    label: 'Выплата · Тимлид → Менеджер' },
  { value: 'manager_payout',                      label: 'Выплата · Менеджер → Продавец' },
  { value: 'owner_payout',                        label: 'Выплата · Владелец' },
]

// Payout rows are auto-reconciled from the payouts ledger (never hand-typed),
// business_expense is the only manually-entered row — the tag makes that
// distinction visible without the user opening each row.
const PAYOUT_EVENT_TYPES = new Set(['team_lead_payout', 'manager_payout', 'owner_payout'])
const PAYER_ROLE_LABEL = { sales_team_lead: 'тимлид', manager: 'менеджер', owner: 'владелец' }

function ReconciliationTag({ eventType }) {
  if (eventType === 'business_expense') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
        Вручную
      </span>
    )
  }
  if (PAYOUT_EVENT_TYPES.has(eventType)) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600">
        Авто
      </span>
    )
  }
  return null
}

const PAGE_LIMIT = 20

function EditedMarker({ event }) {
  if (!event?.is_edited) return null
  const edits = Number(event.edit_count || 0)
  const title = event.last_edited_at
    ? `Изменено ${fmtDateTime(event.last_edited_at)}`
    : 'Изменено'

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50/90 px-2 py-0.5 text-[10px] font-bold leading-4 text-amber-700 shadow-[0_1px_0_rgba(245,158,11,.08)]"
      title={title}
    >
      <Pencil size={10} />
      Изменено{edits > 1 ? ` ${edits}` : ''}
    </span>
  )
}

function AmountRangeFilter({ minAmount, maxAmount, onMinChange, onMaxChange }) {
  return (
    <div className="flex h-9 w-[210px] flex-shrink-0 items-center rounded-full border border-slate-200 bg-white px-3 text-xs text-slate-500">
      <span className="mr-2 font-semibold text-slate-500">Сумма</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={minAmount}
        onChange={(e) => onMinChange(e.target.value)}
        placeholder="от"
        className="h-7 w-[54px] bg-transparent text-center font-semibold text-slate-800 outline-none placeholder:text-slate-400"
        aria-label="Сумма от"
      />
      <span className="mx-1 h-4 w-px bg-slate-200" />
      <input
        type="number"
        min="0"
        step="0.01"
        value={maxAmount}
        onChange={(e) => onMaxChange(e.target.value)}
        placeholder="до"
        className="h-7 w-[54px] bg-transparent text-center font-semibold text-slate-800 outline-none placeholder:text-slate-400"
        aria-label="Сумма до"
      />
    </div>
  )
}

export default function FinanceEventsTable({ from, to, action = null, onExpenseEdited }) {
  const [editExpense, setEditExpense] = useState(null)
  const [eventType, setEventType] = useState('')
  const [orderSearch, setOrderSearch] = useState('')
  const [userSearch,  setUserSearch]  = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [page,      setPage]      = useState(1)

  function updateFilter(setter) {
    return (e) => {
      setter(e.target.value)
      setPage(1)
    }
  }

  function updateAmountFilter(setter) {
    return (value) => {
      setter(value)
      setPage(1)
    }
  }

  function resetFilters() {
    setEventType('')
    setOrderSearch('')
    setUserSearch('')
    setMinAmount('')
    setMaxAmount('')
    setPage(1)
  }

  const { data: employees = [] } = useEmployees()
  const { items: orders = [] } = useOwnerOrders({ from, to, page: 1, limit: 500 })
  const userMap    = buildUserMap(employees)
  const orderMap   = useMemo(() => {
    const map = {}
    orders.forEach((order) => {
      const id = getOrderId(order)
      if (id) map[id] = order
    })
    return map
  }, [orders])
  const shortId = (id) => id ? `${id.slice(0, 8)}…` : '—'
  const orderOptionLabel = (order) => {
    const customer = order.customer_name ?? order.CustomerName ?? order.customer?.full_name ?? order.Customer?.FullName
    return customer ? `${formatOrderLabel(order)} · ${customer}` : formatOrderLabel(order)
  }
  const orderOptions = useMemo(() => orders
    .map((order) => {
      const id = getOrderId(order)
      if (!id) return null
      return { id, label: orderOptionLabel(order) }
    })
    .filter(Boolean), [orders])
  const userOptions = useMemo(() => employees.map((user) => ({
    id: user.id,
    label: user.full_name ?? user.FullName ?? user.phone ?? user.id,
  })).filter((user) => user.id), [employees])
  const selectedOrder = orderOptions.find((order) => order.label === orderSearch || order.id === orderSearch.trim())
  const selectedUser = userOptions.find((user) => user.label === userSearch || user.id === userSearch.trim())
  const hasFilters = Boolean(eventType || orderSearch || userSearch || minAmount || maxAmount)

  const params = {
    from,
    to,
    event_type: eventType || undefined,
    order_id: selectedOrder?.id,
    user_id: selectedUser?.id,
    min_amount: minAmount === '' ? undefined : minAmount,
    max_amount: maxAmount === '' ? undefined : maxAmount,
    page,
    limit: PAGE_LIMIT,
  }
  const { data, isLoading, isFetching } = useFinanceEvents(params)

  const items     = data?.items  ?? []
  const meta      = data?.meta   ?? null
  const totalPages = meta?.total_pages ?? 1
  const total      = meta?.total       ?? 0
  const isMuted    = isFetching && !isLoading  // page transition, show old data dimmed
  const resolveUserName = (id) => {
    const name = userName(userMap, id)
    return name === '—' ? shortId(id) : name
  }
  const resolveOrderLabel = (id) => {
    const order = orderMap[id]
    return order ? formatOrderLabel(order) : shortId(id)
  }
  const normalizedOrderSearch = orderSearch.trim().toLowerCase()
  const normalizedUserSearch = userSearch.trim().toLowerCase()
  const visibleItems = items.filter((ev) => {
    const order = orderMap[ev.order_id]
    const orderText = [
      ev.order_id,
      resolveOrderLabel(ev.order_id),
      order ? orderOptionLabel(order) : '',
    ].filter(Boolean).join(' ').toLowerCase()
    const userText = [
      ev.user_id,
      resolveUserName(ev.user_id),
    ].filter(Boolean).join(' ').toLowerCase()

    return (!normalizedOrderSearch || orderText.includes(normalizedOrderSearch)) &&
      (!normalizedUserSearch || userText.includes(normalizedUserSearch))
  })

  return (
    <div className="space-y-4">
      {/* Header row: title + filter */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">
            Журнал начислений
            {total > 0 && (
              <span className="ml-2 text-xs font-normal text-slate-400">· {total} событий</span>
            )}
          </h3>
        </div>
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto py-1">
          {action}
          <select
            value={eventType}
            onChange={updateFilter(setEventType)}
            className="input h-9 w-auto min-w-[180px] py-0 pr-8 text-xs"
          >
            {EVENT_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input
            type="search"
            value={orderSearch}
            onChange={updateFilter(setOrderSearch)}
            placeholder="Поиск заказа"
            className="input h-9 w-[170px] py-0 text-xs"
          />
          <input
            type="search"
            value={userSearch}
            onChange={updateFilter(setUserSearch)}
            placeholder="Поиск пользователя"
            className="input h-9 w-[180px] py-0 text-xs"
          />
          <AmountRangeFilter
            minAmount={minAmount}
            maxAmount={maxAmount}
            onMinChange={updateAmountFilter(setMinAmount)}
            onMaxChange={updateAmountFilter(setMaxAmount)}
          />
          {hasFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
              title="Сбросить фильтры"
              aria-label="Сбросить фильтры"
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : visibleItems.length === 0 ? (
        <EmptyState
          icon={<FileText size={22} />}
          title="Нет событий"
          description="За выбранный период и фильтр событий нет"
        />
      ) : (
        <div className={isMuted ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="py-2.5 pr-3 text-left font-semibold">Тип события</th>
                  <th className="py-2.5 pr-3 text-left font-semibold">Заказ / пользователь</th>
                  <th className="py-2.5 pr-3 text-right font-semibold">Сумма</th>
                  <th className="py-2.5 text-right font-semibold">Дата</th>
                  <th className="py-2.5 pl-2 text-right font-semibold">Действие</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((ev, i) => (
                  <tr
                    key={ev.id ?? i}
                    className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant={EVENT_TYPE_BADGE[ev.event_type] ?? 'slate'} size="sm">
                          {EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type}
                        </Badge>
                        <ReconciliationTag eventType={ev.event_type} />
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {ev.order_id
                          ? (
                            <p className="text-xs text-slate-600">
                              <span className="text-slate-400">Заказ:</span>{' '}
                              <span className="font-medium">{resolveOrderLabel(ev.order_id)}</span>
                            </p>
                          )
                          : ev.note
                            ? <p className="max-w-[260px] truncate text-xs text-slate-500">{ev.note}</p>
                            : <p className="text-xs text-slate-400">—</p>
                        }
                        <EditedMarker event={ev} />
                      </div>
                      {ev.user_id && (
                        <p className="text-[10px] text-slate-400">
                          Пользователь: <span className="font-medium text-slate-500">{resolveUserName(ev.user_id)}</span>
                        </p>
                      )}
                      {ev.payer_id && (
                        <p className="text-[10px] text-slate-400">
                          от <span className="font-medium text-slate-500">{resolveUserName(ev.payer_id)}</span>
                          {ev.payer_role && ` (${PAYER_ROLE_LABEL[ev.payer_role] ?? ev.payer_role})`}
                        </p>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <span className="font-bold text-slate-900 tabular-nums">{fmtMoney(ev.amount)}</span>
                    </td>
                    <td className="py-2.5 text-right text-xs text-slate-400 whitespace-nowrap">
                      {fmtDateTime(ev.created_at)}
                    </td>
                    <td className="py-2.5 pl-2 text-right">
                      {ev.event_type === 'business_expense' && (
                        <button
                          onClick={() => setEditExpense({ id: ev.id, amount: ev.amount, note: ev.note ?? '', expense_category: ev.expense_category ?? 'other' })}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-indigo-100 flex items-center justify-center text-slate-400 hover:text-indigo-600 transition-colors"
                          title="Редактировать"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {visibleItems.map((ev, i) => (
              <div key={ev.id ?? i} className="card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant={EVENT_TYPE_BADGE[ev.event_type] ?? 'slate'} size="sm">
                      {EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type}
                    </Badge>
                    <ReconciliationTag eventType={ev.event_type} />
                  </div>
                  <span className="font-bold text-slate-900 tabular-nums flex-shrink-0">
                    {fmtMoney(ev.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {ev.order_id ? (
                      <span>
                        Заказ: <span className="font-medium text-slate-500">{resolveOrderLabel(ev.order_id)}</span>
                      </span>
                    ) : (
                      <span className="min-w-0 truncate font-medium text-slate-500">{ev.note || '—'}</span>
                    )}
                    <EditedMarker event={ev} />
                  </div>
                  <span>{fmtDateTime(ev.created_at)}</span>
                </div>
                {ev.user_id && (
                  <p className="text-[11px] text-slate-400">
                    Пользователь: <span className="font-medium text-slate-500">{resolveUserName(ev.user_id)}</span>
                  </p>
                )}
                {ev.payer_id && (
                  <p className="text-[11px] text-slate-400">
                    от <span className="font-medium text-slate-500">{resolveUserName(ev.payer_id)}</span>
                    {ev.payer_role && ` (${PAYER_ROLE_LABEL[ev.payer_role] ?? ev.payer_role})`}
                  </p>
                )}
                {ev.event_type === 'business_expense' && (
                  <div className="pt-1">
                    <button
                      onClick={() => setEditExpense({ id: ev.id, amount: ev.amount, note: ev.note ?? '', expense_category: ev.expense_category ?? 'other' })}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      <Pencil size={11} /> Редактировать
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1 || isFetching}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all min-h-[44px]"
          >
            <ChevronLeft size={14} /> Назад
          </button>

          <span className="text-xs text-slate-500">
            Стр. {page} из {totalPages}
          </span>

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || isFetching}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all min-h-[44px]"
          >
            Вперёд <ChevronRight size={14} />
          </button>
        </div>
      )}

      <EditFinanceExpenseModal
        expense={editExpense}
        onClose={() => setEditExpense(null)}
        onSuccess={() => {
          onExpenseEdited?.()
          setEditExpense(null)
        }}
      />
    </div>
  )
}
