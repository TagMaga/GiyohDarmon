import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeftRight, Download, Package, PackagePlus, PackageX, RefreshCw, Search, Trash2, Warehouse } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import Alert from '../../../shared/components/Alert'
import Badge from '../../../shared/components/Badge'
import ProductModal from '../components/ProductModal'
import { isSameAppDay } from '../../../shared/utils/date'
import ReceivingModal from '../components/ReceivingModal'
import WriteoffModal from '../components/WriteoffModal'
import { CourierWarehouseSummary } from '../components/TransferComponents'
import ExpiryAlertsPanel, { ExpiryAlertsList } from '../components/ExpiryAlertsPanel'
import NotificationBell from '../../../shared/components/NotificationBell'
import useWarehouseData from '../hooks/useWarehouseData'
import { useInventorySummary } from '../hooks/useTransfers'
import useExpiryAlerts from '../hooks/useExpiryAlerts'
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
  getLowStockThreshold,
  getMovementType,
  getProductImageSrcSet,
  getProductImageVariant,
  getProductName,
  getProductSku,
  getQuantity,
  getStockStatus,
  isProductActive,
} from '../utils/warehouseHelpers'

const INK = '#0B1020'
const MUTED = '#8A91A3'
const GRADIENT = 'linear-gradient(135deg, #4F46E5, #6D28D9)'
const CARD_SHADOW = '0 2px 8px rgba(15,23,42,.05)'

export default function WarehouseDashboard() {
  const navigate = useNavigate()
  const data = useWarehouseData()
  const [query, setQuery] = useState('')
  const [showProduct, setShowProduct] = useState(false)
  const [receiveProduct, setReceiveProduct] = useState(undefined)
  const [showWriteoff, setShowWriteoff] = useState(false)
  const { data: invSummary } = useInventorySummary()
  const activeProducts = useMemo(() => data.products.filter(isProductActive), [data.products])
  const activeProductIds = useMemo(
    () => new Set(activeProducts.map((product) => getId(product))),
    [activeProducts],
  )
  const activeInventory = useMemo(
    () => data.inventory.filter((inv) => activeProductIds.has(inv.product_id ?? inv.ProductID)),
    [activeProductIds, data.inventory],
  )
  const activeBatches = useMemo(
    () => data.batches.filter((batch) => activeProductIds.has(batch.product_id ?? batch.ProductID)),
    [activeProductIds, data.batches],
  )

  const stockAlerts = useMemo(() => activeInventory
    .filter((inv) => {
      const status = getStockStatus(inv)
      return status === 'low_stock' || status === 'out_of_stock'
    })
    .slice(0, 6), [activeInventory])

  const { alerts: expiryAlerts, meta: expiryMeta, isLoading: expiryLoading, isError: expiryIsError, error: expiryError } = useExpiryAlerts()
  const lowStock = activeInventory.filter((inv) => getStockStatus(inv) === 'low_stock').length
  const outStock = activeInventory.filter((inv) => getStockStatus(inv) === 'out_of_stock').length
  const totalUnits = activeInventory.reduce((sum, inv) => sum + getQuantity(inv), 0)
  const stockValue = activeBatches.reduce(
    (sum, batch) => sum + (batch.remaining_quantity ?? batch.RemainingQuantity ?? 0) * (batch.unit_cost ?? batch.UnitCost ?? 0),
    0
  )
  const today = new Date()
  const movementsToday = data.movements.filter((m) => {
    const d = m.created_at ?? m.CreatedAt
    if (!d) return false
    return isSameAppDay(d, today)
  }).length

  function submitSearch(e) {
    e.preventDefault()
    navigate(query.trim() ? `/warehouse/inventory?q=${encodeURIComponent(query.trim())}` : '/warehouse/inventory')
  }

  return (
    <>
    <div className="space-y-4 p-4 pb-8 lg:hidden" style={{ background: '#F4F5F9' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[27px] font-extrabold leading-none tracking-tight" style={{ color: INK, letterSpacing: '-0.7px' }}>Склад</h1>
          <p className="mt-1.5 text-[12.5px] font-medium" style={{ color: MUTED }}>Обзор остатков и движения</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <NotificationBell variant="light" />
          <button
            onClick={data.refetchAll}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] border border-[#E7EAF0] bg-white text-slate-600"
            style={{ boxShadow: CARD_SHADOW }}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </div>

      {data.error && (
        <Alert variant="error" title="Ошибка загрузки данных">
          {data.error?.response?.data?.error?.message ?? data.error?.message}
        </Alert>
      )}

      <div className="relative overflow-hidden rounded-[24px] p-5 text-white" style={{ background: GRADIENT, boxShadow: '0 14px 34px rgba(79,70,229,.34)' }}>
        <div className="pointer-events-none absolute -right-10 -top-14 h-[200px] w-[200px] rounded-full bg-white/10" />
        <div className="relative">
          <p className="text-[10.5px] font-bold uppercase tracking-[1px] text-indigo-100/85">Стоимость склада</p>
          <p className="mt-1.5 text-[37px] font-extrabold leading-none tracking-tight">{fmtMoney(stockValue)}</p>
          <div className="mt-4 flex items-center gap-5">
            <MobileStat value={activeProducts.length} label="товаров" />
            <div className="h-[30px] w-px bg-white/20" />
            <MobileStat value={totalUnits} label="единиц" />
            <div className="h-[30px] w-px bg-white/20" />
            <MobileStat value={movementsToday} label="сегодня" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <MobileAlertTile icon={<AlertTriangle size={20} />} tone="amber" value={lowStock} label="Мало на складе" />
        <MobileAlertTile icon={<PackageX size={20} />} tone="rose" value={outStock} label="Нет в наличии" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <MobileAlertTile icon={<AlertTriangle size={20} />} tone="rose" value={expiryMeta.expiring_count} label="Скоро истекает" />
        <MobileAlertTile icon={<AlertTriangle size={20} />} tone="rose" value={expiryMeta.expired_count} label="Просрочено" />
      </div>

      <div className="space-y-2.5">
        <button
          onClick={() => setReceiveProduct(null)}
          className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-[18px] text-[15px] font-bold text-white"
          style={{ background: GRADIENT, boxShadow: '0 8px 20px rgba(79,70,229,.35)' }}
        >
          <Download size={20} />Оформить приход
        </button>
        <div className="grid grid-cols-2 gap-2.5">
          <button onClick={() => setShowWriteoff(true)} className="flex min-h-12 items-center justify-center gap-2 rounded-[15px] bg-rose-50 text-[13.5px] font-bold text-rose-700">
            <Trash2 size={17} />Списание
          </button>
          <button onClick={() => setShowProduct(true)} className="flex min-h-12 items-center justify-center gap-2 rounded-[15px] bg-indigo-50 text-[13.5px] font-bold text-indigo-700">
            <PackagePlus size={17} />Товар
          </button>
        </div>
      </div>

      <div>
        <div className="mb-2.5 flex items-center justify-between px-0.5">
          <span className="text-[16px] font-extrabold" style={{ color: INK }}>Требует внимания</span>
          {stockAlerts.length > 0 && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">{stockAlerts.length} позиций</span>
          )}
        </div>
        {stockAlerts.length === 0 ? (
          <MobileEmpty title="Критичных остатков нет" />
        ) : (
          <div className="space-y-2.5">
            {stockAlerts.map((inv) => {
              const product = data.productMap[inv.product_id ?? inv.ProductID]
              return (
                <MobileAttentionCard
                  key={getId(inv)}
                  inventory={inv}
                  product={product}
                  onOpen={() => navigate(`/warehouse/inventory?q=${encodeURIComponent(getProductSku(product))}`)}
                  onReceive={() => setReceiveProduct(product ?? null)}
                />
              )
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2.5 flex items-center justify-between px-0.5">
          <span className="text-[16px] font-extrabold" style={{ color: INK }}>Сроки годности</span>
          {expiryAlerts.length > 0 && (
            <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-700">{expiryAlerts.length} партий</span>
          )}
        </div>
        <ExpiryAlertsList
          alerts={expiryAlerts}
          loading={expiryLoading}
          error={expiryIsError ? expiryError : null}
          onOpenProduct={(a) => navigate(`/warehouse/inventory?q=${encodeURIComponent(a.sku)}`)}
        />
      </div>

      <div>
        <div className="mb-2.5 flex items-center justify-between px-0.5">
          <span className="text-[16px] font-extrabold" style={{ color: INK }}>Последние движения</span>
          <button onClick={() => navigate('/warehouse/movements')} className="text-[13px] font-bold text-indigo-600">Все ›</button>
        </div>
        <MovementList rows={data.movements.slice(0, 5)} data={data} />
      </div>
    </div>

    <div className="hidden animate-fade-in p-6 lg:block">
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

      <MetricsStrip products={activeProducts} inventory={activeInventory} movements={data.movements} batches={activeBatches} loading={data.loading} />
      <div className="mb-4"><CourierWarehouseSummary summary={invSummary} /></div>

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

        <ExpiryAlertsPanel
          onOpenProduct={(alert) => navigate(`/warehouse/inventory?q=${encodeURIComponent(alert.sku)}`)}
        />

        <section>
          <div className="mb-3">
            <h2 className="text-sm font-bold text-slate-950">Движения</h2>
            <p className="mt-1 text-xs text-slate-400">Полная лента операций склада.</p>
          </div>
          <MovementList rows={data.movements} data={data} />
        </section>
      </section>
    </div>

      <ProductModal open={showProduct} onClose={() => setShowProduct(false)} suppliers={data.suppliers} />
      <ReceivingModal open={receiveProduct !== undefined} onClose={() => setReceiveProduct(undefined)} initialProduct={receiveProduct} products={activeProducts} inventory={data.inventory} />
      <WriteoffModal open={showWriteoff} onClose={() => setShowWriteoff(false)} products={activeProducts} inventory={data.inventory} />
    </>
  )
}

function MobileStat({ value, label }) {
  return (
    <div>
      <p className="text-[17px] font-extrabold leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-semibold text-indigo-100/80">{label}</p>
    </div>
  )
}

function MobileAlertTile({ icon, tone, value, label }) {
  const tones = {
    amber: { bg: '#FFFBEB', color: '#D97706' },
    rose: { bg: '#FFF1F2', color: '#E11D48' },
  }
  const t = tones[tone]
  return (
    <div className="flex items-center gap-3 rounded-[18px] bg-white p-3.5" style={{ boxShadow: CARD_SHADOW }}>
      <div className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[13px]" style={{ background: t.bg, color: t.color }}>
        {icon}
      </div>
      <div>
        <p className="text-[23px] font-extrabold leading-none" style={{ color: INK }}>{value}</p>
        <p className="mt-1 text-[11.5px] font-semibold" style={{ color: MUTED }}>{label}</p>
      </div>
    </div>
  )
}

function MobileAttentionCard({ inventory, product, onOpen, onReceive }) {
  const status = getStockStatus(inventory)
  const available = getAvailableQty(inventory)
  const threshold = getLowStockThreshold(inventory)
  const pct = threshold > 0 ? Math.min(100, Math.round((available / threshold) * 100)) : (status === 'out_of_stock' ? 0 : 100)
  const accent = status === 'out_of_stock' ? '#E11D48' : '#D97706'
  return (
    <div className="rounded-[18px] bg-white p-3.5" style={{ boxShadow: CARD_SHADOW }}>
      <button onClick={onOpen} className="flex w-full min-w-0 items-center gap-3 text-left">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] bg-slate-100 text-sm font-extrabold text-slate-400">
          {getProductName(product)?.[0] ?? '•'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold" style={{ color: INK }}>{getProductName(product)}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{getProductSku(product)}</p>
        </div>
        <Badge variant={STOCK_STATUS_BADGE[status]} dot>{STOCK_STATUS_LABEL[status]}</Badge>
      </button>
      <div className="mt-3 flex items-center gap-2.5">
        <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-[#EEF1F6]">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: accent }} />
        </div>
        <span className="flex-shrink-0 text-[11px] font-semibold text-slate-500">{available} / {threshold || '—'}</span>
      </div>
      <button
        onClick={onReceive}
        className="mt-3 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-[13px] bg-indigo-50 text-[13px] font-bold text-indigo-700"
      >
        <PackagePlus size={16} />Пополнить
      </button>
    </div>
  )
}

function MobileEmpty({ title }) {
  return (
    <div className="rounded-[18px] border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-[12.5px] text-slate-400">
      {title}
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
  const today = new Date()
  const movementsToday = movements.filter((m) => {
    const d = m.created_at ?? m.CreatedAt
    if (!d) return false
    return isSameAppDay(d, today)
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
