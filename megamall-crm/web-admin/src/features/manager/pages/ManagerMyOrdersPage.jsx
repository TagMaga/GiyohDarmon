/**
 * ManagerMyOrdersPage — /manager/my-orders
 *
 * Orders where the manager acted as the seller (personal orders).
 * Filters: date range, status, search.
 * Extra column: net revenue (commission context).
 */
import { useState, useMemo }        from 'react'
import { useNavigate }              from 'react-router-dom'
import { ClipboardList, RefreshCw, Pencil } from 'lucide-react'
import { Eye, ChevronLeft, ChevronRight } from 'lucide-react'
import Alert                        from '../../../shared/components/Alert'
import Badge                        from '../../../shared/components/Badge'
import EmptyState                   from '../../../shared/components/EmptyState'
import { TableRowSkeleton }         from '../../../shared/components/Skeleton'
import OrderDetailsDrawer           from '../../orders/components/OrderDetailsDrawer'
import TeamOrdersFilters            from '../../team-lead/components/TeamOrdersFilters'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { formatOrderLabel, getOrderId } from '../../dispatcher/utils/orderHelpers'
import useManagerPersonalOrders     from '../hooks/useManagerPersonalOrders'
import useCurrentUser               from '../../../shared/hooks/useCurrentUser'
import useEmployeesByIds            from '../../people/hooks/useEmployeesByIds'
import useTeams                     from '../../people/hooks/useTeams'
import { buildUserMap }             from '../../people/utils/peopleHelpers'

function toYMD(d) { return d.toISOString().slice(0, 10) }
function currentMonthDefault() {
  const now = new Date()
  return { from: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), to: toYMD(now) }
}

function field(o, ...keys) {
  for (const k of keys) if (o[k] != null) return o[k]
  return null
}

const HEADERS = ['№', 'Клиент', 'Товар', 'Сумма', 'Чистая выручка', 'Статус', 'Дата', '']
const EDITABLE_STATUSES = new Set(['new', 'confirmed', 'assigned'])

function DesktopRow({ order, onView, onEdit }) {
  const name    = field(order,'customer_name','CustomerName') ?? order.customer?.full_name ?? '—'
  const product = field(order,'product_name','ProductName') ?? order.product?.name ?? '—'
  const status  = order.status ?? order.Status ?? ''
  const amount  = field(order,'total_order_amount','total_amount','amount','total') ?? 0
  const net     = Number(field(order,'net_revenue','NetRevenue') ?? 0)
  const canEdit = EDITABLE_STATUSES.has(status)

  return (
    <tr className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
      <td className="px-4 py-3 text-xs font-mono font-semibold text-indigo-700">{formatOrderLabel(order)}</td>
      <td className="px-4 py-3 text-xs text-slate-800 max-w-[120px] truncate">{name}</td>
      <td className="px-4 py-3 text-xs text-slate-700 max-w-[120px] truncate">{product}</td>
      <td className="px-4 py-3 text-xs font-semibold text-slate-800 whitespace-nowrap text-right">{fmtAmount(amount)} сомони</td>
      <td className="px-4 py-3 text-xs font-semibold text-emerald-700 whitespace-nowrap text-right">{fmtAmount(net)} сомони</td>
      <td className="px-4 py-3"><Badge variant={STATUS_BADGE[status]??'slate'} size="sm">{STATUS_LABELS[status]??status}</Badge></td>
      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{fmtDate(order.created_at??order.CreatedAt)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          {canEdit && (
            <button onClick={() => onEdit(order)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 text-[11px] font-semibold transition-colors min-h-[32px]">
              <Pencil size={11}/> Изменить
            </button>
          )}
          <button onClick={() => onView(order)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold transition-colors min-h-[32px]">
            <Eye size={12}/> Открыть
          </button>
        </div>
      </td>
    </tr>
  )
}

function MobileCard({ order, onView, onEdit }) {
  const name    = field(order,'customer_name','CustomerName') ?? order.customer?.full_name ?? '—'
  const status  = order.status ?? order.Status ?? ''
  const amount  = field(order,'total_order_amount','total_amount','amount','total') ?? 0
  const canEdit = EDITABLE_STATUSES.has(status)

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-mono font-bold text-indigo-700">{formatOrderLabel(order)}</p>
          <p className="text-sm font-semibold text-slate-800 mt-0.5">{name}</p>
        </div>
        <Badge variant={STATUS_BADGE[status]??'slate'} size="sm">{STATUS_LABELS[status]??status}</Badge>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-400">{fmtDate(order.created_at??order.CreatedAt)}</span>
        <span className="text-sm font-bold text-slate-800">{fmtAmount(amount)} сомони</span>
      </div>
      <div className="flex gap-2">
        {canEdit && (
          <button onClick={() => onEdit(order)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-semibold transition-colors min-h-[40px]">
            <Pencil size={13}/> Изменить
          </button>
        )}
        <button onClick={() => onView(order)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold transition-colors min-h-[40px]">
          <Eye size={13}/> Подробнее
        </button>
      </div>
    </div>
  )
}

function Pagination({ meta, page, onPage }) {
  if (!meta || meta.total_pages <= 1) return null
  return (
    <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
      <p className="text-xs text-slate-500">{Math.min((page-1)*(meta.limit??25)+1,meta.total)}–{Math.min(page*(meta.limit??25),meta.total)} из {meta.total}</p>
      <div className="flex items-center gap-1">
        <button disabled={page<=1} onClick={()=>onPage(page-1)} className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronLeft size={15}/></button>
        <span className="px-3 text-xs font-semibold text-slate-700">{page} / {meta.total_pages}</span>
        <button disabled={page>=meta.total_pages} onClick={()=>onPage(page+1)} className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronRight size={15}/></button>
      </div>
    </div>
  )
}

// ── Stats summary ─────────────────────────────────────────────────────────────

function PersonalKpiBar({ orders, loading }) {
  const total     = orders.length
  const delivered = orders.filter(o => (o.status??o.Status)==='delivered').length
  const revenue   = orders.filter(o => (o.status??o.Status)==='delivered')
    .reduce((s,o) => s + Number(o.net_revenue ?? 0), 0)
  const conv      = total > 0 ? ((delivered/total)*100).toFixed(0) : '0'

  if (loading) return <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />

  return (
    <div className="card p-4">
      <div className="grid grid-cols-4 gap-4 text-center">
        {[
          { label: 'Всего', value: total },
          { label: 'Доставлено', value: delivered, cls: 'text-emerald-700' },
          { label: 'Выручка', value: `${fmtAmount(revenue)} сомони`, cls: 'text-violet-700' },
          { label: 'Конверсия', value: `${conv}%`, cls: 'text-amber-700' },
        ].map(({ label, value, cls }) => (
          <div key={label}>
            <p className={`text-xl font-bold ${cls ?? 'text-slate-900'}`}>{value}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ManagerMyOrdersPage() {
  const navigate = useNavigate()
  const def = currentMonthDefault()
  const [filters, setFilters] = useState({ from: def.from, to: def.to, page: 1, limit: 25 })
  const [selected, setSelected] = useState(null)

  function handleEdit(order) {
    navigate(`/manager/my-orders/${order.id}/edit`, { state: { order } })
  }

  const { userId } = useCurrentUser()
  const employeeIds = useMemo(() => userId ? [userId] : [], [userId])
  const { data: currentEmployee = [] } = useEmployeesByIds(employeeIds)
  const { data: allTeams = [] }     = useTeams()
  const userMap = useMemo(() => buildUserMap(currentEmployee), [currentEmployee])
  const teamMap = useMemo(() => {
    const m = {}; allTeams.forEach(t => { if (t.id) m[t.id] = t }); return m
  }, [allTeams])

  const { items, meta, allItems, isLoading, allLoading, isError, error, refetch, isFetching } =
    useManagerPersonalOrders(filters)

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-sky-50 flex items-center justify-center text-sky-600 flex-shrink-0">
            <ClipboardList size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Мои личные заказы</h1>
            <p className="text-xs text-slate-400">Заказы, где вы выступили продавцом</p>
          </div>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 transition-all min-h-[44px] flex-shrink-0">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Обновить</span>
        </button>
      </div>

      {isError && (
        <Alert variant="error">{error?.response?.data?.error?.message ?? error?.message ?? 'Ошибка загрузки'}</Alert>
      )}

      <PersonalKpiBar orders={allItems} loading={allLoading} />

      {/* Filters (no seller dropdown — these are my own orders) */}
      <TeamOrdersFilters filters={filters} onChange={setFilters} sellers={[]} />

      {/* Desktop table */}
      <div>
        <div className="hidden md:block card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  {HEADERS.map((h,i) => <th key={i} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {isLoading && Array.from({length:5}).map((_,i) => <TableRowSkeleton key={i} cols={8}/>)}
                {!isLoading && items.length === 0 && (
                  <tr><td colSpan={8}>
                    <EmptyState icon={<ClipboardList size={22}/>} title="Личных заказов нет" description="Заказы появятся здесь, когда вы создадите их лично." />
                  </td></tr>
                )}
                {!isLoading && items.map((o,i) => <DesktopRow key={getOrderId(o)??i} order={o} onView={setSelected} onEdit={handleEdit}/>)}
              </tbody>
            </table>
          </div>
        </div>

        <div className="md:hidden space-y-3">
          {isLoading && [1,2,3].map(i => <div key={i} className="card p-4 animate-pulse h-24"/>)}
          {!isLoading && items.length === 0 && (
            <EmptyState icon={<ClipboardList size={22}/>} title="Личных заказов нет" description="Заказы появятся здесь, когда вы создадите их лично." />
          )}
          {!isLoading && items.map((o,i) => <MobileCard key={getOrderId(o)??i} order={o} onView={setSelected} onEdit={handleEdit}/>)}
        </div>

        <Pagination meta={meta} page={filters.page??1} onPage={page => setFilters(f => ({...f, page}))} />
      </div>

      <OrderDetailsDrawer order={selected} onClose={() => setSelected(null)} userMap={userMap} teamMap={teamMap} />
    </div>
  )
}
