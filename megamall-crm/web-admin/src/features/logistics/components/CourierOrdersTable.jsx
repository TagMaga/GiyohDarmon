/**
 * CourierOrdersTable — paginated order history for a courier.
 */
import { useState } from 'react'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import Badge from '../../../shared/components/Badge'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount } from '../../../shared/orderStatusConfig'

const fmtDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

const fmtMin = (n) => {
  if (!n || n === 0) return '—'
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return h > 0 ? `${h}ч ${m}м` : `${m}м`
}

export default function CourierOrdersTable({ data, loading, page, onPage }) {
  const items = data?.items ?? []
  const meta  = data?.meta ?? null

  if (loading) {
    return (
      <div className="card overflow-hidden">
        <div className="p-4 space-y-3">
          {[1,2,3].map(i => <div key={i} className="skeleton w-full h-14 rounded-xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              {['Заказ', 'Клиент', 'Адрес', 'Сумма', 'Доставка', 'Назначен', 'Завершён', 'Время', 'Статус'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">Заказов не найдено</td>
              </tr>
            )}
            {items.map(o => (
              <tr key={o.order_id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-mono text-xs font-semibold text-slate-700">{o.order_number}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900 text-xs">{o.customer_name}</p>
                  {o.customer_phone && <p className="text-[11px] text-slate-400">{o.customer_phone}</p>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 max-w-[140px] truncate">
                  {o.delivery_address ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-800 font-medium tabular-nums text-xs">
                  {fmtAmount(o.total_amount)} c
                </td>
                <td className="px-4 py-3 text-slate-500 tabular-nums text-xs">
                  {fmtAmount(o.delivery_fee)} c
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                  {fmtDate(o.assigned_at)}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                  {fmtDate(o.delivered_at)}
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className="flex items-center gap-1 text-slate-500">
                    <Clock size={11} className="text-slate-300" />
                    {fmtMin(o.delivery_minutes)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_BADGE[o.status] ?? 'slate'}>
                    {STATUS_LABELS[o.status] ?? o.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-slate-50">
        {items.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">Заказов не найдено</p>
        )}
        {items.map(o => (
          <div key={o.order_id} className="px-4 py-3 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="font-mono text-xs font-semibold text-slate-700">{o.order_number}</p>
              <Badge variant={STATUS_BADGE[o.status] ?? 'slate'} size="sm">
                {STATUS_LABELS[o.status] ?? o.status}
              </Badge>
            </div>
            <p className="text-sm font-medium text-slate-900">{o.customer_name}</p>
            <div className="flex gap-4 text-xs text-slate-500">
              <span>{fmtAmount(o.total_amount)} c</span>
              <span>· Время: {fmtMin(o.delivery_minutes)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {meta && meta.total_pages > 1 && (
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">Стр. {page} из {meta.total_pages}</span>
          <div className="flex gap-1">
            <button
              onClick={() => onPage(page - 1)}
              disabled={page <= 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => onPage(page + 1)}
              disabled={page >= meta.total_pages}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
