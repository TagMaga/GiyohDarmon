import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Archive, Clock, Download, Package, PackagePlus, Pencil, Trash2 } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import Badge from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import Alert from '../../../shared/components/Alert'
import ProductDrawer from '../components/ProductDrawer'
import ProductModal from '../components/ProductModal'
import ReceivingModal from '../components/ReceivingModal'
import WriteoffModal from '../components/WriteoffModal'
import ArchiveProductModal from '../components/ArchiveProductModal'
import { CourierWarehouseSummary } from '../components/TransferComponents'
import useWarehouseData from '../hooks/useWarehouseData'
import { useInventoryDistribution, useInventorySummary } from '../hooks/useTransfers'
import useExpiryAlerts from '../hooks/useExpiryAlerts'
import {
  aggregateStocks,
  DistributionText,
  getDerivedStockStatus,
  getExpiryBucket,
  getLocationDisplayName,
  MAIN_WAREHOUSE_ID,
  InventoryFilterBar,
} from '../components/InventoryFilters'
import {
  STOCK_STATUS_BADGE,
  STOCK_STATUS_LABEL,
  fmtDate,
  fmtExpiryDate,
  fmtMoney,
  getAvailableQty,
  getId,
  getLastMovementForProduct,
  getLastPrice,
  getNearestExpiry,
  getProductBarcode,
  getProductImageSrcSet,
  getProductImageVariant,
  getProductName,
  getProductSku,
  getPurchasePrice,
  getQuantity,
  getReservedQty,
  getSalePrice,
  hasAlertForProduct,
  isProductActive,
  sumAlertUnitsForProduct,
} from '../utils/warehouseHelpers'

export default function WarehouseInventoryPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [selectedProducts, setSelectedProducts] = useState([])
  const [selectedWarehouses, setSelectedWarehouses] = useState([])
  const [selectedStatuses, setSelectedStatuses] = useState([])
  const [selectedExpiry, setSelectedExpiry] = useState([])
  const [drawerProduct, setDrawerProduct] = useState(null)
  const [modalProduct, setModalProduct] = useState(null)
  const [showCreateProduct, setShowCreateProduct] = useState(false)
  const [receiveProduct, setReceiveProduct] = useState(undefined)
  const [writeoffProduct, setWriteoffProduct] = useState(null)
  const [archiveTarget, setArchiveTarget] = useState(null)
  const data = useWarehouseData()
  const { data: invSummary } = useInventorySummary()
  const distributionQ = useInventoryDistribution()
  const { alerts: expiryAlerts } = useExpiryAlerts()
  const activeProducts = useMemo(
    () => data.products.filter(isProductActive),
    [data.products],
  )

  const distribution = useMemo(() => {
    if (distributionQ.data) return distributionQ.data
    return {
      locations: [{ id: MAIN_WAREHOUSE_ID, type: 'main', name: 'Главный склад' }],
      items: data.inventory.map((inv) => ({
        product_id: inv.product_id ?? inv.ProductID,
        warehouse_id: MAIN_WAREHOUSE_ID,
        quantity: getQuantity(inv),
        reserved_quantity: getReservedQty(inv),
        blocked_quantity: inv.blocked_quantity ?? inv.BlockedQuantity ?? 0,
        available_quantity: getAvailableQty(inv),
      })),
    }
  }, [data.inventory, distributionQ.data])

  const locations = distribution.locations ?? []
  const locationById = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  )
  const stockByProduct = useMemo(() => {
    const result = new Map()
    for (const item of distribution.items ?? []) {
      const productId = item.product_id
      if (!result.has(productId)) result.set(productId, [])
      result.get(productId).push({
        ...item,
        location: locationById.get(item.warehouse_id) ?? {
          id: item.warehouse_id,
          name: 'Склад',
          type: 'courier',
        },
      })
    }
    return result
  }, [distribution.items, locationById])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const inventoryByProduct = new Map(data.inventory.map((inv) => [inv.product_id ?? inv.ProductID, inv]))
    return activeProducts.map((product) => {
      const productId = getId(product)
      const inv = inventoryByProduct.get(productId) ?? null
      const allStocks = stockByProduct.get(productId) ?? []
      const visibleStocks = selectedWarehouses.length
        ? allStocks.filter((stock) => selectedWarehouses.includes(stock.warehouse_id))
        : allStocks
      const includesMain = !selectedWarehouses.length ||
        selectedWarehouses.some((id) => locationById.get(id)?.type === 'main')
      const metrics = aggregateStocks(visibleStocks)
      const nearestExpiry = includesMain ? getNearestExpiry(productId, data.batches) : null
      const expiryBucket = getExpiryBucket(nearestExpiry)
      const lowThreshold = inv?.low_stock_threshold ?? inv?.LowStockThreshold ?? 0
      const flags = {
        in_stock: metrics.quantity > 0 && metrics.available > lowThreshold,
        low_stock: metrics.quantity > 0 && metrics.available <= lowThreshold,
        out_of_stock: metrics.quantity <= 0,
        reserved: metrics.reserved > 0,
        courier: metrics.courierQuantity > 0,
        in_transfer: metrics.blocked > 0,
      }
      return {
        product,
        inv,
        allStocks,
        visibleStocks,
        metrics: { ...metrics, includesMain },
        nearestExpiry,
        expiryBucket,
        flags,
      }
    }).filter((row) => {
      const { product, flags, expiryBucket } = row
      if (selectedProducts.length && !selectedProducts.includes(getId(product))) return false
      if (selectedStatuses.length && !selectedStatuses.some((status) => flags[status])) return false
      if (selectedExpiry.length && !selectedExpiry.includes(expiryBucket)) return false
      if (!q) return true
      return (
        getProductName(product).toLowerCase().includes(q) ||
        getProductSku(product).toLowerCase().includes(q) ||
        getProductBarcode(product).toLowerCase().includes(q)
      )
    })
  }, [
    data.batches,
    data.inventory,
    activeProducts,
    locationById,
    search,
    selectedExpiry,
    selectedProducts,
    selectedStatuses,
    selectedWarehouses,
    stockByProduct,
  ])

  const filteredSummary = useMemo(() => {
    const summary = {
      main_quantity: 0,
      main_reserved: 0,
      main_blocked: 0,
      courier_quantity: 0,
      courier_reserved: 0,
      pending_transfers: 0,
      pending_returns: invSummary?.pending_returns ?? 0,
      pending_lost_reports: invSummary?.pending_lost_reports ?? 0,
    }
    for (const row of filteredRows) {
      summary.main_quantity += row.metrics.mainQuantity
      summary.main_reserved += row.metrics.mainReserved
      summary.main_blocked += row.metrics.mainBlocked
      summary.courier_quantity += row.metrics.courierQuantity
      summary.courier_reserved += row.metrics.courierReserved
      summary.pending_transfers += row.metrics.blocked
    }
    return summary
  }, [filteredRows, invSummary])

  return (
    <div className="animate-fade-in p-6 pb-20 lg:pb-6">
      <PageHeader
        title="Остатки и товары"
        subtitle="Карточки товаров, цены, доступность и складские операции."
        icon={<Package size={20} />}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              icon={<Archive size={15} />}
              onClick={() => navigate('/warehouse/archive')}
            >
              Архив
            </Button>
            <Button icon={<PackagePlus size={15} />} onClick={() => setShowCreateProduct(true)}>Добавить товар</Button>
          </div>
        }
      />

      {(data.error || distributionQ.error) && (
        <Alert variant="error" title="Ошибка загрузки данных" className="mb-5">
          {(data.error || distributionQ.error)?.response?.data?.error?.message ?? (data.error || distributionQ.error)?.message}
        </Alert>
      )}

      <InventoryFilterBar
        className="mb-4"
        search={search}
        onSearch={setSearch}
        productOptions={activeProducts.map((product) => ({
          value: getId(product),
          label: getProductName(product),
          description: getProductSku(product),
        }))}
        locationOptions={locations.map((location) => ({
          value: location.id,
          label: getLocationDisplayName(location),
          description: location.type === 'main' ? 'Главный склад' : 'Склад курьера',
        }))}
        selectedProducts={selectedProducts}
        onProducts={setSelectedProducts}
        selectedWarehouses={selectedWarehouses}
        onWarehouses={setSelectedWarehouses}
        selectedStatuses={selectedStatuses}
        onStatuses={setSelectedStatuses}
        selectedExpiry={selectedExpiry}
        onExpiry={setSelectedExpiry}
        resultCount={filteredRows.length}
      />

      <div className="mb-4"><CourierWarehouseSummary summary={filteredSummary} detailed /></div>

      <div className="hidden lg:block">
          <InventoryTable
          rows={filteredRows}
          data={data}
          expiryAlerts={expiryAlerts}
          onProduct={setDrawerProduct}
          onReceive={setReceiveProduct}
          onWriteoff={setWriteoffProduct}
          onEdit={setModalProduct}
          onArchive={setArchiveTarget}
        />
      </div>
      <div className="space-y-3 lg:hidden">
        {filteredRows.length === 0 ? (
          <EmptyState icon={<Package size={22} />} title="Остатки не найдены" description="Измените поиск или сбросьте фильтры." />
        ) : filteredRows.map((row) => (
          <InventoryCard
            key={getId(row.product)}
            row={row}
            data={data}
            expiryAlerts={expiryAlerts}
            onProduct={setDrawerProduct}
            onReceive={setReceiveProduct}
            onWriteoff={setWriteoffProduct}
            onEdit={setModalProduct}
            onArchive={setArchiveTarget}
          />
        ))}
      </div>

      <button
        onClick={() => setReceiveProduct(null)}
        className="fixed bottom-24 right-5 z-30 flex min-h-[56px] items-center gap-2 rounded-full bg-indigo-600 px-5 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 lg:hidden"
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
      <ReceivingModal open={receiveProduct !== undefined} onClose={() => setReceiveProduct(undefined)} initialProduct={receiveProduct} products={activeProducts} inventory={data.inventory} />
      <WriteoffModal open={Boolean(writeoffProduct)} onClose={() => setWriteoffProduct(null)} products={writeoffProduct ? [writeoffProduct] : activeProducts} inventory={data.inventory} />
      <ArchiveProductModal
        product={archiveTarget?.product}
        stocks={archiveTarget?.allStocks}
        onClose={() => setArchiveTarget(null)}
      />
    </div>
  )
}

function InventoryTable({ rows, data, expiryAlerts = [], onProduct, onReceive, onWriteoff, onEdit, onArchive }) {
  if (!rows.length) {
    return <EmptyState icon={<Package size={22} />} title="Остатки не найдены" description="Измените поиск или сбросьте фильтры." />
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <table className="w-full min-w-[1320px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2.5 text-left">Товар</th>
            <th className="px-3 py-2.5 text-right">Остаток</th>
            <th className="px-3 py-2.5 text-right">Доступно</th>
            <th className="px-3 py-2.5 text-right">Резерв</th>
            <th className="min-w-[260px] px-3 py-2.5 text-left">Распределение</th>
            <th className="px-3 py-2.5 text-right">Посл. цена</th>
            <th className="px-3 py-2.5 text-right">Продажа</th>
            <th className="px-3 py-2.5 text-right">Стоимость</th>
            <th className="px-3 py-2.5 text-left">Срок годности</th>
            <th className="px-3 py-2.5 text-left">Статус</th>
            <th className="px-3 py-2.5 text-right">Операции</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const { product, inv, metrics, nearestExpiry, visibleStocks } = row
            const status = getDerivedStockStatus(metrics, inv)
            const last = getLastMovementForProduct(getId(product), data.movements)
            const stockValue = getInventoryFifoValue(inv, data.batches)
            const productId = getId(product)
            const expiringUnits = metrics.includesMain ? sumAlertUnitsForProduct(productId, expiryAlerts) : 0
            const flagged = metrics.includesMain && hasAlertForProduct(productId, expiryAlerts)
            return (
              <tr key={productId} className="hover:bg-slate-50">
                <td className="px-3 py-2.5">
                  <button onClick={() => onProduct(product)} className="flex min-w-0 items-center gap-3 text-left">
                    <ProductThumb product={product} />
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-slate-900">{getProductName(product)}</span>
                      <span className="block font-mono text-xs text-slate-400">{getProductSku(product)}</span>
                    </span>
                  </button>
                </td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-950">{metrics.quantity}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-700">{metrics.available}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{metrics.reserved}</td>
                <td className="px-3 py-2.5"><DistributionText stocks={visibleStocks} /></td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-600">{fmtMoney(getLastPrice(getId(product), data.movements) ?? getPurchasePrice(product))}</td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-indigo-700">{fmtMoney(getSalePrice(product))}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-700">{metrics.includesMain ? fmtMoney(stockValue) : '—'}</td>
                <td className="px-3 py-2.5">
                  {nearestExpiry ? (
                    <div className="flex items-center gap-1.5">
                      {flagged && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-rose-500" title="Есть просроченная или скоро истекающая партия" />}
                      <span className={`text-xs font-semibold ${flagged ? 'text-rose-700' : 'text-slate-600'}`}>{fmtExpiryDate(nearestExpiry)}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">{metrics.includesMain ? 'Не указан' : 'Не отслеживается'}</span>
                  )}
                  {expiringUnits > 0 && <p className="mt-0.5 text-[11px] text-rose-500">{expiringUnits} шт. ≤14 дней</p>}
                </td>
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
                    <IconAction title="В архив" icon={<Archive size={15} />} onClick={() => onArchive(row)} />
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

function InventoryCard({ row, data, expiryAlerts = [], onProduct, onReceive, onWriteoff, onEdit, onArchive }) {
  const { inv, product, metrics, nearestExpiry, visibleStocks } = row
  const status = getDerivedStockStatus(metrics, inv)
  const last = getLastMovementForProduct(getId(product), data.movements)
  const productId = getId(product)
  const expiringUnits = metrics.includesMain ? sumAlertUnitsForProduct(productId, expiryAlerts) : 0
  const flagged = metrics.includesMain && hasAlertForProduct(productId, expiryAlerts)
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
        <MiniMetric label="Остаток" value={metrics.quantity} />
        <MiniMetric label="Доступ" value={metrics.available} tone="emerald" />
        <MiniMetric label="Резерв" value={metrics.reserved} tone="amber" />
        <MiniMetric label="Продажа" value={fmtMoney(getSalePrice(product))} />
      </div>
      <div className="mt-2 rounded-lg border border-slate-100 px-2.5 py-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Распределение</p>
        <DistributionText stocks={visibleStocks} />
      </div>
      {nearestExpiry && (
        <div className={`mt-2 flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ${flagged ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-500'}`}>
          <span className="flex items-center gap-1">{flagged && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}Срок годности: {fmtExpiryDate(nearestExpiry)}</span>
          {expiringUnits > 0 && <span className="font-semibold">{expiringUnits} шт. ≤14 дней</span>}
        </div>
      )}
      {!nearestExpiry && (
        <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-400">
          Срок годности: {metrics.includesMain ? 'не указан' : 'не отслеживается на складе курьера'}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span className="flex items-center gap-1"><Clock size={13} />{last ? fmtDate(last.created_at ?? last.CreatedAt) : 'Нет движений'}</span>
        <span>{fmtMoney(getInventoryFifoValue(inv, data.batches))}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" icon={<Download size={14} />} onClick={() => onReceive(product)}>Приход</Button>
        <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => onWriteoff(product)}>Списать</Button>
        <Button size="sm" icon={<Pencil size={14} />} onClick={() => onEdit(product)}>Изм.</Button>
        <Button size="sm" variant="secondary" icon={<Archive size={14} />} onClick={() => onArchive(row)}>В архив</Button>
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
  const image = getProductImageVariant(product, 'thumbnail')
  if (image) {
    return (
      <img
        src={image}
        srcSet={getProductImageSrcSet(product)}
        sizes="40px"
        loading="lazy"
        alt={getProductName(product)}
        className="h-10 w-10 flex-shrink-0 rounded-lg border border-slate-200 object-cover"
      />
    )
  }
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
