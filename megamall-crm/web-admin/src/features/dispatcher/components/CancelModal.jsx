import { useState } from 'react'
import Modal  from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert  from '../../../shared/components/Alert'
import { getOrderId, formatOrderLabel } from '../utils/orderHelpers'

const REASONS = [
  'Клиент отказался',
  'Неверный адрес',
  'Нет в наличии',
  'Дублирующий заказ',
  'Другое',
]

/**
 * CancelModal — collects a reason, then hands the order id(s) + reason to
 * `onSchedule` and closes immediately. The actual cancelOrder API call is
 * deferred by the caller (see DispatcherBoardV3.scheduleCancel) behind a
 * short undo window — nothing is sent to the backend from this component.
 *
 * Pass `orders` (array) instead of `order` for a bulk cancel — the same
 * reason is applied to every order in the array.
 */
export default function CancelModal({ open, onClose, order, orders, onSchedule }) {
  const [reason, setReason] = useState('')
  const [custom, setCustom] = useState('')

  const targets = Array.isArray(orders) && orders.length > 0 ? orders : (order ? [order] : [])
  const finalReason = reason === 'Другое' ? custom : reason

  function handleClose() {
    setReason('')
    setCustom('')
    onClose()
  }

  function submit() {
    const ids = targets.map(getOrderId).filter(Boolean)
    if (!ids.length || !finalReason.trim()) return
    onSchedule(ids, finalReason.trim())
    handleClose()
  }

  const isBulk = targets.length > 1

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isBulk ? `Отменить заказы (${targets.length})` : 'Отменить заказ'}
      description={!isBulk && targets[0] ? `Заказ ${formatOrderLabel(targets[0])}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Не отменять
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            disabled={!finalReason.trim() || targets.length === 0}
          >
            {isBulk ? `Отменить ${targets.length} заказов` : 'Отменить заказ'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert variant="warning">
          Отмена произойдёт через несколько секунд — в уведомлении будет кнопка
          «Отменить действие», пока это ещё возможно. Инвентарь будет освобождён.
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
