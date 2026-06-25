/**
 * TeamOrdersTable — read-only orders table for team lead.
 * Narrower than owner's table — no manager/team columns (implied).
 * Columns: №, Клиент, Телефон, Товар, Сумма, Чистая выручка, Статус, Продавец, Дата, Действие
 */
import { Eye, ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react'
import Badge     from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import { TableRowSkeleton } from '../../../shared/components/Skeleton'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { getOrderId, formatOrderLabel } from '../../dispatcher/utils/orderHelpers'

function field(o, ...keys) {
  for (const k of keys) if (o[k] != null) return o[k]
  return null
}

function resolveCustomer(o) {
  const name  = field(o, 'customer_name', 'CustomerName') ?? o.customer?.full_name ?? o.customer?.name ?? '—'
  const phone = field(o, 'customer_phone', 'CustomerPhone') ?? o.customer?.phone ?? null
  return { name, phone }
}

function resolveProduct(o) {
  return field(o, 'product_name', 'ProductName') ?? o.product?.name ?? '—'
}

const HEADERS = ['№', 'Клиент', 'Телефон', 'Товар', 'Сумма', 'Чистая выручка', 'Статус', 'Продавец', 'Дата', '']

function DesktopRow({ order, userMap, onView }) {
  const { name, phone } = resolveCustomer(order)
  const status  = order.status ?? order.Status ?? ''
  const amount  = field(order, 'total_order_amount', 'total_amount', 'amount', 'total', 'Amount') ?? 0
  const courierPayout = field(order, 'courier_payout', 'CourierPayout') ?? 0
  const net     = Number(amount) - Number(courierPayout)
  const sellerId = order.seller_id ?? order.SellerID
  const seller   = sellerId ? (userMap[sellerId]?.full_name ?? userMap[sellerId]?.FullName ?? sellerId.slice(0,8)) : '—'

  return (
    <tr className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
      <td className="px-4 py-3 text-xs font-mono font-semibold text-indigo-700 whitespace-nowrap">{formatOrderLabel(order)}</td>
      <td className="px-4 py-3 text-xs text-slate-800 max-w-[120px] truncate">{name}</td>
      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{phone ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-slate-700 max-w-[120px] truncate">{resolveProduct(order)}</td>
      <td className="px-4 py-3 text-xs font-semibold text-slate-800 whitespace-nowrap text-right">{fmtAmount(amount)} сомони</td>
      <td className="px-4 py-3 text-xs font-semibold text-emerald-700 whitespace-nowrap text-right">{fmtAmount(net)} сомони</td>
      <td className="px-4 py-3"><Badge variant={STATUS_BADGE[status] ?? 'slate'} size="sm">{STATUS_LABELS[status] ?? status}</Badge></td>
      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{seller}</td>
      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{fmtDate(order.created_at ?? order.CreatedAt)}</td>
      <td className="px-4 py-3">
        <button onClick={() => onView(order)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold transition-colors min-h-[32px]">
          <Eye size={12} /> Открыть
        </button>
      </td>
    </tr>
  )
}

function MobileCard({ order, userMap, onView }) {
  const { name } = resolveCustomer(order)
  const status = order.status ?? order.Status ?? ''
  const amount = field(order, 'total_order_amount', 'total_amount', 'amount', 'total') ?? 0

  return (
    <div className="card p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-mono font-bold text-indigo-700">{formatOrderLabel(order)}</p>
          <p className="text-sm font-semibold text-slate-800 mt-0.5">{name}</p>
        </div>
        <Badge variant={STATUS_BADGE[status] ?? 'slate'} size="sm">{STATUS_LABELS[status] ?? status}</Badge>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{fmtDate(order.created_at ?? order.CreatedAt)}</span>
        <span className="text-sm font-bold text-slate-800">{fmtAmount(amount)} сомони</span>
      </div>
      <button onClick={() => onView(order)}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold transition-colors min-h-[40px]">
        <Eye size={13} /> Подробнее
      </button>
    </div>
  )
}

function Pagination({ meta, page, onPage }) {
  if (!meta || meta.total_pages <= 1) return null
  const { total_pages, total, limit } = meta
  return (
    <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
      <p className="text-xs text-slate-500">
        {Math.min((page-1)*(limit??25)+1, total)}–{Math.min(page*(limit??25), total)} из {total}
      </p>
      <div className="flex items-center gap-1">
        <button disabled={page<=1} onClick={() => onPage(page-1)}
          className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          <ChevronLeft size={15} />
        </button>
        <span className="px-3 text-xs font-semibold text-slate-700">{page} / {total_pages}</span>
        <button disabled={page>=total_pages} onClick={() => onPage(page+1)}
          className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

export default function TeamOrdersTable({ orders = [], meta, page = 1, onPage, loading, userMap = {}, onView }) {
  return (
    <div>
      <div className="hidden md:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70">
                {HEADERS.map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({length:5}).map((_,i) => <TableRowSkeleton key={i} cols={10} />)}
              {!loading && orders.length === 0 && (
                <tr><td colSpan={10}>
                  <EmptyState icon={<ClipboardList size={22}/>} title="Нет заказов" description="Заказы вашей команды появятся здесь." />
                </td></tr>
              )}
              {!loading && orders.map((o, i) => (
                <DesktopRow key={getOrderId(o) ?? i} order={o} userMap={userMap} onView={onView} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="md:hidden space-y-3">
        {loading && [1,2,3].map(i => <div key={i} className="card p-4 animate-pulse h-24" />)}
        {!loading && orders.length === 0 && (
          <EmptyState icon={<ClipboardList size={22}/>} title="Нет заказов" description="Заказы вашей команды появятся здесь." />
        )}
        {!loading && orders.map((o, i) => (
          <MobileCard key={getOrderId(o) ?? i} order={o} userMap={userMap} onView={onView} />
        ))}
      </div>

      <Pagination meta={meta} page={page} onPage={onPage} />
    </div>
  )
}
