import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal  from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert  from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { scheduleOrder } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { getOrderId, formatOrderLabel } from '../utils/orderHelpers'
import { appWallClockToDate, appWallClockNow } from '../../../shared/utils/date'

/**
 * ScheduleModal — set scheduled_at for an order.
 */
export default function ScheduleModal({ open, onClose, order }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [scheduledAt, setScheduledAt] = useState('')
  const [comment,     setComment]     = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      const orderId = getOrderId(order)
      if (!orderId) throw new Error('ID заказа не найден')
      // The datetime-local value is a bare wall clock ("2026-08-05T14:00").
      // Anchor it to Asia/Dushanbe — `new Date(...)` on it would resolve
      // against the browser's timezone, so a browser on UTC stored the time
      // 5h early and it read back as 19:00 for a 14:00 pick.
      const at = appWallClockToDate(scheduledAt)
      if (!at) throw new Error('Некорректная дата')
      return scheduleOrder(orderId, {
        scheduled_at: at.toISOString(),
        comment,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.newOrders })
      const orderId = getOrderId(order)
      if (orderId) {
        qc.invalidateQueries({ queryKey: KEYS.dispatcher.orderDetail(orderId) })
        qc.invalidateQueries({ queryKey: KEYS.dispatcher.timeline(orderId) })
      }
      toast.success('Доставка запланирована')
      handleClose()
    },
  })

  function handleClose() {
    reset()
    setScheduledAt('')
    setComment('')
    onClose()
  }

  const errMsg = error?.response?.data?.error?.message ?? error?.message

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Запланировать доставку"
      description={order ? `Заказ ${formatOrderLabel(order)}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={() => scheduledAt && mutate()}
            loading={isPending}
            disabled={!scheduledAt}
          >
            Запланировать
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}

      <div className="space-y-4">
        <div>
          <label className="input-label">Дата и время доставки *</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="input"
            required
            min={appWallClockNow()}
          />
        </div>
        <div>
          <label className="input-label">Комментарий (необязательно)</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="input resize-none"
            rows={2}
            placeholder="Причина переноса или уточнение…"
          />
        </div>
      </div>
    </Modal>
  )
}
