import { useState, useMemo }            from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal   from '../../../shared/components/Modal'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { createAdjustment } from '../api'
import { KEYS }  from '../../../shared/queryKeys'
import { getId, getProductName, getProductSku, getWarehouseName, getQuantity, isUUID } from '../utils/warehouseHelpers'

export default function AdjustmentModal({ open, onClose, products, warehouses, inventory = [] }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [warehouseId, setWarehouseId] = useState('')
  const [productId,   setProductId]   = useState('')
  const [newQty,      setNewQty]      = useState('')
  const [reason,      setReason]      = useState('')
  const validWarehouses = warehouses.filter((w) => isUUID(getId(w)))
  const validProducts = products.filter((p) => isUUID(getId(p)))

  const currentStock = useMemo(() => {
    if (!warehouseId || !productId) return null
    const inv = inventory.find(i =>
      (i.warehouse_id ?? i.WarehouseID) === warehouseId &&
      (i.product_id   ?? i.ProductID)   === productId
    )
    return inv ? getQuantity(inv) : 0
  }, [inventory, warehouseId, productId])

  const newQtyNum = parseInt(newQty, 10)
  const delta = currentStock !== null && !isNaN(newQtyNum) ? newQtyNum - currentStock : null

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!isUUID(warehouseId) || !isUUID(productId)) throw new Error('Выберите склад и товар')
      if (isNaN(newQtyNum) || newQtyNum < 0) throw new Error('Введите корректное количество (≥ 0)')
      if (!reason.trim())                     throw new Error('Причина обязательна')
      return createAdjustment({
        warehouse_id: warehouseId,
        product_id:   productId,
        new_quantity: newQtyNum,
        reason:       reason.trim(),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventory })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.movements })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.batchesRoot })
      toast.success('Остаток обновлён')
      handleClose()
    },
  })

  function handleClose() {
    reset()
    setWarehouseId('')
    setProductId('')
    setNewQty('')
    setReason('')
    onClose()
  }

  const canSubmit = isUUID(warehouseId) && isUUID(productId) && newQty !== '' && reason.trim()
  const errMsg = error?.response?.data?.error?.message ?? error?.message

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Приход / корректировка"
      description="Установить новый итоговый остаток для товара на складе"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button variant="primary" onClick={() => canSubmit && mutate()} loading={isPending} disabled={!canSubmit}>
            Сохранить
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}

      <div className="space-y-4">
        <SelectField
          label="Склад *"
          value={warehouseId}
          onChange={v => { setWarehouseId(v); setProductId(''); setNewQty('') }}
          placeholder="Выберите склад…"
          options={validWarehouses.map(w => ({ value: getId(w), label: getWarehouseName(w) }))}
        />
        <SelectField
          label="Товар *"
          value={productId}
          onChange={v => { setProductId(v); setNewQty('') }}
          placeholder="Выберите товар…"
          options={validProducts.map(p => ({ value: getId(p), label: `${getProductName(p)} (${getProductSku(p)})` }))}
        />

        {currentStock !== null && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 text-sm text-slate-600">
            <span className="font-medium">Текущий остаток:</span>
            <span className="font-bold tabular-nums">{currentStock} шт.</span>
          </div>
        )}

        <div>
          <label className="input-label">Новый итоговый остаток (шт.) *</label>
          <input
            type="number"
            min="0"
            value={newQty}
            onChange={e => setNewQty(e.target.value)}
            className="input mt-1"
            placeholder="0"
          />
          {delta !== null && !isNaN(newQtyNum) && (
            <p className={`text-xs mt-1 font-medium ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
              {delta > 0 ? `+${delta} шт. (приход)` : delta < 0 ? `${delta} шт. (списание)` : 'Без изменений'}
            </p>
          )}
          <p className="text-xs text-slate-400 mt-0.5">Итоговое количество на складе, а не дельта.</p>
        </div>

        <div>
          <label className="input-label">Причина *</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="input resize-none mt-1"
            rows={2}
            placeholder="Приход от поставщика, инвентаризация…"
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
