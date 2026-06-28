import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { X, Send, Package, MessageCircle, Clock, Phone, ExternalLink, Pencil, User } from 'lucide-react'
import Badge from '../../../shared/components/Badge'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { useOrderComments, useAddOrderComment } from '../hooks/useOrderComments'
import { roleLabel } from '../../orders/components/OrderCommentsPanel'
import { fetchOrderTimeline } from '../../dispatcher/api'
import { KEYS } from '../../../shared/queryKeys'

const EDITABLE_STATUSES = new Set(['new', 'confirmed', 'assigned'])

const ROLE_BADGE = {
  seller:     { label: 'Продавец',    color: '#7C3AED', bg: '#F5F3FF' },
  dispatcher: { label: 'Диспетчер',   color: '#2563EB', bg: '#EFF6FF' },
  courier:    { label: 'Курьер',       color: '#059669', bg: '#ECFDF5' },
}

const TIMELINE_STEPS = [
  { status: 'new',                 label: 'Создан',              role: 'seller' },
  { status: 'confirmed',           label: 'Подтверждён',         role: 'dispatcher' },
  { status: 'prepayment_pending',  label: 'Ожидает предоплату',  role: 'dispatcher' },
  { status: 'prepayment_received', label: 'Предоплата получена', role: 'dispatcher' },
  { status: 'assigned',            label: 'Назначен курьер',     role: 'dispatcher' },
  { status: 'in_delivery',         label: 'В доставке',          role: 'courier' },
  { status: 'delivered',           label: 'Доставлен',           role: 'courier' },
]

const STATUS_ORDER = TIMELINE_STEPS.map(s => s.status)

export default function OrderDetailBottomSheet({ order, onClose, citiesById = {}, editBasePath = '/seller/orders', allowEdit = true }) {
  const navigate = useNavigate()
  const sheetRef = useRef(null)
  const [comment, setComment] = useState('')
  const [activeTab, setActiveTab] = useState('info')

  const { data: comments = [], isLoading: commentsLoading } = useOrderComments(order?.id)
  const addComment = useAddOrderComment(order?.id)
  const { data: timelineEvents = [] } = useQuery({
    queryKey: KEYS.dispatcher.timeline(order?.id),
    queryFn: () => fetchOrderTimeline(order?.id),
    enabled: !!order?.id,
  })

  useEffect(() => {
    if (order) {
      document.body.style.overflow = 'hidden'
      setActiveTab('info')
    }
    return () => { document.body.style.overflow = '' }
  }, [order])

  if (!order) return null

  const currentIdx = STATUS_ORDER.indexOf(order.status)
  const isTerminal = ['delivered', 'returned', 'cancelled'].includes(order.status)
  const phone = order.customer?.phone
  const canEdit = allowEdit && EDITABLE_STATUSES.has(order.status)

  function handleSend() {
    const text = comment.trim()
    if (!text || addComment.isPending) return
    addComment.mutate(text, { onSuccess: () => setComment('') })
  }

  const waHref = phone
    ? `https://wa.me/${phone.replace(/\D/g, '')}`
    : null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-white max-h-[92vh]"
        style={{
          borderRadius: '28px 28px 0 0',
          boxShadow: '0 -8px 32px rgba(16,24,40,0.15)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-1 pb-3 flex-shrink-0">
          <div>
            <p className="font-mono text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {order.order_number ?? order.id?.slice(0, 8)}
            </p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">
              {order.customer?.full_name ?? '—'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_BADGE[order.status] ?? 'slate'} dot>
              {STATUS_LABELS[order.status] ?? order.status}
            </Badge>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              <X size={16} className="text-slate-500" />
            </button>
          </div>
        </div>

        {/* Contact + edit action buttons */}
        <div className="flex gap-2.5 px-5 pb-3 flex-shrink-0">
          {phone && (
            <a
              href={`tel:${phone}`}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-semibold active:scale-95 transition-transform"
              style={{ background: 'linear-gradient(135deg,#DCFCE7,#BBF7D0)', color: '#15803D' }}
            >
              <Phone size={14} />
              Позвонить
            </a>
          )}
          {waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-semibold active:scale-95 transition-transform"
              style={{ background: 'linear-gradient(135deg,#D1FAE5,#A7F3D0)', color: '#047857' }}
            >
              <ExternalLink size={14} />
              WhatsApp
            </a>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => { onClose(); navigate(`${editBasePath}/${order.id}/edit`, { state: { order } }) }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-semibold active:scale-95 transition-transform"
              style={{ background: 'linear-gradient(135deg,#EEF2FF,#E0E7FF)', color: '#4338CA' }}
            >
              <Pencil size={14} />
              Редактировать
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 flex-shrink-0 px-5 gap-1">
          {[
            { id: 'info',     label: 'Заказ',        icon: Package },
            { id: 'timeline', label: 'Статусы',       icon: Clock },
            { id: 'comments', label: 'Комментарии',   icon: MessageCircle },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors
                ${activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── ЗАКАЗ tab ── */}
          {activeTab === 'info' && (
            <div className="p-5 space-y-5">
              {/* Products */}
              {order.items?.length > 0 && (
                <section>
                  <SectionLabel>Товары</SectionLabel>
                  <div className="space-y-3">
                    {order.items.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-3">
                        {item.product_image_url
                          ? <img src={item.product_image_url} alt="" className="w-12 h-12 rounded-2xl object-cover bg-slate-100 flex-shrink-0" />
                          : <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                              <Package size={18} className="text-slate-300" />
                            </div>
                        }
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{item.product_name ?? '—'}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{item.quantity} × {fmtAmount(item.unit_price)}</p>
                        </div>
                        <p className="text-sm font-bold text-slate-800 whitespace-nowrap">{fmtAmount(item.quantity * item.unit_price)}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Totals */}
              <section
                className="rounded-2xl p-4 space-y-2"
                style={{ background: 'linear-gradient(135deg,#F8FAFF,#F0F4FF)' }}
              >
                <TotalRow label="Сумма товаров" value={fmtAmount(order.total_amount)} />
                <TotalRow label="Доставка" value={fmtAmount(order.delivery_fee)} />
                <div className="h-px bg-slate-200/60 my-1" />
                <TotalRow label="Итого к оплате" value={fmtAmount(order.total_order_amount ?? ((order.total_amount ?? 0) + (order.delivery_fee ?? 0)))} bold />
                <TotalRow label="Чистая выручка" value={fmtAmount(order.net_revenue)} green />
              </section>

              {/* Client */}
              <section>
                <SectionLabel>Клиент</SectionLabel>
                <div
                  className="rounded-2xl p-4 space-y-2.5"
                  style={{ background: '#FAFBFC', border: '1px solid rgba(226,232,240,0.7)' }}
                >
                  {order.customer?.full_name && <DetailRow label="Имя" value={order.customer.full_name} />}
                  {order.customer?.phone && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-400">Телефон</span>
                      <a href={`tel:${order.customer.phone}`} className="text-sm font-semibold text-indigo-600">
                        {order.customer.phone}
                      </a>
                    </div>
                  )}
                  {order.city_id && citiesById[order.city_id] && (
                    <DetailRow label="Город" value={citiesById[order.city_id]} />
                  )}
                  {order.delivery_address && (
                    <DetailRow label="Адрес" value={order.delivery_address} />
                  )}
                  {order.notes && (
                    <div className="pt-1">
                      <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider mb-1">Комментарий клиента</p>
                      <p className="text-sm text-slate-700 bg-amber-50 rounded-xl px-3 py-2">{order.notes}</p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* ── СТАТУСЫ tab ── */}
          {activeTab === 'timeline' && (
            <div className="p-5">
              <div className="space-y-3">
                {TIMELINE_STEPS.map((step, idx) => {
                  const done = idx <= currentIdx
                  const active = order.status === step.status
                  const event = timelineEvents.find(e => e.to_status === step.status)
                  const rb = ROLE_BADGE[step.role]
                  return (
                    <div key={step.status} className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition-all ${
                      active ? 'bg-indigo-50 border border-indigo-100' :
                      done   ? 'bg-slate-50' : 'opacity-40'
                    }`}>
                      {/* Step number */}
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                        active ? 'bg-indigo-600 text-white' :
                        done   ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'
                      }`}>
                        {idx + 1}
                      </div>
                      {/* Label + actor */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold ${active ? 'text-indigo-700' : done ? 'text-slate-800' : 'text-slate-400'}`}>
                          {step.label}
                        </p>
                        {event ? (
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            {event.actor_name} · {fmtDate(event.created_at)}
                          </p>
                        ) : (
                          <p className="text-xs mt-0.5" style={{ color: rb.color }}>{rb.label}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
                {['returned', 'cancelled'].includes(order.status) && (
                  <div className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-red-50 border border-red-100">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-red-500 text-white text-xs font-bold">
                      !
                    </div>
                    <p className="text-sm font-bold text-red-600">
                      {order.status === 'returned' ? 'Возврат' : 'Отменён'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── КОММЕНТАРИИ tab ── */}
          {activeTab === 'comments' && (
            <div className="flex flex-col min-h-full">
              <div className="flex-1 p-5 space-y-3">
                {commentsLoading && (
                  <p className="text-xs text-slate-400 text-center py-6">Загрузка…</p>
                )}
                {!commentsLoading && comments.length === 0 && (
                  <div className="text-center py-8">
                    <MessageCircle size={28} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-sm text-slate-400">Нет комментариев</p>
                    <p className="text-xs text-slate-300 mt-1">Добавьте первый комментарий</p>
                  </div>
                )}
                {comments.map(c => (
                  <div
                    key={c.id}
                    className="rounded-2xl px-4 py-3"
                    style={{ background: 'linear-gradient(135deg,#F8FAFF,#F0F4FF)' }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-bold text-slate-700">
                        {c.author_name ?? 'Вы'}
                        <span className="ml-2 inline-flex text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                          {roleLabel(c.author_role)}
                        </span>
                      </span>
                      <span className="text-[10px] text-slate-400">{fmtDate(c.created_at)}</span>
                    </div>
                    <p className="text-sm text-slate-800">{c.comment}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Comment input bar */}
        {activeTab === 'comments' && (
          <div
            className="flex items-center gap-2 px-5 py-3 flex-shrink-0"
            style={{ borderTop: '1px solid rgba(226,232,240,0.7)' }}
          >
            <input
              className="input flex-1 text-sm py-2.5"
              placeholder="Написать комментарий…"
              value={comment}
              onChange={e => setComment(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
            />
            <button
              onClick={handleSend}
              disabled={!comment.trim() || addComment.isPending}
              className="w-10 h-10 flex items-center justify-center rounded-2xl text-white disabled:opacity-40 active:scale-95 transition-transform"
              style={{ background: 'linear-gradient(135deg,#4F46E5,#6D28D9)' }}
            >
              <Send size={16} />
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function SectionLabel({ children }) {
  return (
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{children}</p>
  )
}

function TotalRow({ label, value, bold, green }) {
  return (
    <div className="flex justify-between items-center">
      <span className={`text-sm ${bold ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>{label}</span>
      <span className={`text-sm font-bold ${green ? 'text-emerald-600' : bold ? 'text-slate-900' : 'text-slate-700'}`}>{value}</span>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-xs text-slate-400 flex-shrink-0">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-right">{value}</span>
    </div>
  )
}
