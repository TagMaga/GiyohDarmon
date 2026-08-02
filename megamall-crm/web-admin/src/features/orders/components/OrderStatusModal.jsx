/**
 * OrderStatusModal — owner-only "change to any status" override.
 * Mirrors the dispatcher ForceStatusModal, wired to the owner Orders feature
 * (query keys, status labels, order id/label helpers).
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal  from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert  from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { forceOrderStatus } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { STATUS_LABELS } from '../../../shared/orderStatusConfig'
import { getOrderId, formatOrderLabel } from '../../dispatcher/utils/orderHelpers'

// All statuses are offered — as owner this is meant to freely move an order
// to any status, including reopening a terminal one (delivered / cancelled /
// returned). The backend re-validates and guards financial/inventory side
// effects against double-firing.
const ALL_STATUSES = ['new', 'confirmed', 'assigned', 'in_delivery', 'delivered', 'issue', 'returned', 'cancelled']

export default function OrderStatusModal({ open, onClose, order }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [status, setStatus] = useState('')
  const [reason, setReason] = useState('')

  const currentStatus = order?.status ?? order?.Status ?? ''

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      const orderId = getOrderId(order)
      if (!orderId) throw new Error('ID заказа не найден')
      return forceOrderStatus(orderId, { status, reason: reason.trim() })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      const orderId = getOrderId(order)
      if (orderId) {
        qc.invalidateQueries({ queryKey: KEYS.orders.detail(orderId) })
      }
      toast.success('Статус изменён')
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
  const canSubmit = !!status && status !== currentStatus && reason.trim().length >= 3

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Изменить статус заказа"
      description={order ? `Заказ ${formatOrderLabel(order)} · сейчас: ${STATUS_LABELS[currentStatus] ?? currentStatus}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            Отмена
          </Button>
          <Button
            variant="primary"
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
          Как владелец вы можете установить любой статус, в обход обычной цепочки переходов.
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
              <option key={s} value={s} disabled={s === currentStatus}>
                {STATUS_LABELS[s] ?? s}{s === currentStatus ? ' (текущий)' : ''}
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
            placeholder="Почему нужно изменить статус…"
            autoFocus
          />
        </div>
      </div>
    </Modal>
  )
}
