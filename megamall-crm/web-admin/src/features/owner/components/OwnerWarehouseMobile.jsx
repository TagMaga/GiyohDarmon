import {
  Download, FilterX, Package, PackagePlus, RefreshCw, Search, Trash2,
} from 'lucide-react'
import Badge from '../../../shared/components/Badge'
import { MovementList } from '../../warehouse/pages/WarehouseMovementsPage'
import {
  STOCK_STATUS_BADGE,
  STOCK_STATUS_LABEL,
  fmtMoney,
  getAvailableQty,
  getId,
  getProductImage,
  getProductName,
  getProductSku,
  getPurchasePrice,
  getQuantity,
  getReservedQty,
  getSalePrice,
  getStockStatus,
  isProductActive,
} from '../../warehouse/utils/warehouseHelpers'

const TABS = [
  { id: 'dashboard', label: 'Дашборд' },
  { id: 'inventory', label: 'Остатки' },
  { id: 'receiving', label: 'Приёмка' },
  { id: 'movements', label: 'Движение' },
]

const MOVEMENT_TYPES = [
  { value: '', label: 'Все типы' },
  { value: 'purchase', label: 'Приход' },
  { value: 'adjustment', label: 'Корректировка' },
  { value: 'writeoff', label: 'Списание' },
  { value: 'sale', label: 'Продажа' },
  { value: 'return', label: 'Возврат' },
]

function MobileProductThumb({ product }) {
  const image = getProductImage(product)
  if (image) {
    return <img src={image} alt={getProductName(product)} className="h-10 w-10 flex-shrink-0 rounded-lg border border-slate-200 object-cover" />
  }
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400">
      <Package size={16} />
    </div>
  )
}

function MobileSearchBar({ value, onChange, placeholder, onSubmit }) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit?.() }}
      className="flex min-h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3.5 shadow-sm"
    >
      <Search size={17} className="flex-shrink-0 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-slate-400"
      />
    </form>
  )
}

function MobileTabPills({ tab, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-full bg-[#E9EDF2] p-[3px]">
      {TABS.map((item) => {
        const active = tab === item.id
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={`flex-shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-all ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function MobileAttentionRow({ inventory, product, onOpen, onReceive }) {
  const status = getStockStatus(inventory)
  const available = getAvailableQty(inventory)
  const label = status === 'out_of_stock' ? 'нет в наличии' : `доступно ${available}`
  return (
    <div className="flex items-center gap-3 border-t border-slate-50 px-4 py-2.5 first:border-t-0 min-h-[44px]">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <MobileProductThumb product={product} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-slate-950">{getProductName(product)}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">
            <span className="font-mono">{getProductSku(product)}</span> · <b className={status === 'out_of_stock' ? 'text-rose-600' : 'text-amber-600'}>{label}</b>
          </p>
        </div>
      </button>
      <button
        onClick={onReceive}
        className="flex min-h-[34px] flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 px-3.5 text-[12px] font-bold text-indigo-700"
      >
        Пополнить
      </button>
    </div>
  )
}

function MobileInventoryCard({ product, inv, onReceive, onWriteoff, onEdit }) {
  const status = getStockStatus(inv)
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <MobileProductThumb product={product} />
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-bold text-slate-950">{getProductName(product)}</p>
            <p className="truncate font-mono text-[11px] text-slate-400">{getProductSku(product)}</p>
          </div>
        </div>
        <Badge variant={isProductActive(product) ? STOCK_STATUS_BADGE[status] : 'slate'}>
          {isProductActive(product) ? STOCK_STATUS_LABEL[status] : 'Неактивен'}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[15px] font-extrabold tabular-nums text-slate-950">{getQuantity(inv)}</p>
          <p className="text-[10px] font-semibold text-slate-400">На складе</p>
        </div>
        <div>
          <p className="text-[15px] font-extrabold tabular-nums text-emerald-700">{getAvailableQty(inv)}</p>
          <p className="text-[10px] font-semibold text-slate-400">Доступно</p>
        </div>
        <div>
          <p className="text-[15px] font-extrabold tabular-nums text-amber-700">{getReservedQty(inv)}</p>
          <p className="text-[10px] font-semibold text-slate-400">Резерв</p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between text-[11.5px] text-slate-500">
        <span>Закупка <b className="text-slate-700">{fmtMoney(getPurchasePrice(product))}</b></span>
        <span>Продажа <b className="text-indigo-700">{fmtMoney(getSalePrice(product))}</b></span>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => onReceive(product)} className="flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-100 text-[11.5px] font-bold text-slate-700"><Download size={13} />Приход</button>
        <button onClick={() => onWriteoff(product)} className="flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-50 text-[11.5px] font-bold text-rose-600"><Trash2 size={13} />Списание</button>
        <button onClick={() => onEdit(product)} className="flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-50 text-[11.5px] font-bold text-indigo-700"><PackagePlus size={13} />Изменить</button>
      </div>
    </div>
  )
}

function MobileEmpty({ title }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-[12.5px] text-slate-400">
      {title}
    </div>
  )
}

export default function OwnerWarehouseMobile({
  tab, onTab, data,
  inventorySearch, onInventorySearch,
  movementSearch, onMovementSearch, movementType, onMovementType, movementProductId, onMovementProductId, clearMovementFilters,
  inventoryRows, stockAlerts, receivingRows, movementRows, validProducts,
  onReceive, onWriteoff, onEdit, onProduct, onOpenAlert, onRefresh,
}) {
  const totalUnits = data.inventory.reduce((sum, inv) => sum + getQuantity(inv), 0)
  const stockValue = data.batches.reduce(
    (sum, batch) => sum + (batch.remaining_quantity ?? batch.RemainingQuantity ?? 0) * (batch.unit_cost ?? batch.UnitCost ?? 0),
    0
  )
  const lowStock = data.inventory.filter((inv) => getStockStatus(inv) === 'low_stock').length
  const outStock = data.inventory.filter((inv) => getStockStatus(inv) === 'out_of_stock').length
  const today = new Date().toDateString()
  const movementsToday = data.movements.filter((m) => {
    const date = m.created_at ?? m.CreatedAt
    if (!date) return false
    try { return new Date(date).toDateString() === today } catch { return false }
  }).length

  return (
    <div className="space-y-3.5 p-4 pb-8" style={{ background: '#F2F4F7' }}>
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-950">Склад</h1>
        <button
          onClick={onRefresh}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      <MobileSearchBar
        value={inventorySearch}
        onChange={onInventorySearch}
        placeholder="Товар, SKU или штрихкод…"
        onSubmit={() => onTab('inventory')}
      />

      <MobileTabPills tab={tab} onChange={onTab} />

      {tab === 'dashboard' && (
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-indigo-600" />
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Стоимость склада</span>
              </div>
              <div className="mt-2 text-[19px] font-extrabold tracking-tight tabular-nums text-slate-950">
                {fmtMoney(stockValue)}
              </div>
              <div className="mt-0.5 text-[10.5px] font-semibold text-slate-400">{data.products.length} товара · {totalUnits} ед.</div>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Риски остатков</span>
              </div>
              <div className="mt-2 text-[19px] font-extrabold tabular-nums">
                <span className="text-amber-600">{lowStock}</span> <span className="text-[12px] font-bold text-slate-400">мало</span> · <span className="text-rose-700">{outStock}</span> <span className="text-[12px] font-bold text-slate-400">нет</span>
              </div>
              <div className="mt-0.5 text-[10.5px] font-semibold text-slate-400">{movementsToday} движений сегодня</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <button onClick={() => onReceive(null)} className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 text-white shadow-[0_4px_12px_rgba(79,70,229,.25)]">
              <Download size={18} />
              <span className="text-[11px] font-bold">Приход</span>
            </button>
            <button onClick={() => onWriteoff(null)} className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white text-rose-600 shadow-sm">
              <Trash2 size={18} />
              <span className="text-[11px] font-bold text-slate-700">Списание</span>
            </button>
            <button onClick={onProduct} className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white text-indigo-600 shadow-sm">
              <PackagePlus size={18} />
              <span className="text-[11px] font-bold text-slate-700">Товар</span>
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="flex items-center justify-between px-4 pb-2.5 pt-3.5">
              <span className="text-[15px] font-extrabold text-slate-950">Требует внимания</span>
              {stockAlerts.length > 0 && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">{stockAlerts.length} позиций</span>
              )}
            </div>
            {stockAlerts.length === 0 ? (
              <MobileEmpty title="Критичных остатков нет" />
            ) : (
              stockAlerts.map((inv) => {
                const product = data.productMap[inv.product_id ?? inv.ProductID]
                return (
                  <MobileAttentionRow
                    key={getId(inv)}
                    inventory={inv}
                    product={product}
                    onOpen={() => onOpenAlert(product)}
                    onReceive={() => onReceive(product ?? null)}
                  />
                )
              })
            )}
          </div>

          <div>
            <h2 className="mb-2 px-1 text-[15px] font-extrabold text-slate-950">Движения</h2>
            <MovementList rows={data.movements} data={data} />
          </div>
        </div>
      )}

      {tab === 'inventory' && (
        <div className="space-y-2.5">
          {inventoryRows.length === 0 ? (
            <MobileEmpty title="Остатки не найдены" />
          ) : (
            <div className="space-y-2.5">
              {inventoryRows.map(({ product, inv }) => (
                <MobileInventoryCard key={getId(product)} product={product} inv={inv} onReceive={onReceive} onWriteoff={onWriteoff} onEdit={onEdit} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'receiving' && (
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <button onClick={() => onReceive(null)} className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 text-white shadow-[0_4px_12px_rgba(79,70,229,.25)]">
              <PackagePlus size={18} /><span className="text-[11.5px] font-bold">Новая приёмка</span>
            </button>
            <button onClick={() => onWriteoff(null)} className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white text-rose-600 shadow-sm">
              <Trash2 size={18} /><span className="text-[11.5px] font-bold text-slate-700">Новое списание</span>
            </button>
          </div>
          <MovementList rows={receivingRows} data={data} emptyTitle="Операций пока нет" showEntryActions />
        </div>
      )}

      {tab === 'movements' && (
        <div className="space-y-2.5">
          <MobileSearchBar value={movementSearch} onChange={onMovementSearch} placeholder="Товар, пользователь, комментарий…" />
          <div className="flex gap-2">
            <select className="input min-h-11 flex-1 rounded-2xl text-[12.5px]" value={movementType} onChange={(e) => onMovementType(e.target.value)}>
              {MOVEMENT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button onClick={clearMovementFilters} className="flex min-h-11 items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-600">
              <FilterX size={14} />Сброс
            </button>
          </div>
          <select className="input min-h-11 w-full rounded-2xl text-[12.5px]" value={movementProductId} onChange={(e) => onMovementProductId(e.target.value)}>
            <option value="">Все товары</option>
            {validProducts.map((product) => <option key={getId(product)} value={getId(product)}>{getProductName(product)}</option>)}
          </select>
          <MovementList rows={movementRows} data={data} />
        </div>
      )}
    </div>
  )
}
