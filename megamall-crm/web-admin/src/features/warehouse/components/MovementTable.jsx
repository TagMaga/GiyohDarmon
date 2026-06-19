import Badge      from '../../../shared/components/Badge'
import EmptyState  from '../../../shared/components/EmptyState'
import { TableRowSkeleton } from '../../../shared/components/Skeleton'
import { ArrowLeftRight } from 'lucide-react'
import {
  getProductName, getWarehouseName,
  getMovementType, MOVEMENT_LABEL, MOVEMENT_BADGE,
  getQuantity, fmtDate,
} from '../utils/warehouseHelpers'

const TH = ({ children, right }) => (
  <th className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
    {children}
  </th>
)

export default function MovementTable({ movements, productMap, warehouseMap, loading }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <TH>Тип</TH>
            <TH>Товар</TH>
            <TH>Склад</TH>
            <TH right>Кол-во</TH>
            <TH right>Было</TH>
            <TH right>Стало</TH>
            <TH>Причина</TH>
            <TH>Кто</TH>
            <TH>Дата</TH>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading && [1,2,3,4,5].map(i => <TableRowSkeleton key={i} cols={9} />)}

          {!loading && movements.length === 0 && (
            <tr><td colSpan={9} className="py-0">
              <EmptyState icon={<ArrowLeftRight size={22} />} title="Нет движений" />
            </td></tr>
          )}

          {!loading && movements.map((m, i) => {
            const id        = m.id ?? m.ID ?? i
            const mtype     = getMovementType(m)
            const product   = productMap[m.product_id ?? m.ProductID] ?? null
            const warehouse = warehouseMap[m.warehouse_id ?? m.WarehouseID] ?? null
            const qty       = getQuantity(m)
            const isOut     = mtype === 'sale' || mtype === 'transfer_out' || mtype === 'writeoff'

            return (
              <tr key={id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <Badge variant={MOVEMENT_BADGE[mtype] ?? 'slate'} size="sm">
                    {MOVEMENT_LABEL[mtype] ?? mtype ?? '—'}
                  </Badge>
                </td>
                <td className="px-4 py-3 font-medium text-slate-900 max-w-[180px]">
                  <span className="truncate block">{getProductName(product)}</span>
                </td>
                <td className="px-4 py-3 text-slate-600 max-w-[140px]">
                  <span className="truncate block">{getWarehouseName(warehouse)}</span>
                </td>
                <td className={`px-4 py-3 text-right font-bold tabular-nums ${isOut ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {isOut ? '−' : '+'}{qty}
                </td>
                <td className="px-4 py-3 text-right text-slate-500 tabular-nums">
                  {m.previous_quantity ?? m.PreviousQuantity ?? '—'}
                </td>
                <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                  {m.new_quantity ?? m.NewQuantity ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-500 max-w-[180px]">
                  <span className="truncate block text-xs">{m.reason ?? m.Reason ?? '—'}</span>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap max-w-[120px]">
                  <span className="truncate block">{m.created_by_name ?? m.CreatedByName ?? '—'}</span>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                  {fmtDate(m.created_at ?? m.CreatedAt)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
