import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, FilterX, Search, Package, User2, Phone, MapPin, Truck, Pencil, FileText, Calendar, BadgeDollarSign, Clock } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import Badge from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import Alert from '../../../shared/components/Alert'
import Modal from '../../../shared/components/Modal'
import { STATUS_LABELS, STATUS_BADGE } from '../../../shared/orderStatusConfig'
import ReceivingEditModal from '../components/ReceivingEditModal'
import useWarehouseData from '../hooks/useWarehouseData'
import { fetchReceivingHistory } from '../api'
import { MOVEMENT_BADGE, MOVEMENT_LABEL, fmtDate, fmtMoney, getId, getMovementType, getMovementUnitCost, getProductImageSrcSet, getProductImageVariant, getProductName, getProductSku, getSaleUnitPrice, isUUID } from '../utils/warehouseHelpers'

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

      <section className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)] lg:grid-cols-[minmax(0,1fr)_160px_210px_auto]">
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

export function MovementList({ rows, data, emptyTitle = 'Движения не найдены', showEntryActions = false }) {
  const [detailMovement, setDetailMovement] = useState(null)
  const [editReceiving, setEditReceiving] = useState(null)
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
              <th className="px-3 py-2.5 text-right">Закупочная цена</th>
              <th className="px-3 py-2.5 text-right">Продажа</th>
              <th className="px-3 py-2.5 text-left">Пользователь</th>
              <th className="px-3 py-2.5 text-left">Дата</th>
              <th className="px-3 py-2.5 text-left">Комментарий</th>
              {showEntryActions && <th className="px-3 py-2.5 text-right">Действия</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((m) => <MovementRow key={getId(m)} m={m} data={data} onOpen={setDetailMovement} onEdit={setEditReceiving} showActions={showEntryActions} />)}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 lg:hidden">
        {rows.map((m) => <MovementCard key={getId(m)} m={m} data={data} onOpen={setDetailMovement} onEdit={setEditReceiving} showActions={showEntryActions} />)}
      </div>
      <MovementDetailModal
        movement={detailMovement}
        product={detailMovement ? data.productMap[detailMovement.product_id ?? detailMovement.ProductID] : null}
        onClose={() => setDetailMovement(null)}
        canEdit={showEntryActions && canEditMovement(detailMovement)}
        onEditReceiving={(movement) => {
          setDetailMovement(null)
          setEditReceiving(movement)
        }}
      />
      <ReceivingEditModal movement={editReceiving} products={data.products} onClose={() => setEditReceiving(null)} />
    </>
  )
}

function cleanReason(m) {
  const type = getMovementType(m)
  const reason = m.reason ?? m.Reason ?? ''
  if (type === 'sale') {
    return m.order_number ? `Заказ ${m.order_number}` : 'Продажа по заказу'
  }
  if (type === 'purchase') {
    return reason.replace(/^Приёмка товара\s*·?\s*/, '').trim() || 'Приёмка товара'
  }
  return reason || '—'
}

function MovementReason({ m, className }) {
  if (m.order_number) {
    return <span className={`inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 ${className ?? ''}`}><Package size={12} />Заказ {m.order_number}</span>
  }
  return <span className={className}>{cleanReason(m)}</span>
}

function canEditMovement(m) {
  const type = getMovementType(m)
  return type === 'purchase' || type === 'writeoff'
}

function ProductThumb({ product }) {
  const image = getProductImageVariant(product, 'thumbnail')
  const name = getProductName(product)
  const letter = name && name !== '—' ? name[0].toUpperCase() : '•'
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      {image ? (
        <img
          src={image}
          srcSet={getProductImageSrcSet(product)}
          sizes="40px"
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="text-sm font-bold text-slate-400">{letter}</span>
      )}
    </div>
  )
}

function MovementActions({ m, onEdit }) {
  if (!canEditMovement(m)) return null
  return (
    <div className="flex justify-end gap-1.5">
      <Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={(e) => { e.stopPropagation(); onEdit(m) }}>Изменить</Button>
    </div>
  )
}

function MovementRow({ m, data, onOpen, onEdit, showActions }) {
  const type = getMovementType(m)
  const product = data.productMap[m.product_id ?? m.ProductID]
  return (
    <tr className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(m)}>
      <td className="px-3 py-2.5"><Badge variant={MOVEMENT_BADGE[type] ?? 'slate'}>{MOVEMENT_LABEL[type] ?? type}</Badge></td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-3">
          <ProductThumb product={product} />
          <div className="min-w-0">
            <p className="truncate font-bold text-slate-900">{getProductName(product)}</p>
            <p className="font-mono text-xs text-slate-400">{getProductSku(product)}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-950">{m.quantity ?? m.Quantity}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{m.previous_quantity ?? m.PreviousQuantity ?? '—'}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{m.new_quantity ?? m.NewQuantity ?? '—'}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{getMovementUnitCost(m) != null ? fmtMoney(getMovementUnitCost(m)) : '—'}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{type === 'sale' && getSaleUnitPrice(m) != null ? fmtMoney(getSaleUnitPrice(m)) : '—'}</td>
      <td className="px-3 py-2.5 text-slate-500">{m.created_by_name ?? m.CreatedByName ?? '—'}</td>
      <td className="px-3 py-2.5 text-xs text-slate-400">{fmtDate(m.created_at ?? m.CreatedAt)}</td>
      <td className="max-w-[220px] px-3 py-2.5 text-xs text-slate-500">
        <MovementReason m={m} className="truncate" />
      </td>
      {showActions && <td className="px-3 py-2.5 text-right"><MovementActions m={m} onEdit={onEdit} /></td>}
    </tr>
  )
}

function MovementCard({ m, data, onOpen, onEdit, showActions }) {
  const type = getMovementType(m)
  const product = data.productMap[m.product_id ?? m.ProductID]
  return (
    <article onClick={() => onOpen(m)} className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <ProductThumb product={product} />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-950">{getProductName(product)}</p>
            <p className="font-mono text-xs text-slate-400">{getProductSku(product)}</p>
          </div>
        </div>
        <Badge variant={MOVEMENT_BADGE[type] ?? 'slate'}>{MOVEMENT_LABEL[type] ?? type}</Badge>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xl font-bold tabular-nums text-slate-950">{m.quantity ?? m.Quantity}</p>
        <p className="text-right text-xs text-slate-400">{fmtDate(m.created_at ?? m.CreatedAt)}<br />{m.created_by_name ?? m.CreatedByName ?? '—'}</p>
      </div>
      {getMovementUnitCost(m) != null && (
        <p className="mt-2 text-xs text-slate-500">Закупочная цена: <span className="font-semibold text-slate-700">{fmtMoney(getMovementUnitCost(m))}</span></p>
      )}
      {type === 'sale' && getSaleUnitPrice(m) != null && (
        <p className="mt-1 text-xs text-slate-500">Продажа: <span className="font-semibold text-slate-700">{fmtMoney(getSaleUnitPrice(m))}</span></p>
      )}
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <MovementReason m={m} />
      </div>
      {showActions && canEditMovement(m) && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={(e) => { e.stopPropagation(); onEdit(m) }}>Изменить</Button>
        </div>
      )}
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

function MoneyRow({ label, value, bold = false }) {
  if (value == null) return null
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`${bold ? 'text-lg font-black text-slate-950' : 'text-sm font-bold text-slate-800'}`}>{fmtMoney(value)}</span>
    </div>
  )
}

function MovementDetailModal({ movement, product, onClose, onEditReceiving, canEdit = false }) {
  const open = !!movement
  if (!open) return null
  const type = getMovementType(movement)
  if (type === 'purchase' || type === 'adjustment' || type === 'writeoff') {
    return <InventoryOperationDetailModal movement={movement} product={product} onClose={onClose} onEditReceiving={onEditReceiving} canEdit={canEdit} />
  }
  if (type === 'sale') {
    return <MovementOrderModal movement={movement} product={product} onClose={onClose} />
  }
  return (
    <Modal open={open} onClose={onClose} title={MOVEMENT_LABEL[type] ?? 'Движение'} description="Детали складской операции">
      <div className="space-y-4">
        <InfoRow icon={<Package size={13} />} label="Товар" value={`${getProductName(product)} × ${movement.quantity ?? movement.Quantity}`} />
        <InfoRow icon={<User2 size={13} />} label="Пользователь" value={movement.created_by_name ?? movement.CreatedByName ?? '—'} />
        <InfoRow icon={<Calendar size={13} />} label="Дата" value={fmtDate(movement.created_at ?? movement.CreatedAt)} />
        <InfoRow icon={<FileText size={13} />} label="Комментарий" value={cleanReason(movement)} />
      </div>
    </Modal>
  )
}

function InventoryOperationDetailModal({ movement, product, onClose, onEditReceiving, canEdit }) {
  const type = getMovementType(movement)
  const title = MOVEMENT_LABEL[type] ?? 'Движение'
  const unitCost = movement.batch_unit_cost ?? movement.BatchUnitCost
  return (
    <Modal
      open={!!movement}
      onClose={onClose}
      title={title}
      description="Детали складской операции и история изменений"
      footer={canEdit ? (
        <Button variant="primary" icon={<Pencil size={15} />} onClick={() => onEditReceiving(movement)}>
          Редактировать
        </Button>
      ) : null}
    >
      <div className="space-y-4">
        <InfoRow icon={<Package size={13} />} label="Товар" value={`${getProductName(product)} × ${movement.quantity ?? movement.Quantity}`} />
        {type !== 'writeoff' && <InfoRow icon={<BadgeDollarSign size={13} />} label="Закупочная цена" value={fmtMoney(unitCost ?? 0)} />}
        <InfoRow icon={<FileText size={13} />} label={type === 'writeoff' ? 'Комментарий' : 'Примечание'} value={cleanReason(movement)} />
        <InfoRow icon={<User2 size={13} />} label="Пользователь" value={movement.created_by_name ?? movement.CreatedByName ?? '—'} />
        <InfoRow icon={<Calendar size={13} />} label="Дата" value={fmtDate(movement.created_at ?? movement.CreatedAt)} />
        {movement.edit_count > 0 && <Badge variant="amber">Изменено {movement.edit_count}</Badge>}
        <ReceivingHistoryPanel movementId={getId(movement)} />
      </div>
    </Modal>
  )
}

function fmtQty(v) {
  return Number(v || 0).toLocaleString('ru-RU')
}

function ReceivingHistoryPanel({ movementId }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['warehouse', 'receiving-history', movementId],
    queryFn: () => fetchReceivingHistory(movementId),
    enabled: !!movementId,
  })

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <Clock size={13} className="text-slate-400" />
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">История изменений</p>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          <div className="h-8 rounded-lg bg-slate-100 animate-pulse" />
          <div className="h-8 rounded-lg bg-slate-100 animate-pulse" />
        </div>
      ) : history.length ? (
        <div className="max-h-[220px] overflow-y-auto">
          {history.map((edit) => <ReceivingHistoryItem key={edit.id} edit={edit} />)}
        </div>
      ) : (
        <p className="text-xs text-slate-400">Изменений ещё не было</p>
      )}
    </div>
  )
}

function ReceivingHistoryItem({ edit }) {
  const changes = []
  if (edit.old_product_id !== edit.new_product_id) {
    changes.push(`товар ${edit.old_product_name || edit.old_product_id} -> ${edit.new_product_name || edit.new_product_id}`)
  }
  if (edit.old_quantity !== edit.new_quantity) changes.push(`количество ${fmtQty(edit.old_quantity)} -> ${fmtQty(edit.new_quantity)}`)
  if (Number(edit.old_unit_cost) !== Number(edit.new_unit_cost)) changes.push(`цена ${fmtMoney(edit.old_unit_cost)} -> ${fmtMoney(edit.new_unit_cost)}`)
  if ((edit.old_note ?? '') !== (edit.new_note ?? '')) changes.push(`примечание "${edit.old_note || '-'}" -> "${edit.new_note || '-'}"`)

  return (
    <div className="flex gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white">
        <Pencil size={10} className="text-slate-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-700">{edit.editor_name || 'Неизвестно'}</p>
        <div className="mt-1 space-y-0.5">
          {changes.length ? changes.map((line) => (
            <p key={line} className="text-[11px] leading-snug text-slate-500">{line}</p>
          )) : <p className="text-[11px] text-slate-400">изменено</p>}
        </div>
      </div>
      <p className="mt-0.5 flex-shrink-0 text-[10px] text-slate-400">{fmtDate(edit.edited_at)}</p>
    </div>
  )
}

function MovementOrderModal({ movement, product, onClose }) {
  const status = movement.order_status
  return (
    <Modal
      open={!!movement}
      onClose={onClose}
      title={movement.order_number ? `Заказ ${movement.order_number}` : 'Заказ'}
      description="Информация о заказе, к которому относится это движение"
    >
      <div className="space-y-4">
        {status && <Badge variant={STATUS_BADGE[status] ?? 'slate'}>{STATUS_LABELS[status] ?? status}</Badge>}
        <InfoRow icon={<Package size={13} />} label="Товар" value={`${getProductName(product)} × ${movement.quantity ?? movement.Quantity}`} />
        <InfoRow icon={<User2 size={13} />} label="Клиент" value={movement.customer_name} />
        <InfoRow icon={<Phone size={13} />} label="Телефон" value={movement.customer_phone} />
        <InfoRow icon={<MapPin size={13} />} label="Адрес доставки" value={movement.delivery_address} />
        <InfoRow icon={<Truck size={13} />} label="Курьер" value={movement.courier_name ?? 'Не назначен'} />
        <InfoRow icon={<BadgeDollarSign size={13} />} label="Закупочная цена" value={getMovementUnitCost(movement) != null ? fmtMoney(getMovementUnitCost(movement)) : '—'} />
        <InfoRow icon={<BadgeDollarSign size={13} />} label="Цена продажи" value={getSaleUnitPrice(movement) != null ? fmtMoney(getSaleUnitPrice(movement)) : '—'} />
        <div className="rounded-2xl bg-indigo-50 p-4">
          <MoneyRow label="Сумма товаров" value={movement.total_amount} />
          <MoneyRow label="Доставка" value={movement.delivery_fee} />
          <div className="my-2 h-px bg-indigo-100" />
          <MoneyRow label="Итого" value={movement.total_order_amount} bold />
        </div>
      </div>
    </Modal>
  )
}
