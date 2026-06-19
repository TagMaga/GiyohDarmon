import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal  from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert  from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { cancelOrder } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { getOrderId, formatOrderLabel } from '../utils/orderHelpers'

const REASONS = [
  'Клиент отказался',
  'Неверный адрес',
  'Нет в наличии',
  'Дублирующий заказ',
  'Другое',
]

export default function CancelModal({ open, onClose, order }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [reason, setReason] = useState('')
  const [custom, setCustom] = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      const orderId = getOrderId(order)
      if (!orderId) throw new Error('ID заказа не найден')
      return cancelOrder(orderId, { reason: reason === 'Другое' ? custom : reason })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.newOrders })
      toast.success('Заказ отменён')
      handleClose()
    },
  })

  function handleClose() {
    reset()
    setReason('')
    setCustom('')
    onClose()
  }

  const finalReason = reason === 'Другое' ? custom : reason
  const errMsg = error?.response?.data?.error?.message ?? error?.message

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Отменить заказ"
      description={order ? `Заказ ${formatOrderLabel(order)}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            Не отменять
          </Button>
          <Button
            variant="danger"
            onClick={() => finalReason.trim() && mutate()}
            loading={isPending}
            disabled={!finalReason.trim()}
          >
            Отменить заказ
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}

      <div className="space-y-4">
        <Alert variant="warning">
          Отмена заказа необратима. Инвентарь будет освобождён.
        </Alert>

        <div>
          <label className="input-label">Причина отмены *</label>
          <div className="space-y-2">
            {REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="cancel-reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="accent-indigo-600"
                />
                <span className="text-sm text-slate-700">{r}</span>
              </label>
            ))}
          </div>
        </div>

        {reason === 'Другое' && (
          <div>
            <label className="input-label">Уточните причину *</label>
            <textarea
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="input resize-none"
              rows={2}
              placeholder="Введите причину…"
              autoFocus
            />
          </div>
        )}
      </div>
    </Modal>
  )
}
