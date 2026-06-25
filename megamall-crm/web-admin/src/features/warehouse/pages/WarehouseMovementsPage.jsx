import { useMemo, useState } from 'react'
import { ArrowLeftRight, FilterX, Search } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import Badge from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import Alert from '../../../shared/components/Alert'
import useWarehouseData from '../hooks/useWarehouseData'
import { MOVEMENT_BADGE, MOVEMENT_LABEL, fmtDate, getId, getMovementType, getProductName, getProductSku, getWarehouseName, isUUID } from '../utils/warehouseHelpers'

const TYPES = [
  { value: '', label: 'Все типы' },
  { value: 'purchase', label: 'Приход' },
  { value: 'adjustment', label: 'Корректировка' },
  { value: 'writeoff', label: 'Списание' },
  { value: 'transfer_in', label: 'Перемещение +' },
  { value: 'transfer_out', label: 'Перемещение −' },
  { value: 'sale', label: 'Продажа' },
  { value: 'return', label: 'Возврат' },
]

export default function WarehouseMovementsPage() {
  const data = useWarehouseData()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [productId, setProductId] = useState('')
  const validWarehouses = data.warehouses.filter((w) => isUUID(getId(w)))
  const validProducts = data.products.filter((p) => isUUID(getId(p)))

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.movements.filter((m) => {
      const product = data.productMap[m.product_id ?? m.ProductID]
      const warehouse = data.warehouseMap[m.warehouse_id ?? m.WarehouseID]
      if (type && getMovementType(m) !== type) return false
      if (warehouseId && (m.warehouse_id ?? m.WarehouseID) !== warehouseId) return false
      if (productId && (m.product_id ?? m.ProductID) !== productId) return false
      if (!q) return true
      return (
        getProductName(product).toLowerCase().includes(q) ||
        getProductSku(product).toLowerCase().includes(q) ||
        getWarehouseName(warehouse).toLowerCase().includes(q) ||
        (m.reason ?? m.Reason ?? '').toLowerCase().includes(q) ||
        (m.created_by_name ?? m.CreatedByName ?? '').toLowerCase().includes(q)
      )
    })
  }, [data.movements, data.productMap, data.warehouseMap, productId, search, type, warehouseId])

  function clear() {
    setSearch('')
    setType('')
    setWarehouseId('')
    setProductId('')
  }

  return (
    <div className="animate-fade-in p-6">
      <PageHeader title="Движения" subtitle="История операций по остаткам." icon={<ArrowLeftRight size={20} />} />
      {data.error && <Alert variant="error" title="Ошибка загрузки данных" className="mb-5">{data.error?.message}</Alert>}

      <section className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)] xl:grid-cols-[1fr_160px_180px_210px_auto]">
        <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
          <Search size={17} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по товару, складу, пользователю или комментарию…" className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" />
        </label>
        <select className="input py-2" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className="input py-2" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">Все склады</option>
          {validWarehouses.map((w) => <option key={getId(w)} value={getId(w)}>{getWarehouseName(w)}</option>)}
        </select>
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
  if (!rows.length) return <EmptyState icon={<ArrowLeftRight size={22} />} title={emptyTitle} description="Измените фильтры или выполните складскую операцию." />
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)] lg:block">
        <table className="w-full min-w-[1040px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Тип</th>
              <th className="px-3 py-2.5 text-left">Товар</th>
              <th className="px-3 py-2.5 text-left">Склад</th>
              <th className="px-3 py-2.5 text-right">Кол-во</th>
              <th className="px-3 py-2.5 text-right">Было</th>
              <th className="px-3 py-2.5 text-right">Стало</th>
              <th className="px-3 py-2.5 text-left">Пользователь</th>
              <th className="px-3 py-2.5 text-left">Дата</th>
              <th className="px-3 py-2.5 text-left">Комментарий</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((m) => <MovementRow key={getId(m)} m={m} data={data} />)}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 lg:hidden">
        {rows.map((m) => <MovementCard key={getId(m)} m={m} data={data} />)}
      </div>
    </>
  )
}

function MovementRow({ m, data }) {
  const type = getMovementType(m)
  const product = data.productMap[m.product_id ?? m.ProductID]
  const warehouse = data.warehouseMap[m.warehouse_id ?? m.WarehouseID]
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-2.5"><Badge variant={MOVEMENT_BADGE[type] ?? 'slate'}>{MOVEMENT_LABEL[type] ?? type}</Badge></td>
      <td className="px-3 py-2.5"><p className="font-bold text-slate-900">{getProductName(product)}</p><p className="font-mono text-xs text-slate-400">{getProductSku(product)}</p></td>
      <td className="px-3 py-2.5 text-slate-600">{getWarehouseName(warehouse)}</td>
      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-950">{m.quantity ?? m.Quantity}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{m.previous_quantity ?? m.PreviousQuantity ?? '—'}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{m.new_quantity ?? m.NewQuantity ?? '—'}</td>
      <td className="px-3 py-2.5 text-slate-500">{m.created_by_name ?? m.CreatedByName ?? '—'}</td>
      <td className="px-3 py-2.5 text-xs text-slate-400">{fmtDate(m.created_at ?? m.CreatedAt)}</td>
      <td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-slate-500">{m.reason ?? m.Reason ?? '—'}</td>
    </tr>
  )
}

function MovementCard({ m, data }) {
  const type = getMovementType(m)
  const product = data.productMap[m.product_id ?? m.ProductID]
  const warehouse = data.warehouseMap[m.warehouse_id ?? m.WarehouseID]
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-950">{getProductName(product)}</p>
          <p className="mt-0.5 text-xs text-slate-400">{getWarehouseName(warehouse)}</p>
        </div>
        <Badge variant={MOVEMENT_BADGE[type] ?? 'slate'}>{MOVEMENT_LABEL[type] ?? type}</Badge>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xl font-bold tabular-nums text-slate-950">{m.quantity ?? m.Quantity}</p>
        <p className="text-right text-xs text-slate-400">{fmtDate(m.created_at ?? m.CreatedAt)}<br />{m.created_by_name ?? m.CreatedByName ?? '—'}</p>
      </div>
      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{m.reason ?? m.Reason ?? '—'}</p>
    </article>
  )
}
