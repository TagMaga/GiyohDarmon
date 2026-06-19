import { useEffect, useState, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal   from '../../../shared/components/Modal'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { createWriteoff } from '../api'
import { KEYS }  from '../../../shared/queryKeys'
import { getId, getProductName, getProductSku, getWarehouseName, getAvailableQty, isUUID } from '../utils/warehouseHelpers'

const WRITEOFF_REASONS = [
  { value: 'damaged',    label: 'Брак / повреждение' },
  { value: 'lost',       label: 'Потеря / недостача' },
  { value: 'expired',    label: 'Истёк срок годности' },
  { value: 'correction', label: 'Корректировка инвентаризации' },
  { value: 'other',      label: 'Иное' },
]

export default function WriteoffModal({ open, onClose, products, warehouses, inventory = [] }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [warehouseId, setWarehouseId] = useState('')
  const [productId,   setProductId]   = useState('')
  const [quantity,    setQuantity]    = useState('')
  const [reasonKey,   setReasonKey]   = useState('')
  const [comment,     setComment]     = useState('')
  const validWarehouses = warehouses.filter((w) => isUUID(getId(w)))
  const validProducts = products.filter((p) => isUUID(getId(p)))

  useEffect(() => {
    if (!open) return
    if (!warehouseId && validWarehouses.length > 0) setWarehouseId(getId(validWarehouses[0]) ?? '')
    if (!productId && validProducts.length === 1) setProductId(getId(validProducts[0]) ?? '')
  }, [open, productId, validProducts, validWarehouses, warehouseId])

  const currentStock = useMemo(() => {
    if (!warehouseId || !productId) return null
    const inv = inventory.find(i =>
      (i.warehouse_id ?? i.WarehouseID) === warehouseId &&
      (i.product_id   ?? i.ProductID)   === productId
    )
    return inv ? getAvailableQty(inv) : null
  }, [inventory, warehouseId, productId])

  const qty = parseInt(quantity, 10)
  const overLimit = !isNaN(qty) && currentStock !== null && qty > currentStock

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!isUUID(warehouseId) || !isUUID(productId)) throw new Error('Выберите склад и товар')
      if (isNaN(qty) || qty < 1) throw new Error('Количество должно быть ≥ 1')
      if (!reasonKey)            throw new Error('Выберите причину списания')
      if (overLimit)             throw new Error(`Нельзя списать больше доступного остатка (${currentStock} шт.)`)
      const reasonLabel = WRITEOFF_REASONS.find(r => r.value === reasonKey)?.label ?? reasonKey
      const fullReason  = comment.trim() ? `${reasonLabel}: ${comment.trim()}` : reasonLabel
      return createWriteoff({
        warehouse_id: warehouseId,
        product_id:   productId,
        quantity:     qty,
        reason:       fullReason,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventory })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.movements })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.batchesRoot })
      toast.success('Списание оформлено')
      handleClose()
    },
  })

  function handleClose() {
    reset()
    setWarehouseId('')
    setProductId('')
    setQuantity('')
    setReasonKey('')
    setComment('')
    onClose()
  }

  const canSubmit = isUUID(warehouseId) && isUUID(productId) && quantity && reasonKey && !overLimit
  const errMsg = error?.response?.data?.error?.message ?? error?.message

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Списание товара"
      description="Уменьшить остаток на складе"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button variant="danger" onClick={() => canSubmit && mutate()} loading={isPending} disabled={!canSubmit}>
            Списать
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}

      <div className="space-y-4">
        <SelectField
          label="Склад *"
          value={warehouseId}
          onChange={v => { setWarehouseId(v); setProductId(''); setQuantity('') }}
          placeholder="Выберите склад…"
          options={validWarehouses.map(w => ({ value: getId(w), label: getWarehouseName(w) }))}
        />
        <SelectField
          label="Товар *"
          value={productId}
          onChange={v => { setProductId(v); setQuantity('') }}
          placeholder="Выберите товар…"
          options={validProducts.map(p => ({ value: getId(p), label: `${getProductName(p)} (${getProductSku(p)})` }))}
        />

        {currentStock !== null && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${currentStock === 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-600'}`}>
            <span className="font-medium">Доступно на складе:</span>
            <span className="font-bold tabular-nums">{currentStock} шт.</span>
            {currentStock === 0 && <span className="text-rose-500 text-xs">(нет остатка)</span>}
          </div>
        )}

        <div>
          <label className="input-label">Количество к списанию *</label>
          <input
            type="number"
            min="1"
            max={currentStock ?? undefined}
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            className={`input mt-1 ${overLimit ? 'border-rose-400 focus:ring-rose-300' : ''}`}
            placeholder="1"
          />
          {overLimit && (
            <p className="text-xs text-rose-600 mt-1">Превышает доступный остаток ({currentStock} шт.)</p>
          )}
        </div>

        <SelectField
          label="Причина *"
          value={reasonKey}
          onChange={setReasonKey}
          placeholder="Выберите причину…"
          options={WRITEOFF_REASONS}
        />

        <div>
          <label className="input-label">Комментарий (необязательно)</label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            className="input resize-none mt-1"
            rows={2}
            placeholder="Дополнительные детали…"
          />
        </div>
      </div>
    </Modal>
  )
}

function SelectField({ label, value, onChange, placeholder, options }) {
  return (
    <div>
      <label className="input-label">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="input mt-1">
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}
