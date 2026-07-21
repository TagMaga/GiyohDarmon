import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal  from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert  from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { rejectPrepayment } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { getOrderId, formatOrderLabel } from '../utils/orderHelpers'

/**
 * RejectPrepaymentModal — replaces the old window.prompt() flow.
 * Collects a required rejection reason in a consistent in-app dialog.
 */
export default function RejectPrepaymentModal({ open, onClose, order }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      const id = getOrderId(order)
      if (!id) throw new Error('ID заказа не найден')
      return rejectPrepayment(id, { reason: reason.trim() })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.newOrders })
      const id = getOrderId(order)
      if (id) {
        qc.invalidateQueries({ queryKey: KEYS.dispatcher.orderDetail(id) })
        qc.invalidateQueries({ queryKey: KEYS.dispatcher.prepayments(id) })
      }
      toast.success('Предоплата отклонена')
      handleClose()
    },
    onError: (err) =>
      toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  function handleClose() { reset(); setReason(''); onClose() }
  const errMsg = error?.response?.data?.error?.message ?? error?.message

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Отклонить предоплату"
      description={order ? `Заказ ${formatOrderLabel(order)}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={() => reason.trim() && mutate()}
            loading={isPending}
            disabled={!reason.trim()}
          >
            Отклонить
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}

      <div>
        <label className="input-label">Причина отклонения *</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="input resize-none"
          rows={3}
          placeholder="Например: сумма не поступила, неверный чек…"
          autoFocus
        />
        {!reason.trim() && (
          <p className="text-xs text-slate-400 mt-1">Обязательное поле</p>
        )}
      </div>
    </Modal>
  )
}
