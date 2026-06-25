import { useState, useEffect, useMemo } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useToast } from '../../../shared/components/ToastProvider'
import { confirmOrder } from '../api'
import { getOrderId } from '../utils/orderHelpers'
import { useDispatcherBoard } from '../hooks/useDispatcherBoard'

import DispatcherKPIs        from '../components/v2/DispatcherKPIs'
import DispatcherOrderList   from '../components/v2/DispatcherOrderList'
import DispatcherOrderPanel  from '../components/v2/DispatcherOrderPanel'

import AssignCourierModal    from '../components/AssignCourierModal'
import UnassignModal         from '../components/UnassignModal'
import ScheduleModal         from '../components/ScheduleModal'
import IssueModal            from '../components/IssueModal'
import CancelModal           from '../components/CancelModal'
import CommentsDrawer        from '../components/CommentsDrawer'
import RejectPrepaymentModal from '../components/RejectPrepaymentModal'
import CreateOfficeOrderModal from '../components/CreateOfficeOrderModal'

export default function DispatcherPage() {
  const toast = useToast()
  const { allOrders, courierMap, isLoading, invalidateAll, counts, cashOwed } = useDispatcherBoard()

  // Track selected order by ID so it auto-refreshes when allOrders updates
  const [selectedId, setSelectedId]   = useState(null)
  const [modal, setModal]             = useState(null)
  const [activeOrder, setActiveOrder] = useState(null)
  const [createOpen, setCreateOpen]   = useState(false)

  const selectedOrder = useMemo(
    () => allOrders.find(o => getOrderId(o) === selectedId) ?? null,
    [allOrders, selectedId],
  )

  function selectOrder(order) {
    setSelectedId(getOrderId(order))
  }

  function closeModal() {
    setModal(null)
    setActiveOrder(null)
  }

  function handleAction(key, order) {
    setActiveOrder(order)
    setModal(key)
  }

  // Quick-confirm from card (no modal needed)
  const { mutate: doConfirm } = useMutation({
    mutationFn: (order) => confirmOrder(getOrderId(order)),
    onSuccess: () => { invalidateAll(); toast.success('Заказ подтверждён') },
    onError:   (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
  })

  function handleCardAction(key, order) {
    if (key === 'confirm') {
      doConfirm(order)
    } else {
      handleAction(key, order)
    }
  }

  // Keyboard navigation
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        setSelectedId(null)
        return
      }
      if (!['ArrowUp', 'ArrowDown'].includes(e.key) || !allOrders.length) return
      // Only handle when not focused on an input/textarea
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
      e.preventDefault()
      const idx  = allOrders.findIndex(o => getOrderId(o) === selectedId)
      const next = e.key === 'ArrowUp'
        ? Math.max(0, idx - 1)
        : Math.min(allOrders.length - 1, idx === -1 ? 0 : idx + 1)
      setSelectedId(getOrderId(allOrders[next]))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allOrders, selectedId])

  return (
    <div className="flex flex-col bg-white" style={{ height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
      {/* KPI strip */}
      <DispatcherKPIs counts={counts} cashOwed={cashOwed} />

      {/* ── Desktop: left sidebar + right panel ── */}
      <div className="hidden lg:flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-[400px] flex-shrink-0 border-r border-slate-100 flex flex-col overflow-hidden">
          {/* Sidebar header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 flex-shrink-0">
            <h2 className="text-sm font-bold text-slate-800 flex-1">Заказы</h2>
            <span className="text-xs text-slate-400 font-semibold">{counts.all}</span>
            <button
              onClick={invalidateAll}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
              title="Обновить"
            >
              <RefreshCw size={13} />
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <Plus size={12} />
              Заказ
            </button>
          </div>

          <DispatcherOrderList
            orders={allOrders}
            courierMap={courierMap}
            counts={counts}
            isLoading={isLoading}
            selectedId={selectedId}
            onSelect={selectOrder}
            onAction={handleCardAction}
          />
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <DispatcherOrderPanel
            order={selectedOrder}
            courierMap={courierMap}
            onClose={() => setSelectedId(null)}
            onAction={handleAction}
          />
        </div>
      </div>

      {/* ── Mobile: full-screen list, panel as overlay ── */}
      <div className="lg:hidden flex-1 overflow-hidden flex flex-col">
        {selectedOrder ? (
          <DispatcherOrderPanel
            order={selectedOrder}
            courierMap={courierMap}
            onClose={() => setSelectedId(null)}
            onAction={handleAction}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 flex-shrink-0">
              <h2 className="text-sm font-bold text-slate-800 flex-1">Заказы</h2>
              <button onClick={invalidateAll} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
                <RefreshCw size={13} />
              </button>
              <button
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white"
              >
                <Plus size={12} />
                Заказ
              </button>
            </div>
            <DispatcherOrderList
              orders={allOrders}
              courierMap={courierMap}
              counts={counts}
              isLoading={isLoading}
              selectedId={selectedId}
              onSelect={selectOrder}
              onAction={handleCardAction}
            />
          </>
        )}
      </div>

      {/* Modals */}
      <CreateOfficeOrderModal open={createOpen}              onClose={() => setCreateOpen(false)} />
      <AssignCourierModal     open={modal === 'assign'}      onClose={closeModal} order={activeOrder} mode="assign" />
      <AssignCourierModal     open={modal === 'reassign'}    onClose={closeModal} order={activeOrder} mode="reassign" />
      <UnassignModal          open={modal === 'unassign'}    onClose={closeModal} order={activeOrder} courierMap={courierMap} />
      <ScheduleModal          open={modal === 'schedule'}    onClose={closeModal} order={activeOrder} />
      <IssueModal             open={modal === 'issue'}       onClose={closeModal} order={activeOrder} mode="mark" />
      <IssueModal             open={modal === 'resolve'}     onClose={closeModal} order={activeOrder} mode="resolve" />
      <CancelModal            open={modal === 'cancel'}      onClose={closeModal} order={activeOrder} />
      <CommentsDrawer         open={modal === 'comments'}    onClose={closeModal} order={activeOrder} />
      <RejectPrepaymentModal  open={modal === 'reject_prepayment'} onClose={closeModal} order={activeOrder} />
    </div>
  )
}
