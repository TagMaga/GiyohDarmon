import { useState } from 'react'
import { Package, AlertTriangle, Archive, RefreshCw, Layers } from 'lucide-react'
import KpiCard          from '../../../shared/components/KpiCard'
import useWarehouseData from '../../warehouse/hooks/useWarehouseData'
import {
  getStockStatus, STOCK_STATUS_LABEL,
  getProductName, getProductSku,
  getId,
} from '../../warehouse/utils/warehouseHelpers'

const FILTERS = [
  { key: '',              label: 'Все' },
  { key: 'low_stock',    label: 'Мало' },
  { key: 'out_of_stock', label: 'Нет в наличии' },
]

const STATUS_STYLE = {
  in_stock:     'bg-emerald-100 text-emerald-700',
  low_stock:    'bg-amber-100  text-amber-700',
  out_of_stock: 'bg-rose-100   text-rose-700',
}

const ROW_STYLE = {
  in_stock:     '',
  low_stock:    'bg-amber-50/20',
  out_of_stock: 'bg-rose-50/30',
}

export default function OwnerWarehousePage() {
  const [filter, setFilter] = useState('')

  const { inventory, productMap, loading, refetchAll } = useWarehouseData()

  const totalProducts = inventory.length
  const totalUnits    = inventory.reduce((s, i) => s + (i.available_quantity ?? i.AvailableQuantity ?? 0), 0)
  const lowStock      = inventory.filter(i => getStockStatus(i) === 'low_stock').length
  const outOfStock    = inventory.filter(i => getStockStatus(i) === 'out_of_stock').length

  const filtered = filter
    ? inventory.filter(i => getStockStatus(i) === filter)
    : inventory

  return (
    <div className="p-4 md:p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Склад</h1>
          <p className="text-sm text-slate-500 mt-0.5">Остатки в реальном времени</p>
        </div>
        <button
          onClick={refetchAll}
          className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <KpiCard
          label="Позиций"
          value={totalProducts}
          icon={<Package size={22} />}
          color="indigo"
          loading={loading}
        />
        <KpiCard
          label="Ед. на складе"
          value={totalUnits.toLocaleString('ru-RU')}
          icon={<Layers size={22} />}
          color="sky"
          loading={loading}
        />
        <KpiCard
          label="Мало"
          value={lowStock}
          icon={<AlertTriangle size={22} />}
          color="amber"
          loading={loading}
        />
        <KpiCard
          label="Нет в наличии"
          value={outOfStock}
          icon={<Archive size={22} />}
          color="rose"
          loading={loading}
        />
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => {
          const count = f.key
            ? inventory.filter(i => getStockStatus(i) === f.key).length
            : totalProducts
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                filter === f.key
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Inventory table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-400 text-sm">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">Нет товаров в выбранном фильтре</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Товар', 'Остаток', 'Мин. порог', 'Статус'].map(h => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const st        = getStockStatus(item)
                  const productId = item.product_id ?? item.ProductID
                  const product   = productMap[productId]
                  return (
                    <tr
                      key={getId(item) ?? productId}
                      className={`border-b border-slate-50 ${ROW_STYLE[st] ?? ''}`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">
                          {product ? getProductName(product) : '—'}
                        </p>
                        {product && getProductSku(product) && (
                          <p className="text-slate-400 text-[11px]">{getProductSku(product)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums">
                        {(item.available_quantity ?? item.AvailableQuantity ?? 0).toLocaleString('ru-RU')} шт.
                      </td>
                      <td className="px-4 py-3 text-slate-400 tabular-nums">
                        {item.low_stock_threshold ?? item.LowStockThreshold ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${STATUS_STYLE[st] ?? STATUS_STYLE.in_stock}`}>
                          {STOCK_STATUS_LABEL[st] ?? 'В наличии'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
