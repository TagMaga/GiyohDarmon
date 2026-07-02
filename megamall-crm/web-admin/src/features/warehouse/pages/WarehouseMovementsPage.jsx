import { useMemo, useState } from 'react'
import { ArrowLeftRight, FilterX, Search, Package, User2, Phone, MapPin, Truck } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import Badge from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import Alert from '../../../shared/components/Alert'
import Modal from '../../../shared/components/Modal'
import { STATUS_LABELS, STATUS_BADGE } from '../../../shared/orderStatusConfig'
import useWarehouseData from '../hooks/useWarehouseData'
import { MOVEMENT_BADGE, MOVEMENT_LABEL, fmtDate, getId, getMovementType, getProductName, getProductSku, isUUID } from '../utils/warehouseHelpers'

const TYPES = [
  { value: '', label: 'Все типы' },
  { value: 'purchase', label: 'Приход' },
  { value: 'adjustment', label: 'Корректировка' },
  { value: 'writeoff', label: 'Списание' },
  { value: 'sale', label: 'Продажа' },
  { value: 'return', label: 'Возврат' },
]

export default function WarehouseMovementsPage() {
  const data = useWarehouseData()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [productId, setProductId] = useState('')
  const validProducts = data.products.filter((p) => isUUID(getId(p)))

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.movements.filter((m) => {
      const product = data.productMap[m.product_id ?? m.ProductID]
      if (type && getMovementType(m) !== type) return false
      if (productId && (m.product_id ?? m.ProductID) !== productId) return false
      if (!q) return true
      return (
        getProductName(product).toLowerCase().includes(q) ||
        getProductSku(product).toLowerCase().includes(q) ||
        (m.reason ?? m.Reason ?? '').toLowerCase().includes(q) ||
        (m.created_by_name ?? m.CreatedByName ?? '').toLowerCase().includes(q)
      )
    })
  }, [data.movements, data.productMap, productId, search, type])

  function clear() {
    setSearch('')
    setType('')
    setProductId('')
  }

  return (
    <div className="animate-fade-in p-6">
      <PageHeader title="Движения" subtitle="История операций по остаткам." icon={<ArrowLeftRight size={20} />} />
      {data.error && <Alert variant="error" title="Ошибка загрузки данных" className="mb-5">{data.error?.message}</Alert>}

      <section className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)] xl:grid-cols-[1fr_160px_210px_auto]">
        <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
          <Search size={17} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по товару, пользователю или комментарию…" className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" />
        </label>
        <select className="input py-2" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className="input py-2" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Все товары</option>
          {validProducts.map((p) => <option key={getId(p)} value={getId(p)}>{getProductName(p)}</option>)}
        </select>
        <Button icon={<FilterX size={15} />} onClick={clear}>Сбросить</Button>
      </section>

      <MovementList rows={rows} data={data} />
    </div>
  )
}

export function MovementList({ rows, data, emptyTitle = 'Движения не найдены' }) {
  const [orderMovement, setOrderMovement] = useState(null)
  if (!rows.length) return <EmptyState icon={<ArrowLeftRight size={22} />} title={emptyTitle} description="Измените фильтры или выполните складскую операцию." />
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)] lg:block">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Тип</th>
              <th className="px-3 py-2.5 text-left">Товар</th>
              <th className="px-3 py-2.5 text-right">Кол-во</th>
              <th className="px-3 py-2.5 text-right">Было</th>
              <th className="px-3 py-2.5 text-right">Стало</th>
              <th className="px-3 py-2.5 text-left">Пользователь</th>
              <th className="px-3 py-2.5 text-left">Дата</th>
              <th className="px-3 py-2.5 text-left">Комментарий</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((m) => <MovementRow key={getId(m)} m={m} data={data} onOrderClick={setOrderMovement} />)}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 lg:hidden">
        {rows.map((m) => <MovementCard key={getId(m)} m={m} data={data} onOrderClick={setOrderMovement} />)}
      </div>
      <MovementOrderModal movement={orderMovement} product={orderMovement ? data.productMap[orderMovement.product_id ?? orderMovement.ProductID] : null} onClose={() => setOrderMovement(null)} />
    </>
  )
}

/** Reason/comment cell — sale movements linked to an order render as a
 *  clickable "Заказ ORD-XXXX" badge instead of the raw UUID-bearing text. */
function MovementReason({ m, onOrderClick, className }) {
  if (m.order_number) {
    return (
      <button
        type="button"
        onClick={() => onOrderClick(m)}
        className={`inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100 ${className ?? ''}`}
      >
        <Package size={12} />
        Заказ {m.order_number}
      </button>
    )
  }
  return <span className={className}>{m.reason ?? m.Reason ?? '—'}</span>
}

function MovementRow({ m, data, onOrderClick }) {
  const type = getMovementType(m)
  const product = data.productMap[m.product_id ?? m.ProductID]
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-2.5"><Badge variant={MOVEMENT_BADGE[type] ?? 'slate'}>{MOVEMENT_LABEL[type] ?? type}</Badge></td>
      <td className="px-3 py-2.5"><p className="font-bold text-slate-900">{getProductName(product)}</p><p className="font-mono text-xs text-slate-400">{getProductSku(product)}</p></td>
      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-950">{m.quantity ?? m.Quantity}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{m.previous_quantity ?? m.PreviousQuantity ?? '—'}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{m.new_quantity ?? m.NewQuantity ?? '—'}</td>
      <td className="px-3 py-2.5 text-slate-500">{m.created_by_name ?? m.CreatedByName ?? '—'}</td>
      <td className="px-3 py-2.5 text-xs text-slate-400">{fmtDate(m.created_at ?? m.CreatedAt)}</td>
      <td className="max-w-[220px] px-3 py-2.5 text-xs text-slate-500">
        <MovementReason m={m} onOrderClick={onOrderClick} className="truncate" />
      </td>
    </tr>
  )
}

function MovementCard({ m, data, onOrderClick }) {
  const type = getMovementType(m)
  const product = data.productMap[m.product_id ?? m.ProductID]
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-950">{getProductName(product)}</p>
        </div>
        <Badge variant={MOVEMENT_BADGE[type] ?? 'slate'}>{MOVEMENT_LABEL[type] ?? type}</Badge>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xl font-bold tabular-nums text-slate-950">{m.quantity ?? m.Quantity}</p>
        <p className="text-right text-xs text-slate-400">{fmtDate(m.created_at ?? m.CreatedAt)}<br />{m.created_by_name ?? m.CreatedByName ?? '—'}</p>
      </div>
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <MovementReason m={m} onOrderClick={onOrderClick} />
      </div>
    </article>
  )
}

function InfoRow({ icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-sm font-medium text-slate-800 break-words">{value}</p>
      </div>
    </div>
  )
}

/** Order detail popup opened from a "Заказ ORD-XXXX" badge in the movements list.
 *  Uses the order/customer/courier fields already embedded in the movement row
 *  (returned by GET /inventory/movements) instead of calling /orders — that API
 *  intentionally excludes warehouse_manager (see orders/routes.go RBAC notes). */
function MovementOrderModal({ movement, product, onClose }) {
  const open = !!movement
  if (!open) return null
  const status = movement.order_status
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Заказ ${movement.order_number}`}
      description="Информация о заказе, к которому относится это движение"
    >
      <div className="space-y-4">
        {status && <Badge variant={STATUS_BADGE[status] ?? 'slate'}>{STATUS_LABELS[status] ?? status}</Badge>}
        <InfoRow icon={<Package size={13} />} label="Товар" value={`${getProductName(product)} × ${movement.quantity ?? movement.Quantity}`} />
        <InfoRow icon={<User2 size={13} />} label="Клиент" value={movement.customer_name} />
        <InfoRow icon={<Phone size={13} />} label="Телефон" value={movement.customer_phone} />
        <InfoRow icon={<MapPin size={13} />} label="Адрес доставки" value={movement.delivery_address} />
        <InfoRow icon={<Truck size={13} />} label="Курьер" value={movement.courier_name ?? 'Не назначен'} />
      </div>
    </Modal>
  )
}
