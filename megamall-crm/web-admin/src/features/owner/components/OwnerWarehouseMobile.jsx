import {
  AlertTriangle, ChevronDown, Download, FilterX, Package, PackagePlus, PackageX, RefreshCw, Search, Trash2,
} from 'lucide-react'
import Badge from '../../../shared/components/Badge'
import { MovementList } from '../../warehouse/pages/WarehouseMovementsPage'
import {
  STOCK_STATUS_BADGE,
  STOCK_STATUS_LABEL,
  fmtMoney,
  getAvailableQty,
  getId,
  getLowStockThreshold,
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

const INK = '#0B1020'
const MUTED = '#8A91A3'
const GRADIENT = 'linear-gradient(135deg, #4F46E5, #6D28D9)'
const CARD_SHADOW = '0 2px 8px rgba(15,23,42,.05)'

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
    return <img src={image} alt={getProductName(product)} className="h-11 w-11 flex-shrink-0 rounded-[13px] border border-slate-200 object-cover" />
  }
  return (
    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] bg-slate-100 text-slate-400">
      <Package size={18} />
    </div>
  )
}

function MobileSearchBar({ value, onChange, placeholder, onSubmit }) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit?.() }}
      className="flex min-h-11 items-center gap-2 rounded-[15px] border border-[#E7EAF0] bg-white px-3.5"
      style={{ boxShadow: CARD_SHADOW }}
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

function MobilePillSelect({ value, onChange, options, className = '' }) {
  return (
    <div className={`relative flex-shrink-0 ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full appearance-none rounded-full border-0 bg-slate-100 pl-3.5 pr-8 text-xs font-semibold text-slate-600 outline-none"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
  )
}

function MobileTabPills({ tab, onChange }) {
  return (
    <div className="flex gap-1 rounded-[15px] bg-white p-1" style={{ boxShadow: CARD_SHADOW }}>
      {TABS.map((item) => {
        const active = tab === item.id
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className="flex-1 rounded-[11px] py-2 text-[12.5px] font-bold transition-all"
            style={active ? { background: '#4F46E5', color: '#fff' } : { color: '#64748B' }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function StatMini({ value, label }) {
  return (
    <div>
      <p className="text-[17px] font-extrabold leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-semibold text-indigo-100/80">{label}</p>
    </div>
  )
}

function AlertTile({ icon, tone, value, label }) {
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

function AttentionCard({ inventory, product, onOpen, onReceive }) {
  const status = getStockStatus(inventory)
  const available = getAvailableQty(inventory)
  const threshold = getLowStockThreshold(inventory)
  const pct = threshold > 0 ? Math.min(100, Math.round((available / threshold) * 100)) : (status === 'out_of_stock' ? 0 : 100)
  const accent = status === 'out_of_stock' ? '#E11D48' : '#D97706'
  return (
    <div className="rounded-[18px] bg-white p-3.5" style={{ boxShadow: CARD_SHADOW }}>
      <button onClick={onOpen} className="flex w-full min-w-0 items-center gap-3 text-left">
        <MobileProductThumb product={product} />
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

function MobileInventoryCard({ product, inv, onReceive, onWriteoff, onEdit }) {
  const status = getStockStatus(inv)
  return (
    <div className="rounded-[18px] bg-white p-3.5" style={{ boxShadow: CARD_SHADOW }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <MobileProductThumb product={product} />
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-bold" style={{ color: INK }}>{getProductName(product)}</p>
            <p className="truncate font-mono text-[11px] text-slate-400">{getProductSku(product)}</p>
          </div>
        </div>
        <Badge variant={isProductActive(product) ? STOCK_STATUS_BADGE[status] : 'slate'}>
          {isProductActive(product) ? STOCK_STATUS_LABEL[status] : 'Неактивен'}
        </Badge>
      </div>
      <div className="mt-3.5 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[16px] font-extrabold tabular-nums" style={{ color: INK }}>{getQuantity(inv)}</p>
          <p className="mt-0.5 text-[10px] font-semibold" style={{ color: MUTED }}>На складе</p>
        </div>
        <div>
          <p className="text-[16px] font-extrabold tabular-nums text-emerald-700">{getAvailableQty(inv)}</p>
          <p className="mt-0.5 text-[10px] font-semibold" style={{ color: MUTED }}>Доступно</p>
        </div>
        <div>
          <p className="text-[16px] font-extrabold tabular-nums text-amber-700">{getReservedQty(inv)}</p>
          <p className="mt-0.5 text-[10px] font-semibold" style={{ color: MUTED }}>Резерв</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[12px] text-slate-500">
        <span>Закупка <b className="text-slate-700">{fmtMoney(getPurchasePrice(product))}</b></span>
        <span>Продажа <b className="text-indigo-700">{fmtMoney(getSalePrice(product))}</b></span>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => onReceive(product)} className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-slate-100 text-[11.5px] font-bold text-slate-700"><Download size={14} />Приход</button>
        <button onClick={() => onWriteoff(product)} className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-rose-50 text-[11.5px] font-bold text-rose-600"><Trash2 size={14} />Списание</button>
        <button onClick={() => onEdit(product)} className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-indigo-50 text-[11.5px] font-bold text-indigo-700"><PackagePlus size={14} />Изменить</button>
      </div>
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
    <div className="space-y-4 p-4 pb-8" style={{ background: '#F4F5F9' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[27px] font-extrabold leading-none tracking-tight" style={{ color: INK, letterSpacing: '-0.7px' }}>Склад</h1>
          <p className="mt-1.5 text-[12.5px] font-medium" style={{ color: MUTED }}>Обзор остатков и движения</p>
        </div>
        <button
          onClick={onRefresh}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] border border-[#E7EAF0] bg-white text-slate-600"
          style={{ boxShadow: CARD_SHADOW }}
        >
          <RefreshCw size={17} />
        </button>
      </div>

      <MobileTabPills tab={tab} onChange={onTab} />

      {tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-[24px] p-5 text-white" style={{ background: GRADIENT, boxShadow: '0 14px 34px rgba(79,70,229,.34)' }}>
            <div className="pointer-events-none absolute -right-10 -top-14 h-[200px] w-[200px] rounded-full bg-white/10" />
            <div className="relative">
              <p className="text-[10.5px] font-bold uppercase tracking-[1px] text-indigo-100/85">Стоимость склада</p>
              <p className="mt-1.5 text-[37px] font-extrabold leading-none tracking-tight">{fmtMoney(stockValue)}</p>
              <div className="mt-4 flex items-center gap-5">
                <StatMini value={data.products.length} label="товаров" />
                <div className="h-[30px] w-px bg-white/20" />
                <StatMini value={totalUnits} label="единиц" />
                <div className="h-[30px] w-px bg-white/20" />
                <StatMini value={movementsToday} label="сегодня" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <AlertTile icon={<AlertTriangle size={20} />} tone="amber" value={lowStock} label="Мало на складе" />
            <AlertTile icon={<PackageX size={20} />} tone="rose" value={outStock} label="Нет в наличии" />
          </div>

          <div className="space-y-2.5">
            <button
              onClick={() => onReceive(null)}
              className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-[18px] text-[15px] font-bold text-white"
              style={{ background: GRADIENT, boxShadow: '0 8px 20px rgba(79,70,229,.35)' }}
            >
              <Download size={20} />Оформить приход
            </button>
            <div className="grid grid-cols-2 gap-2.5">
              <button onClick={() => onWriteoff(null)} className="flex min-h-12 items-center justify-center gap-2 rounded-[15px] bg-rose-50 text-[13.5px] font-bold text-rose-700">
                <Trash2 size={17} />Списание
              </button>
              <button onClick={onProduct} className="flex min-h-12 items-center justify-center gap-2 rounded-[15px] bg-indigo-50 text-[13.5px] font-bold text-indigo-700">
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
                    <AttentionCard
                      key={getId(inv)}
                      inventory={inv}
                      product={product}
                      onOpen={() => onOpenAlert(product)}
                      onReceive={() => onReceive(product ?? null)}
                    />
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2.5 flex items-center justify-between px-0.5">
              <span className="text-[16px] font-extrabold" style={{ color: INK }}>Последние движения</span>
              <button onClick={() => onTab('movements')} className="text-[13px] font-bold text-indigo-600">Все ›</button>
            </div>
            <MovementList rows={data.movements.slice(0, 5)} data={data} />
          </div>
        </div>
      )}

      {tab === 'inventory' && (
        <div className="space-y-2.5">
          <MobileSearchBar
            value={inventorySearch}
            onChange={onInventorySearch}
            placeholder="Товар, SKU или штрихкод…"
          />
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
            <button
              onClick={() => onReceive(null)}
              className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-[18px] text-white"
              style={{ background: GRADIENT, boxShadow: '0 8px 20px rgba(79,70,229,.3)' }}
            >
              <PackagePlus size={18} /><span className="text-[11.5px] font-bold">Новая приёмка</span>
            </button>
            <button onClick={() => onWriteoff(null)} className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-[18px] bg-white text-rose-600" style={{ boxShadow: CARD_SHADOW }}>
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
            <MobilePillSelect className="flex-1" value={movementType} onChange={onMovementType} options={MOVEMENT_TYPES} />
            <button onClick={clearMovementFilters} className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-3.5 text-xs font-semibold text-slate-600">
              <FilterX size={13} />Сброс
            </button>
          </div>
          <MobilePillSelect
            className="w-full"
            value={movementProductId}
            onChange={onMovementProductId}
            options={[{ value: '', label: 'Все товары' }, ...validProducts.map((product) => ({ value: getId(product), label: getProductName(product) }))]}
          />
          <MovementList rows={movementRows} data={data} />
        </div>
      )}
    </div>
  )
}
