import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal  from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert  from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { forceOrderStatus } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { getOrderId, formatOrderLabel } from '../utils/orderHelpers'
import { STATUS_LABELS } from '../statusConfig'

// All statuses are offered — every status is restorable by design (see
// orders.allowedTransitions), including moving a delivered/cancelled/returned
// order back into active delivery. The backend re-validates and guards
// financial/inventory side effects against double-firing; this modal only
// enforces "pick something else" and "explain why".
const ALL_STATUSES = ['new', 'confirmed', 'assigned', 'in_delivery', 'delivered', 'returned', 'cancelled']

export default function ForceStatusModal({ open, onClose, order }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [status, setStatus] = useState('')
  const [reason, setReason] = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      const orderId = getOrderId(order)
      if (!orderId) throw new Error('ID заказа не найден')
      return forceOrderStatus(orderId, { status, reason: reason.trim() })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatcher'] })
      const orderId = getOrderId(order)
      if (orderId) {
        qc.invalidateQueries({ queryKey: KEYS.dispatcher.orderDetail(orderId) })
        qc.invalidateQueries({ queryKey: KEYS.dispatcher.timeline(orderId) })
      }
      toast.success('Статус изменён вручную')
      handleClose()
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  function handleClose() {
    reset()
    setStatus('')
    setReason('')
    onClose()
  }

  const errMsg = error?.response?.data?.error?.message ?? error?.message
  const canSubmit = !!status && status !== order?.status && reason.trim().length >= 3

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Изменить статус вручную"
      description={order ? `Заказ ${formatOrderLabel(order)} · сейчас: ${STATUS_LABELS[order.status] ?? order.status}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={() => canSubmit && mutate()}
            loading={isPending}
            disabled={!canSubmit}
          >
            Применить
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}

      <div className="space-y-4">
        <Alert variant="warning">
          Это принудительное изменение статуса в обход обычных правил перехода.
          Используйте только для исправления зависших или повреждённых заказов.
          Действие фиксируется в истории заказа с указанной причиной.
        </Alert>

        <div>
          <label className="input-label">Новый статус *</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="input"
          >
            <option value="">Выберите статус…</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s} disabled={s === order?.status}>
                {STATUS_LABELS[s] ?? s}{s === order?.status ? ' (текущий)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="input-label">Причина *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input resize-none"
            rows={3}
            placeholder="Почему нужно изменить статус вручную…"
            autoFocus
          />
        </div>
      </div>
    </Modal>
  )
}
