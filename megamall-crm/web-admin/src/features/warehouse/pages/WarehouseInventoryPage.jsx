import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeftRight, Clock, Download, FilterX, History, Package, Search, Trash2 } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import Badge from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import Alert from '../../../shared/components/Alert'
import ProductDrawer from '../components/ProductDrawer'
import ProductModal from '../components/ProductModal'
import ReceivingModal from '../components/ReceivingModal'
import WriteoffModal from '../components/WriteoffModal'
import TransferModal from '../components/TransferModal'
import useWarehouseData from '../hooks/useWarehouseData'
import {
  STOCK_STATUS_BADGE,
  STOCK_STATUS_LABEL,
  fmtDate,
  fmtMoney,
  getAvailableQty,
  getCategoryName,
  getCategoryName as categoryName,
  getId,
  getLastMovementForProduct,
  getProductCategoryId,
  getProductImage,
  getProductName,
  getProductSku,
  getQuantity,
  getReservedQty,
  getStockStatus,
  getWarehouseName,
  isUUID,
} from '../utils/warehouseHelpers'

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'in_stock', label: 'В наличии' },
  { value: 'low_stock', label: 'Мало' },
  { value: 'out_of_stock', label: 'Нет в наличии' },
]

export default function WarehouseInventoryPage() {
  const [params, setParams] = useSearchParams()
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState(params.get('status') ?? '')
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [drawerProduct, setDrawerProduct] = useState(null)
  const [modalProduct, setModalProduct] = useState(null)
  const [receiveProduct, setReceiveProduct] = useState(undefined)
  const [writeoffProduct, setWriteoffProduct] = useState(null)
  const [transferProduct, setTransferProduct] = useState(null)
  const data = useWarehouseData()
  const validWarehouses = data.warehouses.filter((w) => isUUID(getId(w)))
  const validCategories = data.categories.filter((c) => isUUID(getId(c)))

  const filteredInventory = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.inventory.filter((inv) => {
      const product = data.productMap[inv.product_id ?? inv.ProductID]
      const categoryId = getProductCategoryId(product)
      const status = getStockStatus(inv)
      if (warehouseFilter && (inv.warehouse_id ?? inv.WarehouseID) !== warehouseFilter) return false
      if (statusFilter && status !== statusFilter) return false
      if (categoryFilter && categoryId !== categoryFilter) return false
      if (!q) return true
      return (
        getProductName(product).toLowerCase().includes(q) ||
        getProductSku(product).toLowerCase().includes(q) ||
        (product?.barcode ?? product?.Barcode ?? '').toLowerCase().includes(q)
      )
    })
  }, [categoryFilter, data.inventory, data.productMap, search, statusFilter, warehouseFilter])

  function clearFilters() {
    setSearch('')
    setWarehouseFilter('')
    setStatusFilter('')
    setCategoryFilter('')
    setParams({}, { replace: true })
  }

  function openHistory(product) {
    setDrawerProduct(product)
  }

  return (
    <div className="animate-fade-in p-6 pb-20 lg:pb-6">
      <PageHeader
        title="Остатки"
        subtitle="Быстрый поиск, доступность и операции по товарам."
        icon={<Package size={20} />}
        action={<Button variant="primary" icon={<Download size={15} />} onClick={() => setReceiveProduct(null)}>Новый приход</Button>}
      />

      {data.error && (
        <Alert variant="error" title="Ошибка загрузки данных" className="mb-5">
          {data.error?.response?.data?.error?.message ?? data.error?.message}
        </Alert>
      )}

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
        <div className="grid gap-2 lg:grid-cols-[1fr_170px_160px_170px_auto]">
          <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
            <Search size={17} className="text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по товару, SKU или штрихкоду…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </label>
          <select className="input py-2" value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
            <option value="">Все склады</option>
            {validWarehouses.map((w) => <option key={getId(w)} value={getId(w)}>{getWarehouseName(w)}</option>)}
          </select>
          <select className="input py-2" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="input py-2" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Все категории</option>
            {validCategories.map((c) => <option key={getId(c)} value={getId(c)}>{categoryName(c)}</option>)}
          </select>
          <Button icon={<FilterX size={15} />} onClick={clearFilters}>Сбросить</Button>
        </div>
      </section>

      <div className="hidden lg:block">
        <InventoryTable
          rows={filteredInventory}
          data={data}
          onProduct={setDrawerProduct}
          onReceive={setReceiveProduct}
          onWriteoff={setWriteoffProduct}
          onTransfer={setTransferProduct}
          onHistory={openHistory}
        />
      </div>
      <div className="space-y-3 lg:hidden">
        {filteredInventory.length === 0 ? (
          <EmptyState icon={<Package size={22} />} title="Остатки не найдены" description="Измените поиск или сбросьте фильтры." />
        ) : filteredInventory.map((inv) => (
          <InventoryCard
            key={getId(inv)}
            inv={inv}
            data={data}
            onProduct={setDrawerProduct}
            onReceive={setReceiveProduct}
            onWriteoff={setWriteoffProduct}
            onTransfer={setTransferProduct}
          />
        ))}
      </div>

      <button
        onClick={() => setReceiveProduct(null)}
        className="fixed bottom-5 right-5 z-30 flex min-h-[56px] items-center gap-2 rounded-full bg-indigo-600 px-5 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 lg:hidden"
      >
        <Download size={18} />
        Приход
      </button>

      <ProductDrawer
        product={drawerProduct}
        inventory={data.inventory}
        movements={data.movements}
        categoryMap={data.categoryMap}
        warehouseMap={data.warehouseMap}
        onClose={() => setDrawerProduct(null)}
        onReceive={setReceiveProduct}
        onWriteoff={setWriteoffProduct}
        onTransfer={setTransferProduct}
        onEdit={setModalProduct}
      />
      <ProductModal open={Boolean(modalProduct)} onClose={() => setModalProduct(null)} product={modalProduct} categories={data.categories} suppliers={data.suppliers} />
      <ReceivingModal open={receiveProduct !== undefined} onClose={() => setReceiveProduct(undefined)} initialProduct={receiveProduct} products={data.products} warehouses={data.warehouses} inventory={data.inventory} />
      <WriteoffModal open={Boolean(writeoffProduct)} onClose={() => setWriteoffProduct(null)} products={writeoffProduct ? [writeoffProduct] : data.products} warehouses={data.warehouses} inventory={data.inventory} />
      <TransferModal open={Boolean(transferProduct)} onClose={() => setTransferProduct(null)} products={transferProduct ? [transferProduct] : data.products} warehouses={data.warehouses} inventory={data.inventory} />
    </div>
  )
}

function InventoryTable({ rows, data, onProduct, onReceive, onWriteoff, onTransfer, onHistory }) {
  if (!rows.length) {
    return <EmptyState icon={<Package size={22} />} title="Остатки не найдены" description="Измените поиск или сбросьте фильтры." />
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <table className="w-full min-w-[1060px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2.5 text-left">Товар</th>
            <th className="px-3 py-2.5 text-left">Категория</th>
            <th className="px-3 py-2.5 text-right">На складе</th>
            <th className="px-3 py-2.5 text-right">Доступно</th>
            <th className="px-3 py-2.5 text-right">Резерв</th>
            <th className="px-3 py-2.5 text-right">Стоимость</th>
            <th className="px-3 py-2.5 text-left">Статус</th>
            <th className="px-3 py-2.5 text-right">Операции</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((inv) => {
            const product = data.productMap[inv.product_id ?? inv.ProductID]
            const warehouse = data.warehouseMap[inv.warehouse_id ?? inv.WarehouseID]
            const category = data.categoryMap[getProductCategoryId(product)]
            const status = getStockStatus(inv)
            const last = getLastMovementForProduct(getId(product), getId(warehouse), data.movements)
            const stockValue = getInventoryFifoValue(inv, data.batches)
            return (
              <tr key={getId(inv)} className="hover:bg-slate-50">
                <td className="px-3 py-2.5">
                  <button onClick={() => onProduct(product)} className="flex min-w-0 items-center gap-3 text-left">
                    <ProductThumb product={product} />
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-slate-900">{getProductName(product)}</span>
                      <span className="block font-mono text-xs text-slate-400">{getProductSku(product)} · {getWarehouseName(warehouse)}</span>
                    </span>
                  </button>
                </td>
                <td className="px-3 py-2.5 text-slate-500">{getCategoryName(category)}</td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-950">{getQuantity(inv)}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-700">{getAvailableQty(inv)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{getReservedQty(inv)}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-700">{fmtMoney(stockValue)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col gap-1.5">
                    <Badge variant={STOCK_STATUS_BADGE[status]}>{STOCK_STATUS_LABEL[status]}</Badge>
                    <span className="text-xs text-slate-400">{last ? fmtDate(last.created_at ?? last.CreatedAt) : 'Нет движений'}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <IconAction title="Приход" icon={<Download size={15} />} onClick={() => onReceive(product)} />
                    <IconAction title="Списание" icon={<Trash2 size={15} />} onClick={() => onWriteoff(product)} danger />
                    <IconAction title="Перемещение" icon={<ArrowLeftRight size={15} />} onClick={() => onTransfer(product)} />
                    <IconAction title="История" icon={<History size={15} />} onClick={() => onHistory(product)} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function InventoryCard({ inv, data, onProduct, onReceive, onWriteoff, onTransfer }) {
  const product = data.productMap[inv.product_id ?? inv.ProductID]
  const warehouse = data.warehouseMap[inv.warehouse_id ?? inv.WarehouseID]
  const category = data.categoryMap[getProductCategoryId(product)]
  const status = getStockStatus(inv)
  const last = getLastMovementForProduct(getId(product), getId(warehouse), data.movements)
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <button onClick={() => onProduct(product)} className="flex w-full items-start gap-3 text-left">
        <ProductThumb product={product} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-950">{getProductName(product)}</p>
              <p className="mt-0.5 font-mono text-xs text-slate-400">{getProductSku(product)}</p>
            </div>
            <Badge variant={STOCK_STATUS_BADGE[status]}>{STOCK_STATUS_LABEL[status]}</Badge>
          </div>
          <p className="mt-2 text-xs text-slate-500">{getWarehouseName(warehouse)} · {getCategoryName(category)}</p>
        </div>
      </button>
      <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-2.5 text-center">
        <MiniMetric label="Склад" value={getQuantity(inv)} />
        <MiniMetric label="Доступ" value={getAvailableQty(inv)} tone="emerald" />
        <MiniMetric label="Резерв" value={getReservedQty(inv)} tone="amber" />
        <MiniMetric label="Порог" value={inv.low_stock_threshold ?? inv.LowStockThreshold ?? 0} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span className="flex items-center gap-1"><Clock size={13} />{last ? fmtDate(last.created_at ?? last.CreatedAt) : 'Нет движений'}</span>
        <span>{fmtMoney(getInventoryFifoValue(inv, data.batches))}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button size="sm" icon={<Download size={14} />} onClick={() => onReceive(product)}>Приход</Button>
        <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => onWriteoff(product)}>Списать</Button>
        <Button size="sm" icon={<ArrowLeftRight size={14} />} onClick={() => onTransfer(product)}>Перенос</Button>
      </div>
    </article>
  )
}

function getInventoryFifoValue(inv, batches = []) {
  const warehouseId = inv.warehouse_id ?? inv.WarehouseID
  const productId = inv.product_id ?? inv.ProductID
  return batches
    .filter((b) => (b.warehouse_id ?? b.WarehouseID) === warehouseId && (b.product_id ?? b.ProductID) === productId)
    .reduce((sum, b) => sum + (b.remaining_quantity ?? b.RemainingQuantity ?? 0) * (b.unit_cost ?? b.UnitCost ?? 0), 0)
}

function ProductThumb({ product }) {
  const image = getProductImage(product)
  if (image) return <img src={image} alt={getProductName(product)} className="h-10 w-10 flex-shrink-0 rounded-lg border border-slate-200 object-cover" />
  return <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400"><Package size={16} /></div>
}

function IconAction({ title, icon, onClick, danger = false }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg transition-colors ${danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
    >
      {icon}
    </button>
  )
}

function MiniMetric({ label, value, tone }) {
  const color = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900'
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-sm font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}
