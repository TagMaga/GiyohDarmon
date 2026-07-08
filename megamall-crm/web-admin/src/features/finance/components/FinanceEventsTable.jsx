/**
 * FinanceEventsTable — paginated financial event ledger for the owner.
 *
 * Uses GET /finance/events (all event types including company_revenue_earned).
 *
 * Features:
 *   - event_type, order_id, user_id, amount range, and date filters (via
 *     FinanceFilterBar's chip-row + bottom-sheet pattern)
 *   - Расходы/Доходы summary stat cards with a donut indicator (mobile)
 *   - pagination (prev/next + page indicator)
 *   - desktop table + mobile card stack, grouped by day on mobile
 *
 * Props:
 *   from          {string}    YYYY-MM-DD
 *   to            {string}    YYYY-MM-DD
 *   onDateChange  {(next:{from,to}) => void}  drives the Период chip
 *   action        {ReactNode} optional header action
 */
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, Pencil, Undo2 } from 'lucide-react'
import EditFinanceExpenseModal   from './EditFinanceExpenseModal'
import VoidPayoutModal           from './VoidPayoutModal'
import FinanceFilterBar          from './FinanceFilterBar'
import Alert              from '../../../shared/components/Alert'
import Badge              from '../../../shared/components/Badge'
import EmptyState         from '../../../shared/components/EmptyState'
import { CardSkeleton }   from '../../../shared/components/Skeleton'
import useEmployees       from '../../people/hooks/useEmployees'
import { buildUserMap, userName } from '../../people/utils/peopleHelpers'
import useOwnerOrders     from '../../orders/hooks/useOwnerOrders'
import { formatOrderLabel, getOrderId } from '../../dispatcher/utils/orderHelpers'
import useFinanceEvents   from '../hooks/useFinanceEvents'
import useFinanceEventTotals from '../hooks/useFinanceEventTotals'
import {
  fmtMoney,
  fmtDateTime,
  EVENT_TYPE_LABEL,
  EVENT_TYPE_BADGE,
  INCOME_EVENT_TYPES,
  EXPENSE_EVENT_TYPES,
} from '../../hr/utils/hrHelpers'

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

function RowActions({ ev, onEdit, onVoid }) {
  if (ev.event_type === 'business_expense') {
    return (
      <button
        type="button"
        onClick={() => onEdit(ev)}
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-colors hover:bg-indigo-100 hover:text-indigo-600"
        title="Редактировать"
      >
        <Pencil size={11} />
      </button>
    )
  }
  if (PAYOUT_EVENT_TYPES.has(ev.event_type)) {
    return (
      <button
        type="button"
        onClick={() => onVoid(ev)}
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-colors hover:bg-rose-100 hover:text-rose-600"
        title="Отменить выплату"
      >
        <Undo2 size={11} />
      </button>
    )
  }
  return null
}

function DonutRing({ pct, color }) {
  return (
    <div
      className="relative h-11 w-11 flex-shrink-0 rounded-full"
      style={{ background: `conic-gradient(${color} 0% ${pct}%, #e2e8f0 ${pct}% 100%)` }}
    >
      <div className="absolute inset-[4px] rounded-full bg-white" />
    </div>
  )
}

function StatCard({ label, value, pct, color }) {
  return (
    <div className="flex items-center justify-between gap-2.5 rounded-[18px] border border-slate-100 bg-white p-3.5 shadow-sm">
      <div className="min-w-0">
        <p className="text-[12.5px] text-slate-500">{label}</p>
        <p className="mt-0.5 truncate text-[17px] font-extrabold text-slate-900">{value}</p>
      </div>
      <DonutRing pct={pct} color={color} />
    </div>
  )
}

function dayKey(iso) {
  return iso ? iso.slice(0, 10) : 'unknown'
}

function dayLabel(iso) {
  if (!iso) return 'Без даты'
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  if (sameDay(date, today)) return 'Сегодня'
  if (sameDay(date, yesterday)) return 'Вчера'
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  })
}

export default function FinanceEventsTable({ from, to, onDateChange, action = null, onExpenseEdited }) {
  const [editExpense, setEditExpense] = useState(null)
  const [voidTarget, setVoidTarget] = useState(null)
  const [direction, setDirection] = useState('') // '' | 'income' | 'expense'
  const [eventType, setEventType] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('') // only meaningful when eventType === 'business_expense'
  const [orderSearch, setOrderSearch] = useState('')
  const [userSearch,  setUserSearch]  = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [page,      setPage]      = useState(1)

  function updateDirection(next) {
    setDirection(next)
    setEventType((current) => {
      if (!current) return current
      const groupSet = next === 'income' ? INCOME_EVENT_TYPES : next === 'expense' ? EXPENSE_EVENT_TYPES : null
      const cleared = groupSet && !groupSet.has(current)
      if (cleared) setExpenseCategory('')
      return cleared ? '' : current
    })
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
  const { data, isLoading, isFetching, isError, error, refetch } = useFinanceEvents(params)

  // Independent fetch just for the Расходы/Доходы stat cards — pages through
  // the full (filtered) result set (the backend caps any single page at 100
  // rows) rather than relying on the current page of `items` above. Mirrors
  // every active filter so the cards match what the table shows.
  const { data: totalsAgg, isLoading: totalsLoading } = useFinanceEventTotals({
    ...params,
    direction: direction || undefined,
    expenseCategory: expenseCategory || undefined,
  })
  const incomeTotal = totalsAgg?.income ?? 0
  const expenseTotal = totalsAgg?.expense ?? 0
  const totalsSum = incomeTotal + expenseTotal
  const incomePct = totalsSum ? Math.round((incomeTotal / totalsSum) * 100) : 0
  const expensePct = totalsSum ? Math.round((expenseTotal / totalsSum) * 100) : 0

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

    const directionGroup = direction === 'income' ? INCOME_EVENT_TYPES : direction === 'expense' ? EXPENSE_EVENT_TYPES : null
    const matchesDirection = !directionGroup || directionGroup.has(ev.event_type)
    const matchesCategory = !expenseCategory || ev.expense_category === expenseCategory

    return matchesDirection && matchesCategory &&
      (!normalizedOrderSearch || orderText.includes(normalizedOrderSearch)) &&
      (!normalizedUserSearch || userText.includes(normalizedUserSearch))
  })

  const groupedItems = useMemo(() => {
    const groups = []
    const indexByKey = new Map()
    visibleItems.forEach((ev) => {
      const key = dayKey(ev.created_at)
      if (!indexByKey.has(key)) {
        indexByKey.set(key, groups.length)
        groups.push({ key, title: dayLabel(ev.created_at), items: [] })
      }
      groups[indexByKey.get(key)].items.push(ev)
    })
    return groups
  }, [visibleItems])

  const openEdit = (ev) => setEditExpense({ id: ev.id, amount: ev.amount, note: ev.note ?? '', expense_category: ev.expense_category ?? 'other' })
  const openVoid = (ev) => setVoidTarget({ id: ev.id, amount: ev.amount, created_at: ev.created_at })

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

        <FinanceFilterBar
          action={action}
          from={from}
          to={to}
          onDateChange={({ from: nextFrom, to: nextTo }) => { onDateChange?.({ from: nextFrom, to: nextTo }); setPage(1) }}
          direction={direction}
          onDirectionChange={updateDirection}
          eventType={eventType}
          onEventTypeChange={(value) => { setEventType(value); setPage(1) }}
          expenseCategory={expenseCategory}
          onExpenseCategoryChange={(value) => { setExpenseCategory(value); setPage(1) }}
          minAmount={minAmount}
          maxAmount={maxAmount}
          onAmountChange={(min, max) => { setMinAmount(min); setMaxAmount(max); setPage(1) }}
          userSearch={userSearch}
          onUserChange={(value) => { setUserSearch(value); setPage(1) }}
          userOptions={userOptions}
          orderSearch={orderSearch}
          onOrderChange={(value) => { setOrderSearch(value); setPage(1) }}
          orderOptions={orderOptions}
        />

        {/* Расходы / Доходы summary (mobile only) */}
        {totalsLoading ? (
          <div className="grid grid-cols-2 gap-2.5 sm:hidden">
            {[0, 1].map((i) => <div key={i} className="skeleton h-[72px] rounded-[18px]" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:hidden">
            <StatCard label="Расходы" value={fmtMoney(expenseTotal)} pct={expensePct} color="#e11d48" />
            <StatCard label="Доходы" value={fmtMoney(incomeTotal)} pct={incomePct} color="#10b981" />
          </div>
        )}
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : isError ? (
        <div className="space-y-2">
          <Alert variant="error" title="Не удалось загрузить события">
            {error?.response?.data?.error?.message ?? error?.message ?? 'Проверьте соединение и попробуйте снова.'}
          </Alert>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex h-9 items-center rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200"
          >
            Повторить
          </button>
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
                        <RowActions ev={ev} onEdit={openEdit} onVoid={openVoid} />
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards, grouped by day */}
          <div className="sm:hidden space-y-4">
            {groupedItems.map((group) => (
              <div key={group.key}>
                <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{group.title}</p>
                <div className="space-y-2">
                  {group.items.map((ev, i) => (
                    <div key={ev.id ?? i} className="card p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant={EVENT_TYPE_BADGE[ev.event_type] ?? 'slate'} size="sm">
                            {EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type}
                          </Badge>
                          <ReconciliationTag eventType={ev.event_type} />
                          <RowActions ev={ev} onEdit={openEdit} onVoid={openVoid} />
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
                    </div>
                  ))}
                </div>
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

      <VoidPayoutModal
        payout={voidTarget}
        onClose={() => setVoidTarget(null)}
      />
    </div>
  )
}
