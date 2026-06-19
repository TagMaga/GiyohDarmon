import Badge      from '../../../shared/components/Badge'
import EmptyState  from '../../../shared/components/EmptyState'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { ArrowLeftRight } from 'lucide-react'
import {
  getProductName, getWarehouseName,
  getMovementType, MOVEMENT_LABEL, MOVEMENT_BADGE,
  getQuantity, fmtDate,
} from '../utils/warehouseHelpers'

export default function MovementMobileCard({ movements, productMap, warehouseMap, loading }) {
  if (loading) return (
    <div className="space-y-3">{[1,2,3,4].map(i => <CardSkeleton key={i} />)}</div>
  )

  if (!movements.length) return (
    <EmptyState icon={<ArrowLeftRight size={22} />} title="Нет движений" description="Движения по складу появятся здесь" />
  )

  return (
    <div className="space-y-3">
      {movements.map((m, i) => {
        const id        = m.id ?? m.ID ?? i
        const mtype     = getMovementType(m)
        const product   = productMap[m.product_id ?? m.ProductID] ?? null
        const warehouse = warehouseMap[m.warehouse_id ?? m.WarehouseID] ?? null
        const qty       = getQuantity(m)
        const isOut     = mtype === 'sale' || mtype === 'transfer_out' || mtype === 'writeoff'

        return (
          <div key={id} className="card p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{getProductName(product)}</p>
                <p className="text-xs text-slate-400 mt-0.5">{getWarehouseName(warehouse)}</p>
              </div>
              <Badge variant={MOVEMENT_BADGE[mtype] ?? 'slate'} size="sm">
                {MOVEMENT_LABEL[mtype] ?? mtype ?? '—'}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className={`text-lg font-bold ${isOut ? 'text-rose-600' : 'text-emerald-700'}`}>
                {isOut ? '−' : '+'}{qty}
              </span>
              <div className="text-right">
                <p className="text-xs text-slate-400">{fmtDate(m.created_at ?? m.CreatedAt)}</p>
                {(m.created_by_name ?? m.CreatedByName) && (
                  <p className="text-xs text-slate-400 mt-0.5">{m.created_by_name ?? m.CreatedByName}</p>
                )}
              </div>
            </div>

            {(m.reason ?? m.Reason) && (
              <p className="text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-1.5">
                {m.reason ?? m.Reason}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
