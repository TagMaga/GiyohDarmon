import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Package, Plus, Trash2, Truck, XCircle } from 'lucide-react'
import Modal from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Badge from '../../../shared/components/Badge'
import Alert from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { fetchCouriersOverview } from '../../dispatcher/api'
import {
  useAcceptReturn,
  useCreateTransfer,
  useDecideLostReport,
  useLostReports,
  useRejectReturn,
  useReturns,
  useWarehouses,
} from '../hooks/useTransfers'
import { getId, getProductName, getProductSku, isUUID } from '../utils/warehouseHelpers'

const STATUS_LABEL = { issued: 'Выдан', accepted: 'Принят', rejected: 'Отклонён' }
const STATUS_VARIANT = { issued: 'amber', accepted: 'emerald', rejected: 'rose' }

export function TransferStatusBadge({ status }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'slate'} dot>{STATUS_LABEL[status] ?? status}</Badge>
}

export const TRANSFER_STATUS_FILTERS = [
  { value: '', label: 'Все статусы' },
  { value: 'issued', label: 'Выдан' },
  { value: 'accepted', label: 'Принят' },
  { value: 'rejected', label: 'Отклонён' },
]

// ─── New Transfer modal ─────────────────────────────────────────────────────

export function NewTransferModal({ open, onClose, products = [] }) {
  const toast = useToast()
  const { data: warehouses = [] } = useWarehouses({ enabled: open })
  const { data: couriers } = useQuery({
    queryKey: ['dispatch', 'couriers-overview'],
    queryFn: fetchCouriersOverview,
    enabled: open,
    staleTime: 30_000,
  })
  const createTransfer = useCreateTransfer()

  const mainWarehouses = useMemo(() => warehouses.filter((w) => w.type === 'main'), [warehouses])
  const courierList = Array.isArray(couriers) ? couriers : (couriers?.couriers ?? [])

  const [fromWarehouseId, setFromWarehouseId] = useState('')
  const [courierId, setCourierId] = useState('')
  const [items, setItems] = useState([{ product_id: '', quantity: '' }])
  const [error, setError] = useState('')

  function reset() {
    setFromWarehouseId('')
    setCourierId('')
    setItems([{ product_id: '', quantity: '' }])
    setError('')
  }

  function close() {
    reset()
    onClose()
  }

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function addItem() {
    setItems((prev) => [...prev, { product_id: '', quantity: '' }])
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  async function submit() {
    setError('')
    if (!isUUID(fromWarehouseId)) return setError('Выберите склад-источник')
    if (!isUUID(courierId)) return setError('Выберите курьера')
    const cleanItems = items
      .filter((it) => it.product_id)
      .map((it) => ({ product_id: it.product_id, quantity: Number.parseInt(it.quantity, 10) }))
    if (cleanItems.length === 0) return setError('Добавьте хотя бы один товар')
    if (cleanItems.some((it) => !Number.isInteger(it.quantity) || it.quantity < 1)) {
      return setError('Количество каждого товара должно быть ≥ 1')
    }
    try {
      await createTransfer.mutateAsync({ from_warehouse_id: fromWarehouseId, courier_id: courierId, items: cleanItems })
      toast?.success?.('Передача создана и ожидает подтверждения курьера')
      close()
    } catch (err) {
      setError(err?.response?.data?.error?.message ?? err.message ?? 'Не удалось создать передачу')
    }
  }

  return (
    <Modal open={open} onClose={close} title="Новая передача курьеру" size="lg"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>Отмена</Button>
          <Button variant="primary" icon={<Truck size={15} />} loading={createTransfer.isPending} onClick={submit}>
            Создать передачу
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Склад-источник</span>
            <select className="input" value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)}>
              <option value="">Выберите склад</option>
              {mainWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Курьер</span>
            <select className="input" value={courierId} onChange={(e) => setCourierId(e.target.value)}>
              <option value="">Выберите курьера</option>
              {courierList.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Товары и количество</span>
            <button onClick={addItem} className="flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900">
              <Plus size={14} /> Добавить товар
            </button>
          </div>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="grid grid-cols-[minmax(0,1fr)_100px_36px] gap-2">
                <select className="input" value={it.product_id} onChange={(e) => updateItem(idx, { product_id: e.target.value })}>
                  <option value="">Выберите товар</option>
                  {products.filter((p) => isUUID(getId(p))).map((p) => (
                    <option key={getId(p)} value={getId(p)}>{getProductName(p)} ({getProductSku(p)})</option>
                  ))}
                </select>
                <input
                  type="number" min="1" placeholder="Кол-во"
                  className="input"
                  value={it.quantity}
                  onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                />
                <button
                  onClick={() => removeItem(idx)}
                  disabled={items.length === 1}
                  className="flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-30"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Transfer list + detail ─────────────────────────────────────────────────

export function TransferList({ transfers = [], loading }) {
  const [detail, setDetail] = useState(null)

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">Загрузка…</div>
  }
  if (!transfers.length) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-5">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><Truck size={18} /></div>
        <div>
          <p className="text-sm font-bold text-slate-800">Передач пока нет</p>
          <p className="mt-0.5 text-xs text-slate-400">Создайте новую передачу курьеру.</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Курьер</th>
              <th className="px-3 py-2.5 text-left">Склад-источник</th>
              <th className="px-3 py-2.5 text-left">Товары</th>
              <th className="px-3 py-2.5 text-left">Создал</th>
              <th className="px-3 py-2.5 text-left">Дата</th>
              <th className="px-3 py-2.5 text-left">Статус</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {transfers.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetail(t)}>
                <td className="px-3 py-2.5 font-bold text-slate-950">{t.courier_name || t.to_courier_id}</td>
                <td className="px-3 py-2.5 text-slate-600">{t.from_warehouse_name}</td>
                <td className="px-3 py-2.5 text-slate-600">{t.items?.length ?? 0} поз. / {t.items?.reduce((s, i) => s + i.quantity, 0) ?? 0} шт.</td>
                <td className="px-3 py-2.5 text-slate-600">{t.created_by_name}</td>
                <td className="px-3 py-2.5 text-slate-500">{t.created_at ? new Date(t.created_at).toLocaleString('ru-RU') : '—'}</td>
                <td className="px-3 py-2.5"><TransferStatusBadge status={t.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Передача товара" size="md">
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-slate-400">Курьер</p><p className="font-bold text-slate-950">{detail.courier_name}</p></div>
              <div><p className="text-xs text-slate-400">Склад-источник</p><p className="font-bold text-slate-950">{detail.from_warehouse_name}</p></div>
              <div><p className="text-xs text-slate-400">Создал</p><p className="font-semibold text-slate-700">{detail.created_by_name}</p></div>
              <div><p className="text-xs text-slate-400">Статус</p><TransferStatusBadge status={detail.status} /></div>
            </div>
            <div className="rounded-lg border border-slate-200">
              {detail.items?.map((it) => (
                <div key={it.product_id} className="flex items-center justify-between border-b border-slate-100 px-3 py-2 last:border-b-0">
                  <span className="font-medium text-slate-800">{it.product_name}</span>
                  <span className="font-bold tabular-nums text-slate-950">{it.quantity} шт.</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

// ─── Pending returns (courier full-inventory returns awaiting acceptance) ──

export function PendingReturnsPanel() {
  const { data: returns = [], isLoading } = useReturns({ status: 'requested' })
  const accept = useAcceptReturn()
  const reject = useRejectReturn()
  const toast = useToast()

  if (isLoading) return null

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-slate-950">Возвраты от курьеров</h2>
        <p className="mt-1 text-xs text-slate-400">Полный возврат остатка курьера ожидает подтверждения.</p>
      </div>
      {returns.length === 0 ? (
        <p className="text-xs text-slate-400">Ожидающих возвратов нет.</p>
      ) : (
        <div className="space-y-2">
          {returns.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-950">{r.courier_name}</span>
                <span className="text-xs text-slate-400">{r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : ''}</span>
              </div>
              <div className="mb-2 flex flex-wrap gap-2 text-xs text-slate-600">
                {r.items?.map((it) => (
                  <span key={it.product_id} className="rounded-full bg-slate-100 px-2 py-1">{it.product_name} × {it.quantity}</span>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" icon={<XCircle size={14} />}
                  onClick={async () => { await reject.mutateAsync(r.id); toast?.info?.('Возврат отклонён') }}>
                  Отклонить
                </Button>
                <Button size="sm" variant="primary" icon={<CheckCircle2 size={14} />}
                  onClick={async () => { await accept.mutateAsync(r.id); toast?.success?.('Возврат принят на склад') }}>
                  Принять
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Lost-product reports (courier debt approval) ──────────────────────────

export function LostReportsPanel() {
  const { data: reports = [], isLoading } = useLostReports({ status: 'pending' })
  const decide = useDecideLostReport()
  const toast = useToast()

  if (isLoading) return null

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-slate-950">Заявки об утере товара</h2>
        <p className="mt-1 text-xs text-slate-400">Утверждение спишет товар со склада курьера и зафиксирует долг (без учёта доставки).</p>
      </div>
      {reports.length === 0 ? (
        <p className="text-xs text-slate-400">Заявок нет.</p>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-950">{r.courier_name}</span>
                <span className="text-xs font-bold text-rose-700">Долг: {r.debt_amount} c</span>
              </div>
              <p className="mb-2 text-xs text-slate-600">{r.product_name} × {r.quantity} — {r.comment}</p>
              {r.photo_url && (
                <a href={r.photo_url} target="_blank" rel="noreferrer" className="mb-2 inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline">
                  <Package size={12} /> Фото
                </a>
              )}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" icon={<XCircle size={14} />}
                  onClick={async () => { await decide.mutateAsync({ reportId: r.id, payload: { approve: false } }); toast?.info?.('Заявка отклонена') }}>
                  Отклонить
                </Button>
                <Button size="sm" variant="danger" icon={<CheckCircle2 size={14} />}
                  onClick={async () => { await decide.mutateAsync({ reportId: r.id, payload: { approve: true } }); toast?.success?.('Долг зафиксирован') }}>
                  Утвердить долг
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
