/**
 * OrdersTable — owner read-only orders table with pagination.
 *
 * Columns: №, Клиент, Телефон, Товар, Кол-во, Сумма, Доставка, Чистая выручка,
 *          Статус, Продавец, Менеджер, Команда, Дата, Действие (view)
 *
 * Mobile: condensed card layout below md.
 * Desktop: full table at md+.
 */
import { Eye, ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react'
import Badge     from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import { TableRowSkeleton } from '../../../shared/components/Skeleton'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { getOrderId, getOrderNumber, formatOrderLabel } from '../../../features/dispatcher/utils/orderHelpers'

function resolveField(order, ...keys) {
  for (const key of keys) {
    if (order[key] != null && order[key] !== '') return order[key]
  }
  return null
}

function resolveCustomer(order) {
  const name  = resolveField(order, 'customer_name', 'CustomerName', 'client_name')
  const phone = resolveField(order, 'customer_phone', 'CustomerPhone', 'phone')
  if (name) return { name, phone }
  const c = order.customer ?? order.Customer
  if (c) return { name: c.full_name ?? c.name ?? '—', phone: c.phone ?? null }
  return { name: '—', phone: null }
}

function resolveProduct(order) {
  const p = order.product ?? order.Product
  if (p) return p.name ?? p.Name ?? '—'
  return resolveField(order, 'product_name', 'ProductName') ?? '—'
}

function resolveUserName(userMap, userId) {
  if (!userId) return null
  const u = userMap[userId]
  return u ? (u.full_name ?? u.FullName ?? userId.slice(0,8)) : userId.slice(0,8)
}

function resolveTeamName(teamMap, teamId) {
  if (!teamId) return null
  const t = teamMap[teamId]
  return t ? t.name : teamId.slice(0,8)
}

// ── Desktop row ──────────────────────────────────────────────────────────────

function DesktopRow({ order, userMap, teamMap, onView }) {
  const { name, phone } = resolveCustomer(order)
  const status  = order.status ?? order.Status ?? ''
  const amount  = resolveField(order, 'total_order_amount', 'total_amount', 'amount', 'total', 'Amount') ?? 0
  const delivery = resolveField(order, 'courier_payout', 'CourierPayout') ?? 0
  const net     = Number(amount) - Number(delivery)
  const qty     = resolveField(order, 'quantity', 'Quantity', 'qty') ?? 1

  return (
    <tr className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
      <td className="px-4 py-3 text-xs font-mono font-semibold text-indigo-700 whitespace-nowrap">
        {formatOrderLabel(order)}
      </td>
      <td className="px-4 py-3 text-xs text-slate-800 max-w-[120px] truncate">{name}</td>
      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{phone ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-slate-700 max-w-[140px] truncate">{resolveProduct(order)}</td>
      <td className="px-4 py-3 text-xs text-center text-slate-600">{qty}</td>
      <td className="px-4 py-3 text-xs font-semibold text-slate-800 whitespace-nowrap text-right">
        {fmtAmount(amount)} сомони
      </td>
      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap text-right">
        {delivery ? `${fmtAmount(delivery)} сомони` : '—'}
      </td>
      <td className="px-4 py-3 text-xs font-semibold text-emerald-700 whitespace-nowrap text-right">
        {fmtAmount(net)} сомони
      </td>
      <td className="px-4 py-3">
        <Badge variant={STATUS_BADGE[status] ?? 'slate'} size="sm">
          {STATUS_LABELS[status] ?? status}
        </Badge>
      </td>
      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
        {resolveUserName(userMap, order.seller_id ?? order.SellerID) ?? '—'}
      </td>
      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
        {resolveUserName(userMap, order.manager_id ?? order.ManagerID) ?? '—'}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
        {resolveTeamName(teamMap, order.team_id ?? order.TeamID) ?? '—'}
      </td>
      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
        {fmtDate(order.created_at ?? order.CreatedAt)}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => onView(order)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold transition-colors min-h-[32px]"
          title="Просмотр заказа"
        >
          <Eye size={12} /> Открыть
        </button>
      </td>
    </tr>
  )
}

// ── Mobile card ──────────────────────────────────────────────────────────────

function MobileCard({ order, userMap, teamMap, onView }) {
  const { name, phone } = resolveCustomer(order)
  const status  = order.status ?? order.Status ?? ''
  const amount  = resolveField(order, 'total_order_amount', 'total_amount', 'amount', 'total', 'Amount') ?? 0

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-mono font-bold text-indigo-700">{formatOrderLabel(order)}</p>
          <p className="text-sm font-semibold text-slate-800 mt-0.5">{name}</p>
          {phone && <p className="text-xs text-slate-400">{phone}</p>}
        </div>
        <Badge variant={STATUS_BADGE[status] ?? 'slate'} size="sm">
          {STATUS_LABELS[status] ?? status}
        </Badge>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>{resolveProduct(order)}</span>
        <span className="font-bold text-slate-800">{fmtAmount(amount)} сомони</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">
          {fmtDate(order.created_at ?? order.CreatedAt)}
        </p>
        <button
          onClick={() => onView(order)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold transition-colors min-h-[36px]"
        >
          <Eye size={12} /> Подробнее
        </button>
      </div>
    </div>
  )
}

// ── Pagination ───────────────────────────────────────────────────────────────

function Pagination({ meta, page, onPage }) {
  if (!meta || meta.total_pages <= 1) return null
  const { total_pages, total, limit } = meta

  return (
    <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
      <p className="text-xs text-slate-500">
        Показано {Math.min((page - 1) * (limit ?? 25) + 1, total)}–{Math.min(page * (limit ?? 25), total)} из {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="px-3 text-xs font-semibold text-slate-700">{page} / {total_pages}</span>
        <button
          disabled={page >= total_pages}
          onClick={() => onPage(page + 1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

const HEADERS = [
  '№', 'Клиент', 'Телефон', 'Товар', 'Кол-во', 'Сумма', 'Доставка',
  'Чистая выручка', 'Статус', 'Продавец', 'Менеджер', 'Команда', 'Дата', '',
]

export default function OrdersTable({
  orders   = [],
  meta     = null,
  page     = 1,
  onPage,
  loading  = false,
  userMap  = {},
  teamMap  = {},
  onView,
}) {
  return (
    <div>
      {/* ── Desktop ── */}
      <div className="hidden md:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70">
                {HEADERS.map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <TableRowSkeleton key={i} cols={14} />
              ))}
              {!loading && orders.length === 0 && (
                <tr>
                  <td colSpan={14}>
                    <EmptyState
                      icon={<ClipboardList size={24} />}
                      title="Заказы не найдены"
                      description="Попробуйте изменить фильтры или расширить период."
                    />
                  </td>
                </tr>
              )}
              {!loading && orders.map((o, i) => (
                <DesktopRow
                  key={getOrderId(o) ?? i}
                  order={o}
                  userMap={userMap}
                  teamMap={teamMap}
                  onView={onView}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Mobile ── */}
      <div className="md:hidden space-y-3">
        {loading && [1,2,3].map(i => (
          <div key={i} className="card p-4 animate-pulse space-y-2">
            <div className="h-3 w-24 bg-slate-200 rounded" />
            <div className="h-4 w-40 bg-slate-200 rounded" />
            <div className="h-3 w-32 bg-slate-200 rounded" />
          </div>
        ))}
        {!loading && orders.length === 0 && (
          <EmptyState
            icon={<ClipboardList size={22} />}
            title="Заказы не найдены"
            description="Попробуйте изменить фильтры."
          />
        )}
        {!loading && orders.map((o, i) => (
          <MobileCard
            key={getOrderId(o) ?? i}
            order={o}
            userMap={userMap}
            teamMap={teamMap}
            onView={onView}
          />
        ))}
      </div>

      <Pagination meta={meta} page={page} onPage={onPage} />
    </div>
  )
}
