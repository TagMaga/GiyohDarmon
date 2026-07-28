import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import Modal from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import { toLocalYMD } from '../../../shared/utils/date'
import { createGoodsReceipt } from '../api'
import { getId, getProductName, getProductSku, getQuantity, isUUID } from '../utils/warehouseHelpers'

function emptyLine() {
  return {
    key: Math.random().toString(36).slice(2),
    productId: '',
    quantity: '',
    unitCost: '',
    salePrice: '',
    expiryDate: '',
  }
}

// ReceivingModal is the multi-line receiving invoice: one shared header
// (invoice number, date, note) and N line items, each creating its own FEFO
// batch — even repeated products with a different price/expiry — committed
// atomically by POST /inventory/receiving/batch.
export default function ReceivingModal({ open, onClose, products, inventory = [], initialProduct = null }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [invoiceNo, setInvoiceNo] = useState('')
  const [receivedAt, setReceivedAt] = useState(() => toLocalYMD(new Date()))
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([emptyLine()])

  useEffect(() => {
    if (!open) return
    setInvoiceNo('')
    setReceivedAt(toLocalYMD(new Date()))
    setNotes('')
    const first = emptyLine()
    if (initialProduct) first.productId = getId(initialProduct) ?? ''
    setLines([first])
  }, [open, initialProduct])

  const validProducts = useMemo(() => products.filter((p) => isUUID(getId(p))), [products])
  const inventoryByProduct = useMemo(() => {
    const map = {}
    for (const inv of inventory) map[inv.product_id ?? inv.ProductID] = inv
    return map
  }, [inventory])

  function updateLine(key, patch) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()])
  }

  function removeLine(key) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev))
  }

  const parsedLines = lines.map((l) => {
    const qty = Number.parseInt(l.quantity, 10)
    const cost = l.unitCost === '' ? 0 : Number.parseFloat(l.unitCost)
    const currentStock = isUUID(l.productId) ? getQuantity(inventoryByProduct[l.productId]) : null
    return {
      ...l,
      qty,
      cost,
      currentStock,
      resultQty: currentStock !== null && !Number.isNaN(qty) ? currentStock + qty : null,
      lineValue: !Number.isNaN(qty) && !Number.isNaN(cost) ? qty * cost : 0,
      valid: isUUID(l.productId) && Number.isInteger(qty) && qty > 0 && !Number.isNaN(cost) && cost >= 0 && Boolean(l.expiryDate),
    }
  })

  const itemCount = parsedLines.length
  const totalUnits = parsedLines.reduce((sum, l) => sum + (Number.isNaN(l.qty) ? 0 : l.qty), 0)
  const totalValue = parsedLines.reduce((sum, l) => sum + l.lineValue, 0)
  const canSubmit = invoiceNo.trim() !== '' && receivedAt !== '' && parsedLines.length > 0 && parsedLines.every((l) => l.valid)

  const mutation = useMutation({
    mutationFn: async () => {
      return createGoodsReceipt({
        invoice_no: invoiceNo.trim(),
        received_at: receivedAt,
        notes: notes.trim() || undefined,
        items: parsedLines.map((l) => ({
          product_id: l.productId,
          quantity: l.qty,
          unit_cost: l.cost,
          sale_price: l.salePrice !== '' ? Number(l.salePrice) : undefined,
          expiry_date: l.expiryDate,
        })),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventory })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.movements })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.batchesRoot })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.products })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.expiryAlerts })
      toast.success(`Приёмка проведена — ${itemCount} ${itemCount === 1 ? 'позиция' : 'позиций'}, ${totalUnits} шт.`)
      handleClose()
    },
  })

  function handleClose() {
    mutation.reset()
    onClose()
  }

  const errMsg = mutation.error?.response?.data?.error?.message ?? mutation.error?.message

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Приёмка по накладной"
      description="Добавьте одну или несколько строк. Каждая строка создаёт отдельную FEFO-партию со своим сроком годности."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={mutation.isPending}>Отмена</Button>
          <Button variant="primary" onClick={() => canSubmit && mutation.mutate()} loading={mutation.isPending} disabled={!canSubmit}>
            Провести приёмку
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="sm:col-span-1">
          <span className="input-label">Номер накладной *</span>
          <input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="INV-1001" />
        </label>
        <label className="sm:col-span-1">
          <span className="input-label">Дата приёмки *</span>
          <input className="input" type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
        </label>
        <label className="sm:col-span-1">
          <span className="input-label">Примечание</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Необязательно" />
        </label>
      </div>

      <div className="mt-5 space-y-3">
        {parsedLines.map((line, idx) => (
          <LineItem
            key={line.key}
            index={idx}
            line={line}
            products={validProducts}
            onChange={(patch) => updateLine(line.key, patch)}
            onRemove={() => removeLine(line.key)}
            removable={lines.length > 1}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addLine}
        className="mt-3 inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
      >
        <Plus size={14} /> Добавить строку
      </button>

      <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <StockMath label="Позиций" value={itemCount} />
          <StockMath label="Единиц" value={totalUnits} />
          <StockMath label="Сумма накладной" value={totalValue.toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + ' с'} strong />
        </div>
      </div>
    </Modal>
  )
}

function LineItem({ index, line, products, onChange, onRemove, removable }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Строка {index + 1}</span>
        {removable && (
          <button type="button" onClick={onRemove} className="flex h-7 w-7 items-center justify-center rounded-lg text-rose-500 transition-colors hover:bg-rose-50" title="Удалить строку">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="lg:col-span-1">
          <span className="input-label">Товар *</span>
          <select className="input" value={line.productId} onChange={(e) => onChange({ productId: e.target.value })}>
            <option value="">Выберите товар</option>
            {products.map((p) => <option key={getId(p)} value={getId(p)}>{getProductName(p)} ({getProductSku(p)})</option>)}
          </select>
        </label>
        <Field label="Количество прихода *" type="number" min="1" value={line.quantity} onChange={(v) => onChange({ quantity: v })} placeholder="0" />
        <Field label="Срок годности *" type="date" value={line.expiryDate} onChange={(v) => onChange({ expiryDate: v })} />
        <Field label="Закупочная цена за ед. *" type="number" min="0" step="0.01" value={line.unitCost} onChange={(v) => onChange({ unitCost: v })} placeholder="0.00" />
        <Field label="Цена продажи" type="number" min="0" step="0.01" value={line.salePrice} onChange={(v) => onChange({ salePrice: v })} placeholder="0.00" />
      </div>

      {line.currentStock !== null && (
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 px-3 py-2 text-center text-xs">
          <MiniStat label="Сейчас" value={line.currentStock} />
          <MiniStat label="Приход" value={Number.isNaN(line.qty) ? '—' : `+${line.qty}`} />
          <MiniStat label="Итого" value={line.resultQty ?? '—'} strong />
        </div>
      )}
      {line.lineValue > 0 && (
        <p className="mt-2 text-right text-xs text-slate-500">
          Стоимость строки: <b className="text-slate-800">{line.lineValue.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} с</b>
        </p>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', min, step, placeholder }) {
  return (
    <label>
      <span className="input-label">{label}</span>
      <input className="input" type={type} min={min} step={step} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function MiniStat({ label, value, strong }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 tabular-nums ${strong ? 'text-sm font-bold text-slate-900' : 'text-sm font-semibold text-slate-600'}`}>{value}</p>
    </div>
  )
}

function StockMath({ label, value, strong }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700/70">{label}</p>
      <p className={`mt-1 tabular-nums ${strong ? 'text-2xl font-bold text-emerald-800' : 'text-lg font-semibold text-emerald-700'}`}>{value}</p>
    </div>
  )
}
