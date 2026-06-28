/**
 * OwnerOrdersPage — /owner/orders
 *
 * Complete Owner Orders Center. Owner can answer in one page:
 *   - How many orders today / this period
 *   - How many delivered, cancelled, in progress
 *   - Which seller/manager/team performs best
 *   - Which products sell most
 *   - Detail of any specific order
 *
 * Architecture:
 *   - Primary fetch: paginated /orders for the table (server-side pagination).
 *   - Secondary fetch: all orders for current period (larger limit) → KPI + Analytics.
 *     If backend supports it, we use the summary. Otherwise derive client-side.
 *   - userMap / teamMap built from /employees and /teams (cached globally).
 *
 * No write actions — owner view is fully read-only for order workflow.
 */
import { useState, useMemo }  from 'react'
import { useSearchParams }    from 'react-router-dom'
import { ClipboardList, RefreshCw } from 'lucide-react'

import Alert from '../../../shared/components/Alert'
import useOwnerOrders              from '../hooks/useOwnerOrders'
import OrdersKpiBar                from '../components/OrdersKpiBar'
import OrdersFilters               from '../components/OrdersFilters'
import OrdersTable                 from '../components/OrdersTable'
import OrderDetailsDrawer          from '../components/OrderDetailsDrawer'
import OrdersAnalytics             from '../components/OrdersAnalytics'

import useEmployees  from '../../people/hooks/useEmployees'
import useTeams      from '../../people/hooks/useTeams'
import useLogisticsCouriers from '../../logistics/hooks/useLogisticsCouriers'
import { buildUserMap } from '../../people/utils/peopleHelpers'

// ── Date helpers ──────────────────────────────────────────────────────────────

function toYMD(d) { return d.toISOString().slice(0, 10) }

function currentMonthDefault() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: toYMD(start), to: toYMD(now) }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OwnerOrdersPage() {
  const [searchParams] = useSearchParams()
  const def = currentMonthDefault()

  // ── Filters state ────────────────────────────────────────────────────────
  // Read initial status from URL param so KPI tiles can deep-link here
  const [filters, setFilters] = useState(() => ({
    from:   def.from,
    to:     def.to,
    status: searchParams.get('status') || '',
    page:   1,
    limit:  25,
  }))

  // ── Drawer state ─────────────────────────────────────────────────────────
  const [selectedOrder, setSelectedOrder] = useState(null)

  // ── People data ──────────────────────────────────────────────────────────
  const { data: allEmployees = [] } = useEmployees()
  const { data: allTeams     = [] } = useTeams()
  const { data: couriers     = [] } = useLogisticsCouriers()

  const userMap = useMemo(() => buildUserMap(allEmployees), [allEmployees])
  const teamMap = useMemo(() => {
    const m = {}
    allTeams.forEach(t => { if (t.id) m[t.id] = t })
    return m
  }, [allTeams])

  const sellers  = useMemo(() => allEmployees.filter(u => (u.role ?? u.Role) === 'seller'),  [allEmployees])
  const managers = useMemo(() => allEmployees.filter(u => (u.role ?? u.Role) === 'manager'), [allEmployees])

  // ── Paginated orders (for table) ─────────────────────────────────────────
  const {
    items: orders,
    meta,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useOwnerOrders(filters)

  // ── All orders for KPI + analytics (higher limit, no pagination) ─────────
  const analyticsFilters = useMemo(() => ({
    from:  filters.from,
    to:    filters.to,
    ...(filters.status     ? { status:     filters.status }     : {}),
    ...(filters.team_id    ? { team_id:    filters.team_id }    : {}),
    ...(filters.seller_id  ? { seller_id:  filters.seller_id }  : {}),
    ...(filters.manager_id ? { manager_id: filters.manager_id } : {}),
    ...(filters.courier_id ? { courier_id: filters.courier_id } : {}),
    ...(filters.no_courier ? { no_courier: true } : {}),
    ...(filters.search     ? { search:     filters.search }     : {}),
    limit: 500,
    page:  1,
  }), [filters.from, filters.to, filters.status, filters.team_id, filters.seller_id, filters.manager_id, filters.courier_id, filters.no_courier, filters.search])

  const {
    items: allOrders,
    isLoading: allLoading,
  } = useOwnerOrders(analyticsFilters)

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleFiltersChange(newFilters) {
    setFilters(newFilters)
  }

  function handlePageChange(page) {
    setFilters(f => ({ ...f, page }))
  }

  return (
    <div className="p-4 md:p-6 space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 flex-shrink-0">
            <ClipboardList size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Заказы</h1>
            <p className="text-xs text-slate-400">Аналитика и история заказов</p>
          </div>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 transition-all min-h-[44px] flex-shrink-0"
          title="Обновить"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Обновить</span>
        </button>
      </div>

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {isError && (
        <Alert variant="error">
          {error?.response?.data?.error?.message ?? error?.message ?? 'Ошибка загрузки заказов'}
        </Alert>
      )}

      {/* ── KPI bar ─────────────────────────────────────────────────────── */}
      <OrdersKpiBar orders={allOrders} loading={allLoading} />

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <OrdersFilters
        filters={filters}
        onChange={handleFiltersChange}
        teams={allTeams}
        sellers={sellers}
        managers={managers}
        couriers={couriers}
      />

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <OrdersTable
        orders={orders}
        meta={meta}
        page={filters.page ?? 1}
        onPage={handlePageChange}
        loading={isLoading}
        userMap={userMap}
        teamMap={teamMap}
        onView={setSelectedOrder}
      />

      {/* ── Analytics ───────────────────────────────────────────────────── */}
      {!allLoading && allOrders.length > 0 && (
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-bold text-slate-800">Аналитика</h2>
            <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              за выбранный период
            </span>
          </div>
          <OrdersAnalytics orders={allOrders} userMap={userMap} />
        </div>
      )}

      {/* ── Detail drawer ───────────────────────────────────────────────── */}
      <OrderDetailsDrawer
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        userMap={userMap}
        teamMap={teamMap}
      />
    </div>
  )
}
