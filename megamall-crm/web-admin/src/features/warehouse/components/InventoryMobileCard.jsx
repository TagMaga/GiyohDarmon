import Badge      from '../../../shared/components/Badge'
import EmptyState  from '../../../shared/components/EmptyState'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { Package } from 'lucide-react'
import {
  getProductName, getProductSku, getWarehouseName,
  getAvailableQty, getReservedQty, getQuantity,
  getStockStatus, STOCK_STATUS_LABEL, STOCK_STATUS_BADGE,
} from '../utils/warehouseHelpers'

const BORDER_CLASS = {
  out_of_stock: 'border-l-4 border-l-rose-400',
  low_stock:    'border-l-4 border-l-amber-400',
  in_stock:     '',
}

export default function InventoryMobileCard({ inventory, productMap, warehouseMap, loading }) {
  if (loading) return (
    <div className="space-y-3">{[1,2,3,4].map(i => <CardSkeleton key={i} />)}</div>
  )

  if (!inventory.length) return (
    <EmptyState icon={<Package size={22} />} title="Нет остатков" description="Добавьте приход товаров через вкладку «Приход»" />
  )

  return (
    <div className="space-y-3">
      {inventory.map((inv, i) => {
        const id        = inv.id ?? inv.ID ?? i
        const product   = productMap[inv.product_id ?? inv.ProductID] ?? null
        const warehouse = warehouseMap[inv.warehouse_id ?? inv.WarehouseID] ?? null
        const status    = getStockStatus(inv)

        return (
          <div key={id} className={`card p-4 space-y-2 ${BORDER_CLASS[status] ?? ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {getProductName(product)}
                </p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{getProductSku(product)}</p>
              </div>
              <Badge variant={STOCK_STATUS_BADGE[status]} size="sm" dot={status !== 'in_stock'}>
                {STOCK_STATUS_LABEL[status]}
              </Badge>
            </div>

            <p className="text-xs text-slate-500">{getWarehouseName(warehouse)}</p>

            <div className="flex items-center gap-4 flex-wrap pt-1">
              <Stat
                label="На складе"
                value={getQuantity(inv)}
                bold
                color={status === 'out_of_stock' ? 'text-rose-600' : 'text-slate-900'}
              />
              <Stat label="Доступно"   value={getAvailableQty(inv)} color="text-emerald-700" />
              <Stat label="Резерв"     value={getReservedQty(inv)}  color="text-amber-600" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Stat({ label, value, bold, color = 'text-slate-700' }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-sm ${bold ? 'font-bold' : 'font-semibold'} ${color}`}>{value}</p>
    </div>
  )
}
