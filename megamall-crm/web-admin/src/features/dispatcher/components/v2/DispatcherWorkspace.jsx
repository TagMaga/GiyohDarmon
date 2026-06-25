import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Package } from 'lucide-react'
import Badge from '../../../../shared/components/Badge'
import { STATUS_BADGE, STATUS_LABELS, fmtDate } from '../../../../shared/orderStatusConfig'
import { fetchOrderDetail, fetchComments } from '../../api'
import { KEYS } from '../../../../shared/queryKeys'
import { formatOrderLabel, getOrderId } from '../../utils/orderHelpers'
import DispatcherOverviewTab  from './DispatcherOverviewTab'
import DispatcherTimelineTab  from './DispatcherTimelineTab'
import DispatcherActionMenu   from './DispatcherActionMenu'

const TABS = [
  { key: 'overview',  label: 'Обзор'   },
  { key: 'timeline',  label: 'История' },
]

export default function DispatcherWorkspace({ order, courierMap = {}, onClose, onAction }) {
  const [tab, setTab] = useState('overview')
  const orderId = getOrderId(order)

  // Reset to overview whenever a different order is selected
  useEffect(() => { setTab('overview') }, [orderId])

  const { data: fullOrder, isLoading: loadingOrder } = useQuery({
    queryKey: KEYS.dispatcher.orderDetail(orderId),
    queryFn:  () => fetchOrderDetail(orderId),
    enabled:  !!orderId,
    staleTime: 30_000,
  })

  const { data: comments } = useQuery({
    queryKey: KEYS.dispatcher.comments(orderId),
    queryFn:  () => fetchComments(orderId),
    enabled:  !!orderId,
    staleTime: 30_000,
  })

  /* ── Empty state ─────────────────────────────────────────────── */
  if (!order) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-300 p-8">
        <div className="w-20 h-20 rounded-3xl bg-slate-50 flex items-center justify-center">
          <Package size={36} strokeWidth={1} className="text-slate-300" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-500">Выберите заказ</p>
          <p className="text-xs text-slate-400 mt-1">Нажмите на заказ в списке слева</p>
        </div>
      </div>
    )
  }

  const o           = fullOrder ?? order
  const statusVar   = STATUS_BADGE[o.status] ?? 'slate'
  const commentList = Array.isArray(comments) ? comments : []

  return (
    <div className="flex flex-col h-full bg-white animate-slide-in">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 flex-shrink-0">
        <span className="text-sm font-mono font-bold text-slate-700">
          #{formatOrderLabel(o)}
        </span>
        <Badge variant={statusVar} size="sm">{STATUS_LABELS[o.status] ?? o.status}</Badge>
        <span className="text-xs text-slate-400">{fmtDate(o.created_at)}</span>
        <div className="flex-1" />
        <DispatcherActionMenu order={o} onAction={onAction} />
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors ml-1"
          title="Закрыть"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────── */}
      <div className="flex border-b border-slate-100 flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-5 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
              tab === t.key
                ? 'border-indigo-500 text-indigo-700'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t.label}
            {t.key === 'timeline' && commentList.length > 0 && (
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                {commentList.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────── */}
      {tab === 'overview' && (
        <DispatcherOverviewTab
          order={o}
          courierMap={courierMap}
          comments={commentList}
          onAction={onAction}
          loading={loadingOrder && !fullOrder}
        />
      )}
      {tab === 'timeline' && (
        <DispatcherTimelineTab orderId={orderId} />
      )}
    </div>
  )
}
