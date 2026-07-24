import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, Pencil } from 'lucide-react'
import Modal from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import { fetchReceivingHistory, updateProduct, updateReceiving } from '../api'
import { fmtDate, fmtMoney, getId, getMovementType, getProductName, getProductSku, getSalePrice, isUUID } from '../utils/warehouseHelpers'

function receivingNote(reason) {
  const text = (reason ?? '').trim()
  if (!text) return ''
  if (text === 'Приёмка товара') return ''
  if (text.startsWith('Приёмка товара · ')) return text.replace('Приёмка товара · ', '').trim()
  return text
}

function movementNote(movement) {
  if (getMovementType(movement) === 'writeoff') return (movement?.reason ?? movement?.Reason ?? '').trim()
  return receivingNote(movement?.reason ?? movement?.Reason)
}

function fmtQty(v) {
  return Number(v || 0).toLocaleString('ru-RU')
}

function HistoryItem({ edit }) {
  const changes = []
  if (edit.old_product_id !== edit.new_product_id) {
    changes.push(`товар ${edit.old_product_name || edit.old_product_id} -> ${edit.new_product_name || edit.new_product_id}`)
  }
  if (edit.old_quantity !== edit.new_quantity) changes.push(`количество ${fmtQty(edit.old_quantity)} -> ${fmtQty(edit.new_quantity)}`)
  if (Number(edit.old_unit_cost) !== Number(edit.new_unit_cost)) changes.push(`цена ${fmtMoney(edit.old_unit_cost)} -> ${fmtMoney(edit.new_unit_cost)}`)
  if ((edit.old_note ?? '') !== (edit.new_note ?? '')) changes.push(`примечание "${edit.old_note || '-'}" -> "${edit.new_note || '-'}"`)

  return (
    <div className="flex gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100">
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

export default function ReceivingEditModal({ movement, products = [], onClose }) {
  const qc = useQueryClient()
  const toast = useToast()
  const open = Boolean(movement)
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [notes, setNotes] = useState('')
  const movementId = getId(movement)
  const movementType = getMovementType(movement)
  const isWriteoff = movementType === 'writeoff'

  const validProducts = useMemo(
    () => products.filter((p) => isUUID(getId(p))),
    [products]
  )

  useEffect(() => {
    if (!movement) return
    const pid = movement.product_id ?? movement.ProductID ?? ''
    setProductId(pid)
    setQuantity(String(movement.quantity ?? movement.Quantity ?? ''))
    setUnitCost(String(movement.batch_unit_cost ?? ''))
    const product = validProducts.find((p) => getId(p) === pid)
    setSalePrice(product ? String(getSalePrice(product) ?? '') : '')
    setNotes(movementNote(movement))
  }, [movement, validProducts])

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['warehouse', 'receiving-history', movementId],
    queryFn: () => fetchReceivingHistory(movementId),
    enabled: !!movementId,
  })

  const qty = Number.parseInt(quantity, 10)
  const cost = unitCost === '' ? 0 : Number.parseFloat(unitCost)
  const canSubmit = isUUID(productId) && qty > 0 && (isWriteoff || (!Number.isNaN(cost) && cost >= 0))

  const mutation = useMutation({
    mutationFn: async () => {
      const receiving = await updateReceiving(movementId, {
        product_id: productId,
        quantity: qty,
        unit_cost: isWriteoff ? 0 : cost,
        notes: notes.trim() || undefined,
      })
      if (!isWriteoff && salePrice !== '') {
        await updateProduct(productId, { sale_price: Number(salePrice) })
      }
      return receiving
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventory })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.movements })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.batchesRoot })
      qc.invalidateQueries({ queryKey: ['warehouse', 'receiving-history', movementId] })
      if (!isWriteoff && salePrice !== '') qc.invalidateQueries({ queryKey: KEYS.warehouse.products })
      toast.success(isWriteoff ? 'Списание обновлено' : 'Приёмка обновлена')
      onClose()
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
      title={isWriteoff ? 'Редактировать списание' : 'Редактировать приёмку'}
      description="Все изменения сохраняются в историю"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={mutation.isPending}>Отмена</Button>
          <Button variant="primary" icon={<Check size={15} />} onClick={() => canSubmit && mutation.mutate()} loading={mutation.isPending} disabled={!canSubmit}>
            Сохранить
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="input-label">Товар *</span>
          <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={isWriteoff}>
            <option value="">Выберите товар</option>
            {validProducts.map((p) => (
              <option key={getId(p)} value={getId(p)}>{getProductName(p)} ({getProductSku(p)})</option>
            ))}
          </select>
          {isWriteoff && <p className="mt-1 text-[11px] text-slate-400">В списании можно менять количество и комментарий.</p>}
        </label>
        <label>
          <span className="input-label">Количество *</span>
          <input className="input" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </label>
        {!isWriteoff && (
          <label>
            <span className="input-label">Закупочная цена *</span>
            <input className="input" type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </label>
        )}
        {!isWriteoff && (
          <label>
            <span className="input-label">Цена продажи</span>
            <input className="input" type="number" min="0" step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="0.00" />
          </label>
        )}
        <label>
          <span className="input-label">{isWriteoff ? 'Комментарий' : 'Примечание'}</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Необязательно" />
        </label>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <Clock size={13} className="text-slate-400" />
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">История изменений</p>
        </div>
        {historyLoading ? (
          <div className="space-y-2">
            <div className="h-8 rounded-lg bg-slate-100 animate-pulse" />
            <div className="h-8 rounded-lg bg-slate-100 animate-pulse" />
          </div>
        ) : history.length ? (
          <div className="max-h-[190px] overflow-y-auto">
            {history.map((edit) => <HistoryItem key={edit.id} edit={edit} />)}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Изменений ещё не было</p>
        )}
      </div>
    </Modal>
  )
}
