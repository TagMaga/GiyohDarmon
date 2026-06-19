import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal  from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert  from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { unassignCourier } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { getOrderId, formatOrderLabel, resolveCourier } from '../utils/orderHelpers'

/**
 * UnassignModal — confirmation dialog for the dispatcher "Снять курьера" action.
 *
 * Releases the courier and returns the order to the confirmed pool (the backend
 * deactivates the assignment + clears courier_id atomically, C1). Requires
 * explicit confirmation because it pulls an order off a courier who may already
 * be en route.
 */
export default function UnassignModal({ open, onClose, order, courierMap = {} }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const courier = resolveCourier(order, courierMap)

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      const orderId = getOrderId(order)
      if (!orderId) throw new Error('ID заказа не найден')
      return unassignCourier(orderId)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers })
      toast.success('Курьер снят — заказ возвращён в «Подтверждённые»')
      handleClose()
    },
    onError: (err) =>
      toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  function handleClose() {
    reset()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Снять курьера"
      description={order ? `Заказ #${formatOrderLabel(order)}` : ''}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button variant="primary" onClick={() => mutate()} loading={isPending}>Снять курьера</Button>
        </>
      }
    >
      {error && <Alert variant="error" className="mb-3">{error?.message ?? 'Ошибка'}</Alert>}
      <p className="text-sm text-slate-600 leading-relaxed">
        {courier?.full_name
          ? <>Курьер <b>{courier.full_name}</b> будет снят с заказа.</>
          : <>Курьер будет снят с заказа.</>}{' '}
        Заказ вернётся в колонку «Подтверждённые» и его можно будет назначить заново.
      </p>
    </Modal>
  )
}
