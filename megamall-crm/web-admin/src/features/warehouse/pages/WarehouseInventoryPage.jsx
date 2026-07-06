import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clock, Download, Package, PackagePlus, Pencil, Search, Trash2 } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import Badge from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import Alert from '../../../shared/components/Alert'
import ProductDrawer from '../components/ProductDrawer'
import ProductModal from '../components/ProductModal'
import ReceivingModal from '../components/ReceivingModal'
import WriteoffModal from '../components/WriteoffModal'
import useWarehouseData from '../hooks/useWarehouseData'
import {
  STOCK_STATUS_BADGE,
  STOCK_STATUS_LABEL,
  fmtDate,
  fmtMoney,
  getAvailableQty,
  getId,
  getLastMovementForProduct,
  getProductBarcode,
  getProductImage,
  getProductName,
  getProductSku,
  getPurchasePrice,
  getQuantity,
  getReservedQty,
  getSalePrice,
  getStockStatus,
  isProductActive,
} from '../utils/warehouseHelpers'

export default function WarehouseInventoryPage() {
  const [params] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [drawerProduct, setDrawerProduct] = useState(null)
  const [modalProduct, setModalProduct] = useState(null)
  const [showCreateProduct, setShowCreateProduct] = useState(false)
  const [receiveProduct, setReceiveProduct] = useState(undefined)
  const [writeoffProduct, setWriteoffProduct] = useState(null)
  const data = useWarehouseData()

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const inventoryByProduct = new Map(data.inventory.map((inv) => [inv.product_id ?? inv.ProductID, inv]))
    return data.products.map((product) => {
      const inv = inventoryByProduct.get(getId(product)) ?? null
      return { product, inv }
    }).filter(({ product, inv }) => {
      if (!q) return true
      return (
        getProductName(product).toLowerCase().includes(q) ||
        getProductSku(product).toLowerCase().includes(q) ||
        getProductBarcode(product).toLowerCase().includes(q)
      )
    })
  }, [data.inventory, data.products, search])

  return (
    <div className="animate-fade-in p-6 pb-20 lg:pb-6">
      <PageHeader
        title="Остатки и товары"
        subtitle="Карточки товаров, цены, доступность и складские операции."
        icon={<Package size={20} />}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button icon={<PackagePlus size={15} />} onClick={() => setShowCreateProduct(true)}>Добавить товар</Button>
          </div>
        }
      />

      {data.error && (
        <Alert variant="error" title="Ошибка загрузки данных" className="mb-5">
          {data.error?.response?.data?.error?.message ?? data.error?.message}
        </Alert>
      )}

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
        <div className="grid gap-2">
          <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
            <Search size={17} className="text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по товару, SKU или штрихкоду…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </label>
        </div>
      </section>

      <div className="hidden lg:block">
          <InventoryTable
          rows={filteredRows}
          data={data}
          onProduct={setDrawerProduct}
          onReceive={setReceiveProduct}
          onWriteoff={setWriteoffProduct}
          onEdit={setModalProduct}
        />
      </div>
      <div className="space-y-3 lg:hidden">
        {filteredRows.length === 0 ? (
          <EmptyState icon={<Package size={22} />} title="Остатки не найдены" description="Измените поиск или сбросьте фильтры." />
        ) : filteredRows.map(({ product, inv }) => (
          <InventoryCard
            key={getId(product)}
            inv={inv}
            product={product}
            data={data}
            onProduct={setDrawerProduct}
            onReceive={setReceiveProduct}
            onWriteoff={setWriteoffProduct}
            onEdit={setModalProduct}
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
        onClose={() => setDrawerProduct(null)}
        onReceive={setReceiveProduct}
        onWriteoff={setWriteoffProduct}
        onEdit={setModalProduct}
      />
      <ProductModal open={Boolean(modalProduct)} onClose={() => setModalProduct(null)} product={modalProduct} suppliers={data.suppliers} />
      <ProductModal open={showCreateProduct} onClose={() => setShowCreateProduct(false)} suppliers={data.suppliers} />
      <ReceivingModal open={receiveProduct !== undefined} onClose={() => setReceiveProduct(undefined)} initialProduct={receiveProduct} products={data.products} inventory={data.inventory} />
      <WriteoffModal open={Boolean(writeoffProduct)} onClose={() => setWriteoffProduct(null)} products={writeoffProduct ? [writeoffProduct] : data.products} inventory={data.inventory} />
    </div>
  )
}

function InventoryTable({ rows, data, onProduct, onReceive, onWriteoff, onEdit }) {
  if (!rows.length) {
    return <EmptyState icon={<Package size={22} />} title="Остатки не найдены" description="Измените поиск или сбросьте фильтры." />
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <table className="w-full min-w-[960px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2.5 text-left">Товар</th>
            <th className="px-3 py-2.5 text-right">На складе</th>
            <th className="px-3 py-2.5 text-right">Доступно</th>
            <th className="px-3 py-2.5 text-right">Резерв</th>
            <th className="px-3 py-2.5 text-right">Закупка</th>
            <th className="px-3 py-2.5 text-right">Продажа</th>
            <th className="px-3 py-2.5 text-right">Стоимость</th>
            <th className="px-3 py-2.5 text-left">Статус</th>
            <th className="px-3 py-2.5 text-right">Операции</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(({ product, inv }) => {
            const status = getStockStatus(inv)
            const last = getLastMovementForProduct(getId(product), data.movements)
            const stockValue = getInventoryFifoValue(inv, data.batches)
            return (
              <tr key={getId(product)} className="hover:bg-slate-50">
                <td className="px-3 py-2.5">
                  <button onClick={() => onProduct(product)} className="flex min-w-0 items-center gap-3 text-left">
                    <ProductThumb product={product} />
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-slate-900">{getProductName(product)}</span>
                      <span className="block font-mono text-xs text-slate-400">{getProductSku(product)}</span>
                    </span>
                  </button>
                </td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-950">{getQuantity(inv)}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-700">{getAvailableQty(inv)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{getReservedQty(inv)}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-600">{fmtMoney(getPurchasePrice(product))}</td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-indigo-700">{fmtMoney(getSalePrice(product))}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-700">{fmtMoney(stockValue)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col gap-1.5">
                    <Badge variant={isProductActive(product) ? STOCK_STATUS_BADGE[status] : 'slate'}>{isProductActive(product) ? STOCK_STATUS_LABEL[status] : 'Неактивен'}</Badge>
                    <span className="text-xs text-slate-400">{last ? fmtDate(last.created_at ?? last.CreatedAt) : 'Нет движений'}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <IconAction title="Приход" icon={<Download size={15} />} onClick={() => onReceive(product)} />
                    <IconAction title="Списание" icon={<Trash2 size={15} />} onClick={() => onWriteoff(product)} danger />
                    <IconAction title="Изменить" icon={<Pencil size={15} />} onClick={() => onEdit(product)} />
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

function InventoryCard({ inv, product, data, onProduct, onReceive, onWriteoff, onEdit }) {
  const status = getStockStatus(inv)
  const last = getLastMovementForProduct(getId(product), data.movements)
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
            <Badge variant={isProductActive(product) ? STOCK_STATUS_BADGE[status] : 'slate'}>{isProductActive(product) ? STOCK_STATUS_LABEL[status] : 'Неактивен'}</Badge>
          </div>
        </div>
      </button>
      <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-2.5 text-center">
        <MiniMetric label="Склад" value={getQuantity(inv)} />
        <MiniMetric label="Доступ" value={getAvailableQty(inv)} tone="emerald" />
        <MiniMetric label="Резерв" value={getReservedQty(inv)} tone="amber" />
        <MiniMetric label="Продажа" value={fmtMoney(getSalePrice(product))} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span className="flex items-center gap-1"><Clock size={13} />{last ? fmtDate(last.created_at ?? last.CreatedAt) : 'Нет движений'}</span>
        <span>{fmtMoney(getInventoryFifoValue(inv, data.batches))}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button size="sm" icon={<Download size={14} />} onClick={() => onReceive(product)}>Приход</Button>
        <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => onWriteoff(product)}>Списать</Button>
        <Button size="sm" icon={<Pencil size={14} />} onClick={() => onEdit(product)}>Изм.</Button>
      </div>
    </article>
  )
}

function getInventoryFifoValue(inv, batches = []) {
  if (!inv) return 0
  const productId = inv.product_id ?? inv.ProductID
  return batches
    .filter((b) => (b.product_id ?? b.ProductID) === productId)
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
