import { useQuery } from '@tanstack/react-query'
import { X, Package, Download, Trash2, Pencil } from 'lucide-react'
import Badge from '../../../shared/components/Badge'
import Button from '../../../shared/components/Button'
import { KEYS } from '../../../shared/queryKeys'
import { fetchBatches } from '../api'
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
  getProductBarcode,
  getProductImageDims,
  getProductImageSrcSet,
  getProductImageVariant,
  getProductName,
  getProductSku,
  getQuantity,
  getReservedQty,
  getStockStatus,
} from '../utils/warehouseHelpers'

export default function ProductDrawer({
  product,
  inventory,
  movements,
  onClose,
  onReceive,
  onWriteoff,
  onEdit,
}) {
  const productId = product ? getId(product) : undefined

  // Fetch active FIFO batches for this product.
  const { data: batches = [] } = useQuery({
    queryKey: KEYS.warehouse.batches(productId),
    queryFn: () => fetchBatches({ product_id: productId }),
    enabled: !!productId,
    staleTime: 30_000,
  })

  if (!product) return null

  const stockRows = inventory.filter((inv) => (inv.product_id ?? inv.ProductID) === productId)
  const totalQty = stockRows.reduce((sum, inv) => sum + getQuantity(inv), 0)
  const totalAvailable = stockRows.reduce((sum, inv) => sum + getAvailableQty(inv), 0)
  const totalReserved = stockRows.reduce((sum, inv) => sum + getReservedQty(inv), 0)
  const threshold = stockRows[0]?.low_stock_threshold ?? stockRows[0]?.LowStockThreshold ?? 0
  const status = stockRows.some((inv) => getStockStatus(inv) === 'out_of_stock')
    ? 'out_of_stock'
    : stockRows.some((inv) => getStockStatus(inv) === 'low_stock')
      ? 'low_stock'
      : 'in_stock'
  const recentMovements = movements
    .filter((m) => (m.product_id ?? m.ProductID) === productId)
    .slice(0, 6)
  // The drawer is this admin app's closest thing to a "product detail"
  // view, so it uses the largest (detail) variant even though it's
  // displayed small here — avoids upscale artifacts if the display size
  // grows later (e.g. a future zoom/lightbox), per the detail-variant
  // convention for detail views.
  const image = getProductImageVariant(product, 'detail')
  const imageDims = getProductImageDims(product)
  const imageSrcSet = getProductImageSrcSet(product)

  // Compute inventory value from batch remaining quantities × unit costs.
  const inventoryValue = batches.reduce(
    (sum, b) => sum + (b.remaining_quantity ?? 0) * (b.unit_cost ?? 0),
    0
  )

  // Last purchase cost = unit_cost from the most recently received batch.
  const lastPurchaseCost = batches.length > 0
    ? batches.reduce((latest, b) => {
        const at = new Date(b.received_at ?? b.ReceivedAt ?? 0).getTime()
        return at > new Date(latest.received_at ?? latest.ReceivedAt ?? 0).getTime() ? b : latest
      }, batches[0])?.unit_cost
    : null

  const activeBatches = batches.filter((b) => (b.remaining_quantity ?? 0) > 0)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button className="absolute inset-0 bg-slate-950/25 backdrop-blur-[1px]" onClick={onClose} aria-label="Закрыть карточку товара" />
      <aside className="relative z-10 flex h-full w-full max-w-xl animate-slide-in flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <ProductImage image={image} srcSet={imageSrcSet} dims={imageDims} name={getProductName(product)} />
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-slate-950">{getProductName(product)}</p>
              <p className="mt-1 font-mono text-xs text-slate-400">{getProductSku(product)}</p>
              <div className="mt-2">
                <Badge variant={STOCK_STATUS_BADGE[status]} dot={status !== 'in_stock'}>
                  {STOCK_STATUS_LABEL[status]}
                </Badge>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-3 flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <section className="grid grid-cols-3 gap-3">
            <Metric label="На складе" value={totalQty} />
            <Metric label="Доступно" value={totalAvailable} tone="emerald" />
            <Metric label="Резерв" value={totalReserved} tone="amber" />
          </section>

          <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Товар</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Info label="Штрихкод" value={getProductBarcode(product)} mono />
              <Info label="Последняя закупка" value={lastPurchaseCost != null ? fmtMoney(lastPurchaseCost) : '—'} />
              <Info label="Мин. порог" value={threshold} />
              <Info label="Стоимость остатка (FIFO)" value={fmtMoney(inventoryValue)} tone="emerald" />
            </dl>
          </section>

          {activeBatches.length > 0 && (
            <section className="mt-4">
              <p className="text-sm font-semibold text-slate-900">Партии FIFO</p>
              <div className="mt-3 space-y-1">
                {activeBatches.map((b, i) => (
                  <div key={b.id ?? i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                    <span className="text-slate-500">{fmtDate(b.received_at)}</span>
                    <span className="tabular-nums text-slate-700">
                      <b>{b.remaining_quantity}</b> × {fmtMoney(b.unit_cost)}
                      <span className="ml-2 text-slate-400">= {fmtMoney((b.remaining_quantity ?? 0) * (b.unit_cost ?? 0))}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-4">
            <p className="text-sm font-semibold text-slate-900">Последние движения</p>
            <div className="mt-3 space-y-2">
              {recentMovements.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-400">
                  Движений пока нет.
                </div>
              )}
              {recentMovements.map((m) => {
                const type = getMovementType(m)
                return (
                  <div key={getId(m)} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="min-w-0">
                      <Badge variant={MOVEMENT_BADGE[type] ?? 'slate'}>{MOVEMENT_LABEL[type] ?? type}</Badge>
                      <p className="mt-1 truncate text-xs text-slate-400">{m.reason ?? m.Reason ?? '—'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold tabular-nums text-slate-900">{m.quantity ?? m.Quantity}</p>
                      <p className="text-xs text-slate-400">{fmtDate(m.created_at ?? m.CreatedAt)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-slate-100 p-3">
          <Button icon={<Download size={15} />} onClick={() => onReceive(product)}>Приход</Button>
          <Button icon={<Trash2 size={15} />} variant="danger" onClick={() => onWriteoff(product)}>Списать</Button>
          <Button icon={<Pencil size={15} />} variant="secondary" onClick={() => onEdit(product)}>Изменить</Button>
        </div>
      </aside>
    </div>
  )
}

function ProductImage({ image, srcSet, dims, name }) {
  if (image) {
    return (
      <img
        src={image}
        srcSet={srcSet}
        sizes="56px"
        width={dims?.width}
        height={dims?.height}
        alt={name}
        className="h-14 w-14 flex-shrink-0 rounded-xl border border-slate-200 object-cover"
      />
    )
  }
  return (
    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-400">
      <Package size={22} />
    </div>
  )
}

function Metric({ label, value, tone = 'slate' }) {
  const color = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-950'
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

function Info({ label, value, mono = false, tone }) {
  const valColor = tone === 'emerald' ? 'text-emerald-700' : 'text-slate-800'
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-1 truncate font-semibold ${valColor} ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '—'}</dd>
    </div>
  )
}
