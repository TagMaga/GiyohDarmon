import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeftRight, Download, Package, PackagePlus, RefreshCw, Search, Trash2, Warehouse } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import Alert from '../../../shared/components/Alert'
import Badge from '../../../shared/components/Badge'
import ProductModal from '../components/ProductModal'
import ReceivingModal from '../components/ReceivingModal'
import WriteoffModal from '../components/WriteoffModal'
import useWarehouseData from '../hooks/useWarehouseData'
import { MovementList } from './WarehouseMovementsPage'
import {
  MOVEMENT_BADGE,
  MOVEMENT_LABEL,
  STOCK_STATUS_BADGE,
  STOCK_STATUS_LABEL,
  fmtDate,
  fmtMoney,
  getAvailableQty,
  getId,
  getMovementType,
  getProductImageSrcSet,
  getProductImageVariant,
  getProductName,
  getProductSku,
  getQuantity,
  getStockStatus,
} from '../utils/warehouseHelpers'

export default function WarehouseDashboard() {
  const navigate = useNavigate()
  const data = useWarehouseData()
  const [query, setQuery] = useState('')
  const [showProduct, setShowProduct] = useState(false)
  const [receiveProduct, setReceiveProduct] = useState(undefined)
  const [showWriteoff, setShowWriteoff] = useState(false)

  const stockAlerts = useMemo(() => data.inventory
    .filter((inv) => {
      const status = getStockStatus(inv)
      return status === 'low_stock' || status === 'out_of_stock'
    })
    .slice(0, 6), [data.inventory])

  function submitSearch(e) {
    e.preventDefault()
    navigate(query.trim() ? `/warehouse/inventory?q=${encodeURIComponent(query.trim())}` : '/warehouse/inventory')
  }

  return (
    <div className="animate-fade-in p-6">
      <PageHeader
        title="Склад"
        subtitle="Остатки, приход и списания"
        icon={<Warehouse size={20} />}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={data.refetchAll}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
              aria-label="Обновить данные склада"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        }
      />

      {data.error && (
        <Alert variant="error" title="Ошибка загрузки данных" className="mb-5">
          {data.error?.response?.data?.error?.message ?? data.error?.message}
        </Alert>
      )}

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <form onSubmit={submitSearch} className="flex min-h-[42px] gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
            <div className="flex flex-1 items-center gap-2">
              <Search size={17} className="text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по товару, SKU или штрихкоду…"
                className="h-10 w-full border-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            <button type="submit" className="text-sm font-semibold text-indigo-700 hover:text-indigo-900">Найти</button>
          </form>
          <ActionToolbar
            onReceive={() => setReceiveProduct(null)}
            onWriteoff={() => setShowWriteoff(true)}
            onProduct={() => setShowProduct(true)}
          />
        </div>
      </section>

      <MetricsStrip products={data.products} inventory={data.inventory} movements={data.movements} batches={data.batches} loading={data.loading} />

      <section className="space-y-4">
        <Panel title="Требует внимания" subtitle="Товары с низким остатком и отсутствующие позиции.">
          {stockAlerts.length === 0 ? (
            <CompactEmpty icon={<Package size={18} />} title="Критичных остатков нет" description="Низкие остатки появятся здесь." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {stockAlerts.map((inv) => (
                <ProblemProductRow
                  key={getId(inv)}
                  inventory={inv}
                  product={data.productMap[inv.product_id ?? inv.ProductID]}
                  onOpen={() => navigate(`/warehouse/inventory?q=${encodeURIComponent(getProductSku(data.productMap[inv.product_id ?? inv.ProductID]))}`)}
                  onReceive={() => setReceiveProduct(data.productMap[inv.product_id ?? inv.ProductID] ?? null)}
                />
              ))}
            </div>
          )}
        </Panel>

        <section>
          <div className="mb-3">
            <h2 className="text-sm font-bold text-slate-950">Движения</h2>
            <p className="mt-1 text-xs text-slate-400">Полная лента операций склада.</p>
          </div>
          <MovementList rows={data.movements} data={data} />
        </section>
      </section>

      <ProductModal open={showProduct} onClose={() => setShowProduct(false)} suppliers={data.suppliers} />
      <ReceivingModal open={receiveProduct !== undefined} onClose={() => setReceiveProduct(undefined)} initialProduct={receiveProduct} products={data.products} inventory={data.inventory} />
      <WriteoffModal open={showWriteoff} onClose={() => setShowWriteoff(false)} products={data.products} inventory={data.inventory} />
    </div>
  )
}

function Panel({ title, subtitle, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
        <h2 className="text-sm font-bold text-slate-950">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function ActionToolbar({ onReceive, onWriteoff, onProduct }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="primary" icon={<Download size={14} />} onClick={onReceive}>Новый приход</Button>
      <Button size="sm" icon={<Trash2 size={14} />} onClick={onWriteoff}>Списание</Button>
      <Button size="sm" icon={<PackagePlus size={14} />} onClick={onProduct}>Добавить товар</Button>
    </div>
  )
}

function MetricsStrip({ products = [], inventory = [], movements = [], batches = [], loading = false }) {
  const totalUnits = inventory.reduce((sum, inv) => sum + getQuantity(inv), 0)
  const stockValue = batches.reduce(
    (sum, b) => sum + (b.remaining_quantity ?? b.RemainingQuantity ?? 0) * (b.unit_cost ?? b.UnitCost ?? 0),
    0
  )
  const lowStock = inventory.filter((inv) => getStockStatus(inv) === 'low_stock').length
  const outStock = inventory.filter((inv) => getStockStatus(inv) === 'out_of_stock').length
  const today = new Date().toDateString()
  const movementsToday = movements.filter((m) => {
    const d = m.created_at ?? m.CreatedAt
    if (!d) return false
    try { return new Date(d).toDateString() === today } catch { return false }
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
    <div className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)] sm:grid-cols-3 xl:grid-cols-6">
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

function OperationFeed({ movements, data }) {
  if (!movements.length) {
    return <CompactEmpty icon={<ArrowLeftRight size={18} />} title="Операций пока нет" description="Новые движения появятся в этой ленте." />
  }
  return (
    <div className="divide-y divide-slate-100">
      {movements.map((m) => {
        const type = getMovementType(m)
        const product = data.productMap[m.product_id ?? m.ProductID]
        const user = m.created_by_name ?? m.CreatedByName ?? '—'
        return (
          <div key={getId(m)} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant={MOVEMENT_BADGE[type] ?? 'slate'}>{MOVEMENT_LABEL[type] ?? type}</Badge>
                <span className="truncate text-sm font-bold text-slate-950">{getProductName(product)}</span>
              </div>
              <p className="truncate text-xs text-slate-400">{user}</p>
            </div>
            <div className="flex items-center justify-between gap-4 sm:block sm:text-right">
              <p className="text-sm font-bold tabular-nums text-slate-950">{m.quantity ?? m.Quantity}</p>
              <p className="text-xs text-slate-400">{fmtDate(m.created_at ?? m.CreatedAt)}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CompactEmpty({ icon, title, description }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-200 px-4 py-5 text-left">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">{icon}</div>
      <div>
        <p className="text-sm font-bold text-slate-800">{title}</p>
        <p className="mt-0.5 text-xs text-slate-400">{description}</p>
      </div>
    </div>
  )
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
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400">
      <Package size={16} />
    </div>
  )
}
