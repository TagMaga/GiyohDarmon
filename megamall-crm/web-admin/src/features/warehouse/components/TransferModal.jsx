import { useEffect, useState, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal   from '../../../shared/components/Modal'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { createTransfer } from '../api'
import { KEYS }  from '../../../shared/queryKeys'
import { getId, getProductName, getProductSku, getWarehouseName, getAvailableQty, isUUID } from '../utils/warehouseHelpers'
import { ArrowLeftRight } from 'lucide-react'

export default function TransferModal({ open, onClose, products, warehouses, inventory = [] }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [fromId,    setFromId]    = useState('')
  const [toId,      setToId]      = useState('')
  const [productId, setProductId] = useState('')
  const [quantity,  setQuantity]  = useState('')
  const [reason,    setReason]    = useState('')
  const validWarehouses = warehouses.filter((w) => isUUID(getId(w)))
  const validProducts = products.filter((p) => isUUID(getId(p)))

  useEffect(() => {
    if (!open) return
    if (!productId && validProducts.length === 1) setProductId(getId(validProducts[0]) ?? '')
  }, [open, productId, validProducts])

  const currentStock = useMemo(() => {
    if (!fromId || !productId) return null
    const inv = inventory.find(i =>
      (i.warehouse_id ?? i.WarehouseID) === fromId &&
      (i.product_id   ?? i.ProductID)   === productId
    )
    return inv ? getAvailableQty(inv) : null
  }, [inventory, fromId, productId])

  const qty = parseInt(quantity, 10)
  const overLimit = !isNaN(qty) && currentStock !== null && qty > currentStock

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!isUUID(fromId) || !isUUID(toId) || !isUUID(productId)) throw new Error('Выберите склады и товар')
      if (fromId === toId)        throw new Error('Склады отправки и назначения должны отличаться')
      if (isNaN(qty) || qty < 1) throw new Error('Количество должно быть ≥ 1')
      if (overLimit)              throw new Error(`Недостаточно товара на складе-источнике (доступно ${currentStock} шт.)`)
      return createTransfer({
        from_warehouse_id: fromId,
        to_warehouse_id:   toId,
        product_id:        productId,
        quantity:          qty,
        reason:            reason.trim() || undefined,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventory })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.movements })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.batchesRoot })
      toast.success('Перемещение выполнено')
      handleClose()
    },
  })

  function handleClose() {
    reset()
    setFromId('')
    setToId('')
    setProductId('')
    setQuantity('')
    setReason('')
    onClose()
  }

  const canSubmit = isUUID(fromId) && isUUID(toId) && isUUID(productId) && quantity && !overLimit
  const errMsg = error?.response?.data?.error?.message ?? error?.message
  const warehouseOptions = validWarehouses.map(w => ({ value: getId(w), label: getWarehouseName(w) }))

  const isSingleWarehouse = validWarehouses.length < 2

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Перемещение между складами"
      description="Перенести товар с одного склада на другой"
      footer={
        isSingleWarehouse ? (
          <Button variant="secondary" onClick={handleClose}>Закрыть</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
            <Button variant="primary" onClick={() => canSubmit && mutate()} loading={isPending} disabled={!canSubmit}>
              Переместить
            </Button>
          </>
        )
      }
    >
      {isSingleWarehouse ? (
        <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
          <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center">
            <ArrowLeftRight size={20} className="text-slate-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">Требуется минимум 2 склада</p>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">
              Перемещения возможны только при наличии нескольких складов в системе.
            </p>
          </div>
        </div>
      ) : (
        <>
          {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}

          <div className="space-y-4">
            <SelectField
              label="Откуда (склад-источник) *"
              value={fromId}
              onChange={v => { setFromId(v); setProductId(''); setQuantity('') }}
              placeholder="Выберите склад…"
              options={warehouseOptions}
            />
            <SelectField
              label="Куда (склад-назначение) *"
              value={toId}
              onChange={v => { if (v !== fromId) setToId(v) }}
              placeholder="Выберите склад…"
              options={warehouseOptions.filter(o => o.value !== fromId)}
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
                <span className="font-medium">Доступно на складе-источнике:</span>
                <span className="font-bold tabular-nums">{currentStock} шт.</span>
              </div>
            )}

            <div>
              <label className="input-label">Количество *</label>
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

            <div>
              <label className="input-label">Комментарий (необязательно)</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="input resize-none mt-1"
                rows={2}
                placeholder="Причина перемещения…"
              />
            </div>
          </div>
        </>
      )}
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
