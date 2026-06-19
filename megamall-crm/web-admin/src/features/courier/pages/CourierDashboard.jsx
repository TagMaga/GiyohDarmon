import { useState, useMemo, useCallback } from 'react'
import { useMutation, useQueryClient }    from '@tanstack/react-query'
import { useToast }                       from '../../../shared/components/ToastProvider'
import { KEYS }                           from '../../../shared/queryKeys'

import CourierBottomTabbar from '../components/CourierBottomTabbar'
import CourierHomeView     from '../components/CourierHomeView'
import CourierOrdersView   from '../components/CourierOrdersView'
import CourierMarketView   from '../components/CourierMarketView'
import CourierCashView     from '../components/CourierCashView'
import OrderDetailOverlay  from '../components/OrderDetailOverlay'
import AttemptModal        from '../components/AttemptModal'
import HandoverSheet       from '../components/HandoverSheet'

import useMyOrders        from '../hooks/useMyOrders'
import useAvailableOrders from '../hooks/useAvailableOrders'
import useCashSummary     from '../hooks/useCashSummary'
import useCourierMe       from '../hooks/useCourierMe'

import {
  claimOrder, startDelivery, markDelivered,
  markReturned, markIssue,
} from '../api'
import { getOrderId, getStatus } from '../utils/courierHelpers'

export default function CourierDashboard() {
  const qc    = useQueryClient()
  const toast = useToast()

  const [tab,          setTab]          = useState('home')
  const [detailOrder,  setDetailOrder]  = useState(null)
  const [attemptOrder, setAttemptOrder] = useState(null)
  const [showHandover, setShowHandover] = useState(false)
  const [pendingId,    setPendingId]    = useState(null)

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: courierMe } = useCourierMe()
  const orderIntakeEnabled = courierMe?.order_intake_enabled !== false
  const { data: myOrders = []        } = useMyOrders()
  const { data: availOrders = [],
          isPending: availLoading     } = useAvailableOrders({ enabled: tab === 'market' && orderIntakeEnabled })
  const { data: cashSummary,
          isPending: cashLoading      } = useCashSummary()

  // ── Badge counts ──────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    assigned:    myOrders.filter(o => getStatus(o) === 'assigned').length,
    in_delivery: myOrders.filter(o => getStatus(o) === 'in_delivery').length,
    available:   availOrders.length,
  }), [myOrders, availOrders])

  // ── Mutations ─────────────────────────────────────────────────────────────
  function invalidate() {
    qc.invalidateQueries({ queryKey: KEYS.courier.myOrders })
    qc.invalidateQueries({ queryKey: KEYS.courier.available })
  }

  function makeMut(fn, successMsg) {
    return useMutation({
      mutationFn: (order) => {
        const id = getOrderId(order)
        if (!id) throw new Error('ID заказа не найден')
        return fn(id)
      },
      onMutate:  (order) => setPendingId(getOrderId(order)),
      onSettled: ()      => setPendingId(null),
      onSuccess: ()      => { invalidate(); toast.success(successMsg) },
      onError:   (e)     => toast.error(e?.response?.data?.error?.message ?? e?.message ?? 'Ошибка'),
    })
  }

  const { mutate: doClaim     } = makeMut(claimOrder,    'Заказ взят')
  const { mutate: doStart     } = makeMut(startDelivery, 'Доставка начата')
  const { mutate: doDelivered } = makeMut(markDelivered, 'Заказ доставлен')
  const { mutate: doReturned  } = makeMut(markReturned,  'Возврат оформлен')
  const { mutate: doIssue     } = makeMut(markIssue,     'Проблема зафиксирована')

  const handleAction = useCallback((action, order) => {
    if (action === 'claim')     return doClaim(order)
    if (action === 'start')     return doStart(order)
    if (action === 'delivered') return doDelivered(order)
    if (action === 'returned')  return doReturned(order)
    if (action === 'issue')     return doIssue(order)
    if (action === 'attempt')   return setAttemptOrder(order)
  }, [doClaim, doStart, doDelivered, doReturned, doIssue])

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100%', background: 'transparent' }}>
      <style>{`
        .courier-view { display: none }
        .courier-view.active { display: block }
      `}</style>

      {/* Scrollable content area — pad bottom for fixed tabbar */}
      <div style={{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom))', maxWidth: 560, margin: '0 auto' }}>

        <div className={`courier-view${tab === 'home'   ? ' active' : ''}`}>
          <CourierHomeView
            myOrders={myOrders}
            cashSummary={cashSummary}
            onOrderClick={setDetailOrder}
            onTabChange={setTab}
          />
        </div>

        <div className={`courier-view${tab === 'orders' ? ' active' : ''}`}>
          <CourierOrdersView
            orders={myOrders}
            loading={false}
            onAction={handleAction}
            onOrderClick={setDetailOrder}
            pendingId={pendingId}
          />
        </div>

        <div className={`courier-view${tab === 'market' ? ' active' : ''}`}>
          <CourierMarketView
            orders={availOrders}
            loading={orderIntakeEnabled && availLoading}
            intakeDisabled={!orderIntakeEnabled}
            onClaim={order => handleAction('claim', order)}
            pendingId={pendingId}
          />
        </div>

        <div className={`courier-view${tab === 'cash'   ? ' active' : ''}`}>
          <CourierCashView
            summary={cashSummary}
            loading={cashLoading}
            onHandover={() => setShowHandover(true)}
          />
        </div>
      </div>

      {/* Fixed bottom tabbar */}
      <CourierBottomTabbar active={tab} onChange={setTab} counts={counts} />

      {/* Full-screen order detail overlay */}
      {detailOrder && (
        <OrderDetailOverlay
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          onAction={handleAction}
          pendingId={pendingId}
        />
      )}

      {/* Attempt modal */}
      <AttemptModal
        open={!!attemptOrder}
        onClose={() => setAttemptOrder(null)}
        order={attemptOrder}
      />

      {/* Cash handover bottom sheet */}
      <HandoverSheet
        open={showHandover}
        onClose={() => setShowHandover(false)}
        summary={cashSummary}
      />
    </div>
  )
}
