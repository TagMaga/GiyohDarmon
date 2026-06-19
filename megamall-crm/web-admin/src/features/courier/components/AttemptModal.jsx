import { useState }                        from 'react'
import { useMutation, useQueryClient }     from '@tanstack/react-query'
import Modal                               from '../../../shared/components/Modal'
import Button                              from '../../../shared/components/Button'
import Alert                               from '../../../shared/components/Alert'
import { useToast }                        from '../../../shared/components/ToastProvider'
import { addAttempt }                      from '../api'
import { KEYS }                            from '../../../shared/queryKeys'
import { getOrderId, ATTEMPT_RESULTS, formatOrderLabel } from '../utils/courierHelpers'

/**
 * AttemptModal — record a failed delivery attempt.
 *
 * Props:
 *   open    {bool}
 *   onClose {fn}
 *   order   {object}  — raw order
 */
export default function AttemptModal({ open, onClose, order }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [result,  setResult]  = useState('')
  const [comment, setComment] = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      const id = getOrderId(order)
      if (!id) throw new Error('ID заказа не найден')
      return addAttempt(id, { result, comment: comment.trim() || undefined })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.courier.myOrders })
      toast.success('Попытка зафиксирована')
      handleClose()
    },
  })

  function handleClose() {
    reset()
    setResult('')
    setComment('')
    onClose()
  }

  const errMsg = error?.response?.data?.error?.message ?? error?.message

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Попытка доставки"
      description={order ? `Заказ ${formatOrderLabel(order)}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={() => result && mutate()}
            loading={isPending}
            disabled={!result}
          >
            Сохранить
          </Button>
        </>
      }
    >
      {errMsg && (
        <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>
      )}

      <div className="space-y-4">
        <div>
          <label className="input-label">Результат *</label>
          <div className="space-y-2 mt-1">
            {ATTEMPT_RESULTS.map((r) => (
              <label key={r.value} className="flex items-center gap-2.5 cursor-pointer min-h-[40px]">
                <input
                  type="radio"
                  name="attempt-result"
                  value={r.value}
                  checked={result === r.value}
                  onChange={() => setResult(r.value)}
                  className="accent-indigo-600 w-4 h-4 flex-shrink-0"
                />
                <span className="text-sm text-slate-700">{r.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="input-label">Комментарий (необязательно)</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="input resize-none mt-1"
            rows={2}
            placeholder="Уточнения…"
          />
        </div>
      </div>
    </Modal>
  )
}
