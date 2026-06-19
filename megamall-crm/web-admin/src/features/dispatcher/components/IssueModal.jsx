import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal  from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert  from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { markIssue, resolveIssue } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { getOrderId, formatOrderLabel } from '../utils/orderHelpers'

/**
 * IssueModal — mark issue or resolve issue.
 *
 * Props:
 *   mode {string} — 'mark' | 'resolve'
 */
export default function IssueModal({ open, onClose, order, mode = 'mark' }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [comment,   setComment]  = useState('')
  const [toStatus,  setToStatus] = useState('assigned')

  const isResolve = mode === 'resolve'
  const title     = isResolve ? 'Решить проблему' : 'Отметить проблему'

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      const orderId = getOrderId(order)
      if (!orderId) throw new Error('ID заказа не найден')
      return isResolve
        ? resolveIssue(orderId, { to_status: toStatus, comment })
        : markIssue(orderId,    { comment })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.newOrders })
      toast.success(isResolve ? 'Проблема решена' : 'Проблема отмечена')
      handleClose()
    },
  })

  function handleClose() {
    reset()
    setComment('')
    setToStatus('assigned')
    onClose()
  }

  const errMsg = error?.response?.data?.error?.message ?? error?.message

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      description={order ? `Заказ ${formatOrderLabel(order)}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            Отмена
          </Button>
          <Button
            variant={isResolve ? 'primary' : 'danger'}
            onClick={() => comment.trim() && mutate()}
            loading={isPending}
            disabled={!comment.trim()}
          >
            {isResolve ? 'Решить' : 'Отметить проблему'}
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}

      <div className="space-y-4">
        {isResolve && (
          <div>
            <label className="input-label">Перевести в статус</label>
            <select
              value={toStatus}
              onChange={(e) => setToStatus(e.target.value)}
              className="input"
            >
              <option value="assigned">Назначен</option>
              <option value="confirmed">Подтверждён</option>
            </select>
          </div>
        )}
        <div>
          <label className="input-label">
            {isResolve ? 'Комментарий *' : 'Описание проблемы *'}
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="input resize-none"
            rows={3}
            placeholder={isResolve ? 'Как решена проблема…' : 'Что случилось…'}
            required
            autoFocus
          />
          {!comment.trim() && (
            <p className="text-xs text-slate-400 mt-1">Обязательное поле</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
