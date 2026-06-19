import KpiCard from '../../../shared/components/KpiCard'
import { Package2, BarChart3, AlertTriangle, XCircle, DollarSign, ArrowLeftRight } from 'lucide-react'
import { fmtMoney, getStockStatus } from '../utils/warehouseHelpers'

export default function WarehouseKpis({ products = [], inventory = [], movements = [], batches = [], loading = false }) {
  const totalProducts = products.length

  const totalUnits = inventory.reduce((sum, inv) => sum + (inv.quantity ?? inv.Quantity ?? 0), 0)

  const stockValue = batches.reduce(
    (sum, b) => sum + (b.remaining_quantity ?? b.RemainingQuantity ?? 0) * (b.unit_cost ?? b.UnitCost ?? 0),
    0
  )

  const lowStockCount  = inventory.filter(inv => getStockStatus(inv) === 'low_stock').length
  const outStockCount  = inventory.filter(inv => getStockStatus(inv) === 'out_of_stock').length

  const today = new Date().toDateString()
  const movementsToday = movements.filter((m) => {
    const d = m.created_at ?? m.CreatedAt
    if (!d) return false
    try { return new Date(d).toDateString() === today } catch { return false }
  }).length

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      <KpiCard
        label="Товаров в каталоге"
        value={loading ? '—' : String(totalProducts)}
        icon={<Package2 size={20} />}
        color="indigo"
        loading={loading}
      />
      <KpiCard
        label="Единиц на складе"
        value={loading ? '—' : totalUnits.toLocaleString('ru-RU')}
        icon={<BarChart3 size={20} />}
        color="emerald"
        loading={loading}
      />
      <KpiCard
        label="Стоимость склада"
        value={loading ? '—' : fmtMoney(stockValue)}
        icon={<DollarSign size={20} />}
        color="violet"
        loading={loading}
      />
      <KpiCard
        label="Низкий запас"
        value={loading ? '—' : String(lowStockCount)}
        icon={<AlertTriangle size={20} />}
        color={lowStockCount > 0 ? 'amber' : 'emerald'}
        loading={loading}
      />
      <KpiCard
        label="Нет в наличии"
        value={loading ? '—' : String(outStockCount)}
        icon={<XCircle size={20} />}
        color={outStockCount > 0 ? 'rose' : 'emerald'}
        loading={loading}
      />
      <KpiCard
        label="Движений сегодня"
        value={loading ? '—' : String(movementsToday)}
        icon={<ArrowLeftRight size={20} />}
        color="sky"
        loading={loading}
      />
    </div>
  )
}
