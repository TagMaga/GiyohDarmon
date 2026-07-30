import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Archive,
  Building2,
  Download,
  FilterX,
  Package,
  PackagePlus,
  RefreshCw,
  Search,
  Trash2,
  Truck,
} from 'lucide-react'
import Alert from '../../../shared/components/Alert'
import Badge from '../../../shared/components/Badge'
import Button from '../../../shared/components/Button'
import ProductModal from '../../warehouse/components/ProductModal'
import ReceivingModal from '../../warehouse/components/ReceivingModal'
import WriteoffModal from '../../warehouse/components/WriteoffModal'
import ArchiveProductModal from '../../warehouse/components/ArchiveProductModal'
import ProductArchivePanel from '../../warehouse/components/ProductArchivePanel'
import {
  CourierWarehouseSummary,
  LostReportsPanel,
  NewTransferModal,
  PendingReturnsPanel,
  TRANSFER_STATUS_FILTERS,
  TransferList,
} from '../../warehouse/components/TransferComponents'
import useWarehouseData from '../../warehouse/hooks/useWarehouseData'
import { useInventoryDistribution, useInventorySummary, useTransfers } from '../../warehouse/hooks/useTransfers'
import { MovementList } from '../../warehouse/pages/WarehouseMovementsPage'
import SalesReportPanel from '../../warehouse/pages/WarehouseSalesReportPanel'
import OwnerWarehouseMobile from '../components/OwnerWarehouseMobile'
import ExpiryAlertsPanel from '../../warehouse/components/ExpiryAlertsPanel'
import useExpiryAlerts from '../../warehouse/hooks/useExpiryAlerts'
import {
  aggregateStocks,
  DistributionText,
  getDerivedStockStatus,
  getExpiryBucket,
  getLocationDisplayName,
  InventoryFilterBar,
  MAIN_WAREHOUSE_ID,
} from '../../warehouse/components/InventoryFilters'
import { getNearestExpiry, hasAlertForProduct, sumAlertUnitsForProduct, fmtExpiryDate } from '../../warehouse/utils/warehouseHelpers'
import {
  STOCK_STATUS_BADGE,
  STOCK_STATUS_LABEL,
  fmtMoney,
  getAvailableQty,
  getId,
  getLastMovementForProduct,
  getLastPrice,
  getMovementType,
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
  isUUID,
} from '../../warehouse/utils/warehouseHelpers'

const TABS = [
  { id: 'dashboard', label: 'Дашборд' },
  { id: 'inventory', label: 'Остатки и товары' },
  { id: 'archive', label: 'Архив' },
  { id: 'receiving', label: 'Приёмка и списания' },
  { id: 'movements', label: 'Движение товара' },
  { id: 'reports', label: 'Отчёты' },
]

const MOVEMENT_TYPES = [
  { value: '', label: 'Все типы' },
  { value: 'purchase', label: 'Приход' },
  { value: 'adjustment', label: 'Корректировка' },
  { value: 'writeoff', label: 'Списание' },
  { value: 'sale', label: 'Продажа' },
  { value: 'return', label: 'Возврат' },
]

export default function OwnerWarehousePage() {
  const navigate = useNavigate()
  const [routeParams] = useSearchParams()
  const requestedProduct = routeParams.get('q') ?? ''
  const [tab, setTab] = useState(requestedProduct ? 'inventory' : 'dashboard')
  const [inventorySearch, setInventorySearch] = useState(requestedProduct)
  const [selectedProducts, setSelectedProducts] = useState([])
  const [selectedWarehouses, setSelectedWarehouses] = useState([])
  const [selectedStatuses, setSelectedStatuses] = useState([])
  const [selectedExpiry, setSelectedExpiry] = useState([])
  const [movementSearch, setMovementSearch] = useState('')
  const [movementType, setMovementType] = useState('')
  const [movementProductId, setMovementProductId] = useState('')
  const [showProduct, setShowProduct] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [receiveProduct, setReceiveProduct] = useState(undefined)
  const [writeoffProduct, setWriteoffProduct] = useState(undefined)
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [showNewTransfer, setShowNewTransfer] = useState(false)
  const [transferStatus, setTransferStatus] = useState('')
  const data = useWarehouseData()
  const { data: transfers = [], isLoading: transfersLoading } = useTransfers({ status: transferStatus })
  const { data: invSummary, refetch: refetchSummary } = useInventorySummary()
  const distributionQ = useInventoryDistribution()
  const { alerts: expiryAlerts } = useExpiryAlerts()
  const activeProducts = useMemo(
    () => data.products.filter(isProductActive),
    [data.products],
  )
  const activeProductIds = useMemo(
    () => new Set(activeProducts.map((product) => getId(product))),
    [activeProducts],
  )

  useEffect(() => {
    if (!requestedProduct) return
    setInventorySearch(requestedProduct)
    setTab('inventory')
  }, [requestedProduct])

  const inventoryByProduct = useMemo(
    () => new Map(data.inventory.map((inv) => [inv.product_id ?? inv.ProductID, inv])),
    [data.inventory]
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
      if (!result.has(item.product_id)) result.set(item.product_id, [])
      result.get(item.product_id).push({
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

  const inventoryRows = useMemo(() => {
    const q = inventorySearch.trim().toLowerCase()
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
    activeProducts,
    inventoryByProduct,
    inventorySearch,
    locationById,
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
    for (const row of inventoryRows) {
      summary.main_quantity += row.metrics.mainQuantity
      summary.main_reserved += row.metrics.mainReserved
      summary.main_blocked += row.metrics.mainBlocked
      summary.courier_quantity += row.metrics.courierQuantity
      summary.courier_reserved += row.metrics.courierReserved
      summary.pending_transfers += row.metrics.blocked
    }
    return summary
  }, [inventoryRows, invSummary])

  const stockAlerts = useMemo(() => data.inventory
    .filter((inv) => activeProductIds.has(inv.product_id ?? inv.ProductID))
    .filter((inv) => {
      const status = getStockStatus(inv)
      return status === 'low_stock' || status === 'out_of_stock'
    })
    .slice(0, 6), [activeProductIds, data.inventory])

  const receivingRows = useMemo(() => data.movements.filter((m) => {
    const type = getMovementType(m)
    return type === 'purchase' || type === 'adjustment' || type === 'writeoff'
  }), [data.movements])

  const movementRows = useMemo(() => {
    const q = movementSearch.trim().toLowerCase()
    return data.movements.filter((m) => {
      const product = data.productMap[m.product_id ?? m.ProductID]
      if (movementType && getMovementType(m) !== movementType) return false
      if (movementProductId && (m.product_id ?? m.ProductID) !== movementProductId) return false
      if (!q) return true
      return (
        getProductName(product).toLowerCase().includes(q) ||
        getProductSku(product).toLowerCase().includes(q) ||
        (m.reason ?? m.Reason ?? '').toLowerCase().includes(q) ||
        (m.created_by_name ?? m.CreatedByName ?? '').toLowerCase().includes(q)
      )
    })
  }, [data.movements, data.productMap, movementProductId, movementSearch, movementType])

  const validProducts = data.products.filter((p) => isUUID(getId(p)))

  function clearMovementFilters() {
    setMovementSearch('')
    setMovementType('')
    setMovementProductId('')
  }

  function refreshAll() {
    data.refetchAll()
    distributionQ.refetch()
    refetchSummary()
  }

  return (
    <>
      <div className="lg:hidden">
        <OwnerWarehouseMobile
          tab={tab}
          onTab={setTab}
          data={data}
          inventorySearch={inventorySearch}
          onInventorySearch={setInventorySearch}
          selectedProducts={selectedProducts}
          onProducts={setSelectedProducts}
          selectedWarehouses={selectedWarehouses}
          onWarehouses={setSelectedWarehouses}
          selectedStatuses={selectedStatuses}
          onStatuses={setSelectedStatuses}
          selectedExpiry={selectedExpiry}
          onExpiry={setSelectedExpiry}
          inventoryLocations={locations}
          inventoryDistribution={distribution}
          filteredSummary={filteredSummary}
          movementSearch={movementSearch}
          onMovementSearch={setMovementSearch}
          movementType={movementType}
          onMovementType={setMovementType}
          movementProductId={movementProductId}
          onMovementProductId={setMovementProductId}
          clearMovementFilters={clearMovementFilters}
          inventoryRows={inventoryRows}
          stockAlerts={stockAlerts}
          receivingRows={receivingRows}
          movementRows={movementRows}
          validProducts={validProducts}
          onReceive={setReceiveProduct}
          onWriteoff={setWriteoffProduct}
          onEdit={setEditingProduct}
          onArchive={setArchiveTarget}
          onProduct={() => setShowProduct(true)}
          onOpenAlert={(product) => {
            setInventorySearch(getProductSku(product))
            setTab('inventory')
          }}
          onRefresh={refreshAll}
        />
      </div>

    <div className="hidden lg:block p-4 md:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">Склад</h1>
          <p className="text-[12.5px] text-slate-400 mt-0.5">Остатки, товары, приёмка, списания и движение товара</p>
        </div>
        <button
          onClick={refreshAll}
          className="flex min-h-[44px] flex-shrink-0 items-center gap-2 rounded-[10px] bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 transition-all hover:bg-slate-200"
        >
          <RefreshCw size={14} />
          <span className="hidden sm:inline">Обновить</span>
        </button>
      </div>

      <div className="inline-flex max-w-full overflow-x-auto rounded-[10px] bg-slate-100 p-[3px]">
        {TABS.map((item) => {
          const active = tab === item.id
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={[
                'flex items-center gap-1.5 rounded-[7px] px-3.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap transition-all duration-150',
                active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              ].join(' ')}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {(data.error || distributionQ.error) && (
        <Alert variant="error" title="Ошибка загрузки данных">
          {(data.error || distributionQ.error)?.response?.data?.error?.message ?? (data.error || distributionQ.error)?.message}
        </Alert>
      )}

      {tab === 'dashboard' && (
        <div className="animate-fade-in space-y-4">
          <DashboardToolbar
            query={inventorySearch}
            onQuery={setInventorySearch}
            onSearch={() => setTab('inventory')}
            onReceive={() => setReceiveProduct(null)}
            onWriteoff={() => setWriteoffProduct(null)}
            onProduct={() => setShowProduct(true)}
          />
          <MetricsStrip products={activeProducts} inventory={data.inventory.filter((inv) => activeProductIds.has(inv.product_id ?? inv.ProductID))} movements={data.movements} batches={data.batches.filter((batch) => activeProductIds.has(batch.product_id ?? batch.ProductID))} loading={data.loading} />
          <CourierWarehouseSummary summary={invSummary} />
          <AttentionPanel
            alerts={stockAlerts}
            data={data}
            onOpen={(product) => {
              setInventorySearch(getProductSku(product))
              setTab('inventory')
            }}
            onReceive={setReceiveProduct}
          />
          <ExpiryAlertsPanel
            onOpenProduct={(alert) => {
              setInventorySearch(alert.sku)
              setTab('inventory')
            }}
          />
          <section>
            <div className="mb-3">
              <h2 className="text-sm font-bold text-slate-950">Движения</h2>
              <p className="mt-1 text-xs text-slate-400">Полная лента операций склада.</p>
            </div>
            <MovementList rows={data.movements} data={data} />
          </section>
        </div>
      )}

      {tab === 'inventory' && (
        <div className="animate-fade-in space-y-4">
          <InventoryFilterBar
            search={inventorySearch}
            onSearch={setInventorySearch}
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
            resultCount={inventoryRows.length}
          />
          <CourierWarehouseSummary summary={filteredSummary} detailed />
          <InventoryTable
            rows={inventoryRows}
            data={data}
            expiryAlerts={expiryAlerts}
            onReceive={setReceiveProduct}
            onWriteoff={setWriteoffProduct}
            onEdit={setEditingProduct}
            onArchive={setArchiveTarget}
          />
        </div>
      )}

      {tab === 'archive' && (
        <div className="animate-fade-in">
          <ProductArchivePanel
            products={data.products}
            inventory={data.inventory}
            distribution={distributionQ.data}
            loading={data.loading || distributionQ.isPending}
            error={data.error || distributionQ.error}
          />
        </div>
      )}

      {tab === 'receiving' && (
        <div className="animate-fade-in space-y-4">
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" icon={<Building2 size={15} />} onClick={() => navigate('/owner/pharmacies')}>Выдать аптеке</Button>
            <Button variant="primary" icon={<PackagePlus size={15} />} onClick={() => setReceiveProduct(null)}>Новая приёмка</Button>
            <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => setWriteoffProduct(null)}>Новое списание</Button>
          </div>
          <MovementList rows={receivingRows} data={data} emptyTitle="Операций пока нет" showEntryActions />
          <PendingReturnsPanel />
          <LostReportsPanel />
        </div>
      )}

      {tab === 'movements' && (
        <div className="animate-fade-in space-y-5">
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-950">Передачи курьерам</h2>
                <p className="mt-1 text-xs text-slate-400">Выдача товара курьеру со склада, история и статусы.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select className="input py-2" value={transferStatus} onChange={(e) => setTransferStatus(e.target.value)}>
                  {TRANSFER_STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <Button variant="primary" icon={<Truck size={15} />} onClick={() => setShowNewTransfer(true)}>Новая передача</Button>
              </div>
            </div>
            <TransferList transfers={transfers} loading={transfersLoading} />
          </section>

          <section className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)] lg:grid-cols-[minmax(0,1fr)_160px_210px_auto]">
            <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
              <Search size={17} className="text-slate-400" />
              <input
                value={movementSearch}
                onChange={(e) => setMovementSearch(e.target.value)}
                placeholder="Поиск по товару, пользователю или комментарию…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </label>
            <select className="input py-2" value={movementType} onChange={(e) => setMovementType(e.target.value)}>
              {MOVEMENT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select className="input py-2" value={movementProductId} onChange={(e) => setMovementProductId(e.target.value)}>
              <option value="">Все товары</option>
              {validProducts.map((product) => <option key={getId(product)} value={getId(product)}>{getProductName(product)}</option>)}
            </select>
            <Button icon={<FilterX size={15} />} onClick={clearMovementFilters}>Сбросить</Button>
          </section>
          <MovementList rows={movementRows} data={data} />
        </div>
      )}

      {tab === 'reports' && (
        <div className="animate-fade-in">
          <SalesReportPanel />
        </div>
      )}
    </div>

      <ProductModal open={showProduct} onClose={() => setShowProduct(false)} suppliers={data.suppliers} />
      <ProductModal open={Boolean(editingProduct)} onClose={() => setEditingProduct(null)} product={editingProduct} suppliers={data.suppliers} />
      <ReceivingModal open={receiveProduct !== undefined} onClose={() => setReceiveProduct(undefined)} initialProduct={receiveProduct} products={activeProducts} inventory={data.inventory} />
      <WriteoffModal open={writeoffProduct !== undefined} onClose={() => setWriteoffProduct(undefined)} products={writeoffProduct ? [writeoffProduct] : activeProducts} inventory={data.inventory} />
      <NewTransferModal open={showNewTransfer} onClose={() => setShowNewTransfer(false)} products={activeProducts} />
      <ArchiveProductModal
        product={archiveTarget?.product}
        stocks={archiveTarget?.allStocks}
        onClose={() => setArchiveTarget(null)}
      />
    </>
  )
}

function DashboardToolbar({ query, onQuery, onSearch, onReceive, onWriteoff, onProduct }) {
  function submit(e) {
    e.preventDefault()
    onSearch()
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <form onSubmit={submit} className="flex min-h-[42px] gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
          <div className="flex flex-1 items-center gap-2">
            <Search size={17} className="text-slate-400" />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Поиск по товару, SKU или штрихкоду…"
              className="h-10 w-full border-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          <button type="submit" className="text-sm font-semibold text-indigo-700 hover:text-indigo-900">Найти</button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon={<Download size={14} />} onClick={onReceive}>Новый приход</Button>
          <Button size="sm" icon={<Trash2 size={14} />} onClick={onWriteoff}>Списание</Button>
          <Button size="sm" icon={<PackagePlus size={14} />} onClick={onProduct}>Добавить товар</Button>
        </div>
      </div>
    </section>
  )
}

function MetricsStrip({ products = [], inventory = [], movements = [], batches = [], loading = false }) {
  const totalUnits = inventory.reduce((sum, inv) => sum + getQuantity(inv), 0)
  const stockValue = batches.reduce(
    (sum, batch) => sum + (batch.remaining_quantity ?? batch.RemainingQuantity ?? 0) * (batch.unit_cost ?? batch.UnitCost ?? 0),
    0
  )
  const lowStock = inventory.filter((inv) => getStockStatus(inv) === 'low_stock').length
  const outStock = inventory.filter((inv) => getStockStatus(inv) === 'out_of_stock').length
  const today = new Date().toDateString()
  const movementsToday = movements.filter((m) => {
    const date = m.created_at ?? m.CreatedAt
    if (!date) return false
    try { return new Date(date).toDateString() === today } catch { return false }
  }).length

  const items = [
    { label: 'Товаров', value: products.length.toLocaleString('ru-RU') },
    { label: 'Единиц', value: totalUnits.toLocaleString('ru-RU') },
    { label: 'Мало', value: lowStock.toLocaleString('ru-RU'), tone: lowStock ? 'amber' : 'slate' },
    { label: 'Нет', value: outStock.toLocaleString('ru-RU'), tone: outStock ? 'rose' : 'slate' },
    { label: 'Стоимость', value: fmtMoney(stockValue) },
    { label: 'Сегодня', value: movementsToday.toLocaleString('ru-RU') },
  ]

  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)] sm:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="border-b border-r border-slate-100 px-3 py-3 last:border-r-0 sm:[&:nth-child(3n)]:border-r-0 xl:border-b-0 xl:[&:nth-child(3n)]:border-r xl:[&:nth-child(6n)]:border-r-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{item.label}</p>
          <p className={`mt-1 truncate text-base font-bold tabular-nums ${item.tone === 'amber' ? 'text-amber-700' : item.tone === 'rose' ? 'text-rose-700' : 'text-slate-950'}`}>
            {loading ? '—' : item.value}
          </p>
        </div>
      ))}
    </div>
  )
}

function AttentionPanel({ alerts, data, onOpen, onReceive }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-950">Требует внимания</h2>
          <p className="mt-1 text-xs text-slate-400">Товары с низким остатком и отсутствующие позиции.</p>
        </div>
      </div>
      {alerts.length === 0 ? (
        <CompactEmpty icon={<Package size={18} />} title="Критичных остатков нет" description="Низкие остатки появятся здесь." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          {alerts.map((inv) => {
            const product = data.productMap[inv.product_id ?? inv.ProductID]
            return (
              <ProblemProductRow
                key={getId(inv)}
                inventory={inv}
                product={product}
                onOpen={() => onOpen(product)}
                onReceive={() => onReceive(product ?? null)}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

function ProblemProductRow({ inventory, product, onOpen, onReceive }) {
  const status = getStockStatus(inventory)
  return (
    <div className="grid gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_96px_116px_auto] md:items-center">
      <button onClick={onOpen} className="flex min-w-0 items-center gap-3 text-left">
        <ProductThumb product={product} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-950">{getProductName(product)}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-slate-400">{getProductSku(product)}</p>
        </div>
      </button>
      <div className="flex gap-4 text-xs md:block md:text-right">
        <span className="text-slate-500">Склад <b className="text-slate-950">{getQuantity(inventory)}</b></span>
        <span className="text-slate-500 md:mt-1 md:block">Доступ <b className="text-emerald-700">{getAvailableQty(inventory)}</b></span>
      </div>
      <div className="md:text-right">
        <Badge variant={STOCK_STATUS_BADGE[status]} dot>{STOCK_STATUS_LABEL[status]}</Badge>
      </div>
      <button onClick={onReceive} className="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50">
        Пополнить
      </button>
    </div>
  )
}

function InventoryTable({ rows, data, expiryAlerts = [], onReceive, onWriteoff, onEdit, onArchive }) {
  if (!rows.length) {
    return <CompactEmpty icon={<Package size={18} />} title="Остатки не найдены" description="Измените поиск или сбросьте фильтры." />
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
            <th className="px-3 py-2.5 text-right">Закупка</th>
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
                  <div className="flex min-w-0 items-center gap-3">
                    <ProductThumb product={product} />
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-slate-900">{getProductName(product)}</span>
                      <span className="block font-mono text-xs text-slate-400">{getProductSku(product)}</span>
                    </span>
                  </div>
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
                    <span className="text-xs text-slate-400">{last ? 'Обновлено' : 'Нет движений'}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <IconAction title="Приход" icon={<Download size={15} />} onClick={() => onReceive(product)} />
                    <IconAction title="Списание" icon={<Trash2 size={15} />} onClick={() => onWriteoff(product)} danger />
                    <IconAction title="Изменить" icon={<PackagePlus size={15} />} onClick={() => onEdit(product)} />
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

function getInventoryFifoValue(inv, batches = []) {
  if (!inv) return 0
  const productId = inv.product_id ?? inv.ProductID
  return batches
    .filter((batch) => (batch.product_id ?? batch.ProductID) === productId)
    .reduce((sum, batch) => sum + (batch.remaining_quantity ?? batch.RemainingQuantity ?? 0) * (batch.unit_cost ?? batch.UnitCost ?? 0), 0)
}

function ProductThumb({ product }) {
  const image = getProductImage(product)
  if (image) {
    return (
      <img
        src={image}
        alt={getProductName(product)}
        className="h-10 w-10 flex-shrink-0 rounded-lg border border-slate-200 object-cover"
      />
    )
  }
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400">
      <Package size={16} />
    </div>
  )
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

function CompactEmpty({ icon, title, description }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-5 text-left">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">{icon}</div>
      <div>
        <p className="text-sm font-bold text-slate-800">{title}</p>
        <p className="mt-0.5 text-xs text-slate-400">{description}</p>
      </div>
    </div>
  )
}
