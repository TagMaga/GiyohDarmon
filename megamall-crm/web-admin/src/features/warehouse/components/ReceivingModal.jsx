import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import { createReceiving } from '../api'
import { getAvailableQty, getId, getProductName, getProductSku, getQuantity, getWarehouseName, isUUID } from '../utils/warehouseHelpers'

export default function ReceivingModal({ open, onClose, products, warehouses, inventory = [], initialProduct = null }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [warehouseId, setWarehouseId] = useState('')
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [invoice, setInvoice] = useState('')
  const [notes, setNotes] = useState('')
  const validWarehouses = warehouses.filter((w) => isUUID(getId(w)))

  useEffect(() => {
    if (!open) return
    if (initialProduct) setProductId(getId(initialProduct) ?? '')
    if (!warehouseId && validWarehouses.length > 0) setWarehouseId(getId(validWarehouses[0]) ?? '')
  }, [open, initialProduct, validWarehouses, warehouseId])

  const currentStock = useMemo(() => {
    if (!warehouseId || !productId) return null
    const row = inventory.find((inv) =>
      (inv.warehouse_id ?? inv.WarehouseID) === warehouseId &&
      (inv.product_id ?? inv.ProductID) === productId
    )
    return row ? getQuantity(row) : 0
  }, [inventory, productId, warehouseId])

  const qty = Number.parseInt(quantity, 10)
  const cost = unitCost === '' ? 0 : Number.parseFloat(unitCost)
  const resultQty = currentStock !== null && !Number.isNaN(qty) ? currentStock + qty : null
  const batchValue = !Number.isNaN(qty) && !Number.isNaN(cost) ? qty * cost : null

  const mutation = useMutation({
    mutationFn: () => {
      if (!isUUID(warehouseId) || !isUUID(productId)) throw new Error('Выберите склад и товар')
      if (Number.isNaN(qty) || qty < 1) throw new Error('Количество прихода должно быть ≥ 1')
      if (Number.isNaN(cost) || cost < 0) throw new Error('Закупочная цена должна быть ≥ 0')
      return createReceiving({
        warehouse_id: warehouseId,
        product_id: productId,
        quantity: qty,
        unit_cost: cost,
        invoice_no: invoice.trim() || undefined,
        notes: notes.trim() || undefined,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventory })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.movements })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.batchesRoot })
      toast.success('Приёмка проведена — партия создана')
      handleClose()
    },
  })

  function handleClose() {
    setWarehouseId('')
    setProductId('')
    setQuantity('')
    setUnitCost('')
    setInvoice('')
    setNotes('')
    mutation.reset()
    onClose()
  }

  const selectedInventory = inventory.find((inv) =>
    (inv.warehouse_id ?? inv.WarehouseID) === warehouseId &&
    (inv.product_id ?? inv.ProductID) === productId
  )
  const errMsg = mutation.error?.response?.data?.error?.message ?? mutation.error?.message
  const canSubmit = isUUID(warehouseId) && isUUID(productId) && qty > 0 && !Number.isNaN(cost) && cost >= 0

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Новая приёмка"
      description="Введите количество и закупочную цену. Создаётся отдельная партия для FIFO-учёта."
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Склад *" value={warehouseId} onChange={setWarehouseId} placeholder="Выберите склад" options={validWarehouses.map((w) => ({ value: getId(w), label: getWarehouseName(w) }))} />
        <Select label="Товар *" value={productId} onChange={setProductId} placeholder="Выберите товар" options={products.filter((p) => isUUID(getId(p))).map((p) => ({ value: getId(p), label: `${getProductName(p)} (${getProductSku(p)})` }))} />
        <Field label="Количество прихода *" type="number" min="1" value={quantity} onChange={setQuantity} placeholder="0" />
        <Field label="Закупочная цена за ед. *" type="number" min="0" step="0.01" value={unitCost} onChange={setUnitCost} placeholder="0.00" />
        <Field label="Номер накладной" value={invoice} onChange={setInvoice} placeholder="Необязательно" />
        <Field label="Примечание" value={notes} onChange={setNotes} placeholder="Необязательно" />
      </div>

      {currentStock !== null && (
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <StockMath label="Сейчас" value={currentStock} />
            <StockMath label="Приход" value={Number.isNaN(qty) ? '—' : `+${qty}`} />
            <StockMath label="Итого" value={resultQty ?? '—'} strong />
          </div>
          {batchValue !== null && !Number.isNaN(batchValue) && (
            <p className="mt-3 text-center text-xs text-emerald-700">
              Стоимость партии: <b>{batchValue.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} сом</b>
              {unitCost !== '' && cost > 0 && ` · ${cost.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} сом/ед.`}
            </p>
          )}
          {selectedInventory && (
            <p className="mt-1 text-center text-xs text-emerald-600">
              Доступно до приёмки: {getAvailableQty(selectedInventory)} шт.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
        <p className="text-xs text-blue-700">
          <b>FIFO-партия:</b> приход создаёт новую партию с фиксированной себестоимостью.
          При списании или продаже сначала расходуются самые старые партии.
        </p>
      </div>
    </Modal>
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

function Select({ label, value, onChange, options, placeholder }) {
  return (
    <label>
      <span className="input-label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
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
