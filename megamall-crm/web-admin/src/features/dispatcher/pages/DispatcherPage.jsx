import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Plus, RefreshCw, Users, Wallet } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { useToast } from '../../../shared/components/ToastProvider'
import { confirmOrder, assignCourier, reassignCourier } from '../api'
import { getOrderId, getCourierId } from '../utils/orderHelpers'
import { useDispatcherBoard } from '../hooks/useDispatcherBoard'

import DispatcherKPIs        from '../components/v2/DispatcherKPIs'
import DispatcherOrderList   from '../components/v2/DispatcherOrderList'
import DispatcherWorkspace   from '../components/v2/DispatcherWorkspace'
import DispatcherCourierRail from '../components/v2/DispatcherCourierRail'

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
  const qc = useQueryClient()
  const { allOrders, courierList, courierMap, isLoading, invalidateAll, counts, cashOwed } = useDispatcherBoard()

  const [selectedId,      setSelectedId]      = useState(null)
  const [modal,           setModal]           = useState(null)
  const [activeOrder,     setActiveOrder]     = useState(null)
  const [createOpen,      setCreateOpen]      = useState(false)
  const [filter,          setFilter]          = useState('all')
  const [courierFilter,   setCourierFilter]   = useState(null)
  const [showCourierRail, setShowCourierRail] = useState(true)
  const [pendingCourierId, setPendingCourierId] = useState(null)

  const selectedOrder = useMemo(
    () => allOrders.find(o => getOrderId(o) === selectedId) ?? null,
    [allOrders, selectedId],
  )

  // Current courier of the selected order — auto-highlights in the rail
  const highlightedCourierId = useMemo(
    () => (selectedOrder ? getCourierId(selectedOrder) : null),
    [selectedOrder],
  )

  // Display name of the pending courier for the sticky bar
  const pendingCourierName = useMemo(
    () => (pendingCourierId ? (courierMap[pendingCourierId]?.full_name ?? null) : null),
    [courierMap, pendingCourierId],
  )

  // Clear pending assignment when order changes or closes
  useEffect(() => {
    setPendingCourierId(null)
  }, [selectedId])

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

  function handleFilterClick(f) {
    setFilter(f)
    setCourierFilter(null)
  }

  function handleCourierSelect(id) {
    if (selectedId && id && id !== 'unassigned') {
      // Order is open — target courier for quick assign (toggle)
      setPendingCourierId(prev => prev === id ? null : id)
    } else {
      // No order open — filter the list by courier
      setCourierFilter(id)
      if (id) setFilter('all')
    }
  }

  /* ── Mutations ─────────────────────────────────────────────── */

  const { mutate: doConfirm } = useMutation({
    mutationFn: (order) => confirmOrder(getOrderId(order)),
    onSuccess: () => { invalidateAll(); toast.success('Заказ подтверждён') },
    onError:   (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
  })

  const { mutate: doAssign, isPending: isAssigning } = useMutation({
    mutationFn: ({ orderId, courierId }) => assignCourier(orderId, { courier_id: courierId }),
    onSuccess: (_, { orderId }) => {
      invalidateAll()
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.orderDetail(orderId) })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.timeline(orderId) })
      setPendingCourierId(null)
      toast.success('Курьер назначен')
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка назначения'),
  })

  const { mutate: doReassign, isPending: isReassigning } = useMutation({
    mutationFn: ({ orderId, courierId }) => reassignCourier(orderId, { courier_id: courierId }),
    onSuccess: (_, { orderId }) => {
      invalidateAll()
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.orderDetail(orderId) })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.timeline(orderId) })
      setPendingCourierId(null)
      toast.success('Курьер переназначен')
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка переназначения'),
  })

  const isMutating = isAssigning || isReassigning

  /* ── Card-level inline actions (from ••• menu or sticky bar) ── */

  function handleCardAction(key, order) {
    if (key === 'confirm') {
      doConfirm(order)
    } else {
      handleAction(key, order)
    }
  }

  /* ── Workspace sticky bar inline actions ─────────────────────── */

  function handleInlineAction(key, data) {
    const orderId = getOrderId(selectedOrder)
    switch (key) {
      case 'confirm':
        doConfirm(selectedOrder)
        break
      case 'quick_assign':
        doAssign({ orderId, courierId: data?.courierId ?? pendingCourierId })
        break
      case 'quick_reassign':
        doReassign({ orderId, courierId: data?.courierId ?? pendingCourierId })
        break
      case 'cancel_pending':
        setPendingCourierId(null)
        break
      default:
        handleAction(key, selectedOrder)
    }
  }

  /* ── Keyboard navigation ─────────────────────────────────────── */

  useEffect(() => {
    function onKey(e) {
      const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)

      // Escape: clear pending first, then close workspace
      if (e.key === 'Escape') {
        if (pendingCourierId) { setPendingCourierId(null); return }
        setSelectedId(null)
        return
      }

      // Enter: trigger primary action on selected order
      if (e.key === 'Enter' && selectedOrder && !isInput) {
        e.preventDefault()
        const status = selectedOrder.status
        const orderId = getOrderId(selectedOrder)
        if (pendingCourierId) {
          const reassignable = ['assigned', 'in_delivery', 'issue'].includes(status)
          if (reassignable)            doReassign({ orderId, courierId: pendingCourierId })
          else if (status === 'confirmed') doAssign({ orderId, courierId: pendingCourierId })
        } else if (status === 'new') {
          doConfirm(selectedOrder)
        }
        return
      }

      // Cmd/Ctrl+K: focus search input
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        document.querySelector('[data-search-input]')?.focus()
        return
      }

      // Arrow navigation through order list
      if (!['ArrowUp', 'ArrowDown'].includes(e.key) || !allOrders.length) return
      if (isInput) return
      e.preventDefault()
      const idx  = allOrders.findIndex(o => getOrderId(o) === selectedId)
      const next = e.key === 'ArrowUp'
        ? Math.max(0, idx - 1)
        : Math.min(allOrders.length - 1, idx === -1 ? 0 : idx + 1)
      setSelectedId(getOrderId(allOrders[next]))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allOrders, selectedId, selectedOrder, pendingCourierId])

  /* ── Prop bundles ───────────────────────────────────────────── */

  const listProps = {
    orders: allOrders,
    courierMap,
    counts,
    isLoading,
    selectedId,
    onSelect: selectOrder,
    onAction: handleCardAction,
    filter,
    onFilterChange: handleFilterClick,
    courierFilter,
  }

  const workspaceProps = {
    order: selectedOrder,
    courierMap,
    onClose: () => setSelectedId(null),
    onAction: handleAction,
    pendingCourierId,
    pendingCourierName,
    onInlineAction: handleInlineAction,
    isPendingMutation: isMutating,
  }

  return (
    <div className="flex flex-col bg-white" style={{ height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
      {/* KPI strip */}
      <DispatcherKPIs
        counts={counts}
        cashOwed={cashOwed}
        activeFilter={filter}
        onFilterClick={handleFilterClick}
      />

      {/* ── Desktop: 3-panel layout ── */}
      <div className="hidden lg:flex flex-1 overflow-hidden">
        {/* Left: order list */}
        <div className="w-[400px] flex-shrink-0 border-r border-slate-100 flex flex-col overflow-hidden">
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
              onClick={() => setShowCourierRail(v => !v)}
              className={`p-1.5 rounded-lg transition-colors ${
                showCourierRail ? 'bg-indigo-50 text-indigo-500' : 'hover:bg-slate-100 text-slate-400'
              }`}
              title={showCourierRail ? 'Скрыть курьеров' : 'Показать курьеров'}
            >
              <Users size={13} />
            </button>
            <Link
              to="/dispatcher/cash"
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
              title="Касса"
            >
              <Wallet size={13} />
            </Link>
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <Plus size={12} />
              Заказ
            </button>
          </div>
          <DispatcherOrderList {...listProps} />
        </div>

        {/* Center: workspace */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <DispatcherWorkspace {...workspaceProps} />
        </div>

        {/* Right: courier rail */}
        {showCourierRail && (
          <DispatcherCourierRail
            couriers={courierList}
            selectedCourier={courierFilter}
            onSelect={handleCourierSelect}
            onCollapse={() => setShowCourierRail(false)}
            highlightCourierId={highlightedCourierId}
            pendingCourierId={pendingCourierId}
          />
        )}
      </div>

      {/* ── Mobile: full-screen list or workspace ── */}
      <div className="lg:hidden flex-1 overflow-hidden flex flex-col">
        {selectedOrder ? (
          <DispatcherWorkspace {...workspaceProps} />
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
            <DispatcherOrderList {...listProps} />
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
