import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, User, Phone, MapPin, Package, Send, Loader2 } from 'lucide-react'
import Badge from '../../../../shared/components/Badge'
import Skeleton from '../../../../shared/components/Skeleton'
import { STATUS_BADGE, STATUS_LABELS, fmtDate } from '../../../../shared/orderStatusConfig'
import { STATUS_ACTIONS } from '../../statusConfig'
import { fetchOrderDetail, fetchComments, addComment } from '../../api'
import { KEYS } from '../../../../shared/queryKeys'
import { resolveCustomer, resolveAddress, resolveCity } from '../../utils/resolveCustomer'
import { resolveCourierDisplay, formatOrderLabel, getOrderId } from '../../utils/orderHelpers'
import { useToast } from '../../../../shared/components/ToastProvider'

const fmt = (v) => v == null ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

const TABS = [
  { key: 'details',  label: 'Детали'    },
  { key: 'actions',  label: 'Действия'  },
  { key: 'comments', label: 'Комментарии' },
]

export default function DispatcherOrderPanel({ order, courierMap = {}, onClose, onAction }) {
  const [tab, setTab] = useState('details')
  const orderId = getOrderId(order)

  // Reset to details tab when a different order is selected
  useEffect(() => { setTab('details') }, [orderId])

  const { data: fullOrder, isLoading: loadingOrder } = useQuery({
    queryKey: KEYS.dispatcher.orderDetail(orderId),
    queryFn:  () => fetchOrderDetail(orderId),
    enabled:  !!orderId,
    staleTime: 30_000,
  })

  if (!order) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-300">
        <Package size={48} strokeWidth={1.2} />
        <p className="text-sm font-medium text-slate-400">Выберите заказ из списка</p>
      </div>
    )
  }

  const o           = fullOrder ?? order
  const customer    = resolveCustomer(o, {})
  const address     = resolveAddress(o)
  const city        = resolveCity(o)
  const courier     = resolveCourierDisplay(o, courierMap)
  const statusVariant = STATUS_BADGE[o.status] ?? 'slate'
  // Exclude 'comment' action — handled by the Comments tab
  const actions     = (STATUS_ACTIONS[o.status] ?? []).filter(a => a.key !== 'comment')
  const items       = Array.isArray(o.items) ? o.items : Array.isArray(o.order_items) ? o.order_items : []

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 flex-shrink-0">
        <span className="text-sm font-mono font-bold text-slate-700">#{formatOrderLabel(o)}</span>
        <Badge variant={statusVariant} size="sm">{STATUS_LABELS[o.status] ?? o.status}</Badge>
        <span className="text-xs text-slate-400 ml-1">{fmtDate(o.created_at)}</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
          title="Закрыть"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-100 flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
              tab === t.key
                ? 'border-indigo-500 text-indigo-700'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'details' && (
        <div className="flex-1 overflow-y-auto">
          <DetailsTab
            o={o}
            customer={customer}
            address={address}
            city={city}
            courier={courier}
            items={items}
            loading={loadingOrder && !fullOrder}
          />
        </div>
      )}
      {tab === 'actions' && (
        <div className="flex-1 overflow-y-auto">
          <ActionsTab actions={actions} order={o} onAction={onAction} />
        </div>
      )}
      {tab === 'comments' && (
        <CommentsTab key={orderId} orderId={orderId} />
      )}
    </div>
  )
}

// ── Details tab ──────────────────────────────────────────────────────────────

function DetailsTab({ o, customer, address, city, courier, items, loading }) {
  if (loading) {
    return (
      <div className="p-5 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-lg" />)}
      </div>
    )
  }

  const productTotal  = Number(o.total_amount ?? 0)
  const deliveryFee   = Number(o.delivery_fee ?? 0)
  const totalOrderAmt = Number(o.total_order_amount ?? productTotal + deliveryFee)
  const fullAddress   = [address, city].filter(Boolean).join(', ')
  const comment       = o.notes ?? o.comment ?? o.customer_comment

  return (
    <div className="p-5 space-y-5">
      {/* Customer */}
      <section>
        <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Клиент</h3>
        <div className="space-y-1.5">
          <InfoRow icon={User}   value={customer.full_name || '—'} />
          {customer.phone && (
            <a href={`tel:${customer.phone}`} className="block">
              <InfoRow icon={Phone} value={customer.phone} blue />
            </a>
          )}
          {fullAddress && <InfoRow icon={MapPin} value={fullAddress} />}
          {comment && (
            <div className="mt-1.5 text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2">{comment}</div>
          )}
        </div>
      </section>

      {/* Financials */}
      <section>
        <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Финансы</h3>
        <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-1.5">
          {deliveryFee > 0 && <FinRow label="Доставка" value={`${fmt(deliveryFee)} сом`} />}
          <FinRow label="Итого" value={`${fmt(totalOrderAmt)} сом`} bold />
          {o.payment_method && <FinRow label="Оплата" value={o.payment_method} />}
        </div>
      </section>

      {/* Courier */}
      <section>
        <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Курьер</h3>
        <p className="text-sm text-slate-700 font-semibold">
          {courier.name || <span className="text-slate-400 font-normal">Не назначен</span>}
        </p>
      </section>

      {/* Items */}
      {items.length > 0 && (
        <section>
          <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            Товары ({items.length})
          </h3>
          <div className="space-y-1">
            {items.map((item, i) => (
              <div key={item.id ?? i} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 truncate mr-2">
                  {item.product_name ?? item.name ?? `Товар ${i + 1}`}
                </span>
                <span className="text-slate-400 flex-shrink-0">×{item.quantity ?? 1}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function InfoRow({ icon: Icon, value, blue }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={13} className={`flex-shrink-0 ${blue ? 'text-indigo-400' : 'text-slate-400'}`} />
      <span className={`text-sm ${blue ? 'text-indigo-600' : 'text-slate-700'}`}>{value}</span>
    </div>
  )
}

function FinRow({ label, value, bold }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm ${bold ? 'font-bold text-slate-800' : 'text-slate-600'}`}>{value}</span>
    </div>
  )
}

// ── Actions tab ───────────────────────────────────────────────────────────────

function ActionsTab({ actions, order, onAction }) {
  if (actions.length === 0) {
    return (
      <div className="p-10 text-center text-sm text-slate-400">
        Нет доступных действий
      </div>
    )
  }
  return (
    <div className="p-5 space-y-2">
      {actions.map(a => (
        <button
          key={a.key}
          onClick={() => onAction(a.key, order)}
          className={`w-full py-3 px-4 rounded-xl text-sm font-semibold transition-colors ${
            a.variant === 'primary'
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : a.variant === 'danger'
                ? 'bg-rose-600 text-white hover:bg-rose-700'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

// ── Comments tab ──────────────────────────────────────────────────────────────

function CommentsTab({ orderId }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [text, setText] = useState('')

  const { data: comments, isLoading } = useQuery({
    queryKey: KEYS.dispatcher.comments(orderId),
    queryFn:  () => fetchComments(orderId),
    enabled:  !!orderId,
    staleTime: 30_000,
  })

  const { mutate: send, isPending } = useMutation({
    mutationFn: () => addComment(orderId, { comment: text.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.comments(orderId) })
      toast.success('Комментарий добавлен')
      setText('')
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
  })

  const list = Array.isArray(comments) ? comments : []

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">Комментариев нет</div>
        ) : list.map((c, i) => (
          <div key={c.id ?? i} className="bg-slate-50 rounded-xl px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-700">{c.author_name ?? 'Пользователь'}</span>
              <span className="text-[10px] text-slate-400">{fmtDate(c.created_at)}</span>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">{c.comment}</p>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-slate-100 p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && text.trim()) { e.preventDefault(); send() } }}
            placeholder="Написать комментарий…"
            className="flex-1 text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
          />
          <button
            disabled={!text.trim() || isPending}
            onClick={() => text.trim() && send()}
            className="p-2.5 bg-indigo-600 text-white rounded-xl disabled:opacity-40 hover:bg-indigo-700 transition-colors flex-shrink-0"
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
