import Badge      from '../../../shared/components/Badge'
import EmptyState  from '../../../shared/components/EmptyState'
import { TableRowSkeleton } from '../../../shared/components/Skeleton'
import { Package } from 'lucide-react'
import {
  getProductName, getProductSku,
  getAvailableQty, getReservedQty, getQuantity,
  getStockStatus, STOCK_STATUS_LABEL, STOCK_STATUS_BADGE,
} from '../utils/warehouseHelpers'

const TH = ({ children, right }) => (
  <th className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
    {children}
  </th>
)

const ROW_BG = {
  out_of_stock: 'bg-rose-50/40',
  low_stock:    'bg-amber-50/40',
  in_stock:     '',
}

export default function InventoryTable({ inventory, productMap, loading }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <TH>Товар</TH>
            <TH>Артикул</TH>
            <TH right>На складе</TH>
            <TH right>Доступно</TH>
            <TH right>Резерв</TH>
            <TH right>Мин. порог</TH>
            <TH>Статус</TH>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading && [1,2,3,4,5].map(i => <TableRowSkeleton key={i} cols={7} />)}

          {!loading && inventory.length === 0 && (
            <tr>
              <td colSpan={7} className="py-0">
                <EmptyState icon={<Package size={22} />} title="Нет остатков" description="Добавьте приход товаров через вкладку «Приход»" />
              </td>
            </tr>
          )}

          {!loading && inventory.map((inv, i) => {
            const id        = inv.id ?? inv.ID ?? i
            const product   = productMap[inv.product_id ?? inv.ProductID] ?? null
            const status    = getStockStatus(inv)
            const threshold = inv.low_stock_threshold ?? inv.LowStockThreshold ?? 0

            return (
              <tr key={id} className={`hover:bg-slate-50/80 transition-colors ${ROW_BG[status] ?? ''}`}>
                <td className="px-4 py-3 font-medium text-slate-900 max-w-[200px]">
                  <span className="truncate block">{getProductName(product)}</span>
                </td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{getProductSku(product)}</td>
                <td className={`px-4 py-3 text-right font-bold tabular-nums ${status === 'out_of_stock' ? 'text-rose-600' : 'text-slate-900'}`}>
                  {getQuantity(inv)}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-emerald-700 tabular-nums">{getAvailableQty(inv)}</td>
                <td className="px-4 py-3 text-right text-amber-600 tabular-nums">{getReservedQty(inv)}</td>
                <td className="px-4 py-3 text-right text-slate-400 tabular-nums text-xs">{threshold}</td>
                <td className="px-4 py-3">
                  <Badge variant={STOCK_STATUS_BADGE[status]} dot={status !== 'in_stock'}>
                    {STOCK_STATUS_LABEL[status]}
                  </Badge>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
