import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Send, Package, MessageCircle, Clock, Phone, ExternalLink, Calendar, MapPin, User, FileText, Pencil } from 'lucide-react'
import Badge from '../../../shared/components/Badge'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { useOrderComments, useAddOrderComment } from '../hooks/useOrderComments'
import { roleLabel } from '../../orders/components/OrderCommentsPanel'

const EDITABLE_STATUSES = new Set(['new', 'confirmed', 'assigned'])

const TIMELINE_STEPS = [
  { status: 'new',                 label: 'Создан' },
  { status: 'confirmed',           label: 'Подтверждён' },
  { status: 'prepayment_pending',  label: 'Ожидает предоплату' },
  { status: 'prepayment_received', label: 'Предоплата получена' },
  { status: 'assigned',            label: 'Назначен курьер' },
  { status: 'in_delivery',         label: 'В доставке' },
  { status: 'delivered',           label: 'Доставлен' },
]
const STATUS_ORDER = TIMELINE_STEPS.map(s => s.status)

export default function SellerOrderDetailPanel({ order, onClose, citiesById = {}, editBasePath = '/seller/orders', allowEdit = true }) {
  const navigate = useNavigate()
  const [comment, setComment]   = useState('')
  const [activeTab, setActiveTab] = useState('info')

  const { data: comments = [] } = useOrderComments(order?.id)
  const addComment = useAddOrderComment(order?.id)

  if (!order) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-12 text-center"
           style={{ background: 'linear-gradient(160deg,#F8FAFF 0%,#F0F4FF 100%)' }}>
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
          style={{ background: 'linear-gradient(135deg,#EEF2FF,#E0E7FF)' }}
        >
          <Package size={32} className="text-indigo-300" />
        </div>
        <p className="text-base font-bold text-slate-500">Выберите заказ</p>
        <p className="text-xs text-slate-400 mt-1.5 max-w-[200px]">
          Нажмите на строку слева для просмотра деталей
        </p>
      </div>
    )
  }

  const currentIdx = STATUS_ORDER.indexOf(order.status)
  const phone  = order.customer?.phone
  const waHref = phone ? `https://wa.me/${phone.replace(/\D/g, '')}` : null
  const canEdit = allowEdit && EDITABLE_STATUSES.has(order.status)

  function handleSend() {
    const text = comment.trim()
    if (!text || addComment.isPending) return
    addComment.mutate(text, { onSuccess: () => setComment('') })
  }

  return (
    <div className="h-full flex flex-col bg-white">

      {/* Header */}
      <div
        className="flex items-start justify-between px-6 py-4 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(226,232,240,0.7)' }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 mb-1">
            <p className="font-mono text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {order.order_number ?? order.id?.slice(0, 8)}
            </p>
            <Badge variant={STATUS_BADGE[order.status] ?? 'slate'} dot>
              {STATUS_LABELS[order.status] ?? order.status}
            </Badge>
          </div>
          <p className="text-lg font-black text-slate-900 truncate leading-tight">
            {order.customer?.full_name ?? '—'}
          </p>
          {order.created_at && (
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
              <Calendar size={11} />
              {fmtDate(order.created_at)}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors ml-3 flex-shrink-0"
        >
          <X size={15} className="text-slate-500" />
        </button>
      </div>

      {/* Contact + edit actions */}
      <div className="flex gap-2 px-6 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(226,232,240,0.7)' }}>
        {phone && (
          <a
            href={`tel:${phone}`}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#DCFCE7,#BBF7D0)', color: '#15803D' }}
          >
            <Phone size={13} />
            Позвонить
          </a>
        )}
        {waHref && (
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#D1FAE5,#A7F3D0)', color: '#047857' }}
          >
            <ExternalLink size={13} />
            WhatsApp
          </a>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => navigate(`${editBasePath}/${order.id}/edit`, { state: { order } })}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#EEF2FF,#E0E7FF)', color: '#4338CA' }}
          >
            <Pencil size={13} />
            Редактировать
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-shrink-0 px-5 gap-0.5" style={{ borderBottom: '1px solid rgba(226,232,240,0.7)' }}>
        {[
          { id: 'info',     label: 'Заказ',       icon: Package },
          { id: 'timeline', label: 'Статусы',      icon: Clock },
          { id: 'comments', label: 'Комментарии',  icon: MessageCircle },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors
              ${activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            <tab.icon size={12} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── ЗАКАЗ ── */}
        {activeTab === 'info' && (
          <div className="p-6 space-y-5">

            {/* Products */}
            {order.items?.length > 0 && (
              <section>
                <SectionLabel>Товары</SectionLabel>
                <div className="space-y-3">
                  {order.items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-4">
                      {item.product_image_url
                        ? <img src={item.product_image_url} alt="" className="w-14 h-14 rounded-2xl object-cover bg-slate-100 flex-shrink-0" />
                        : (
                          <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                               style={{ background: 'linear-gradient(135deg,#F8FAFC,#F1F5F9)' }}>
                            <Package size={18} className="text-slate-300" />
                          </div>
                        )
                      }
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{item.product_name ?? '—'}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{item.quantity} × {fmtAmount(item.unit_price)}</p>
                      </div>
                      <p className="text-sm font-bold text-slate-800 whitespace-nowrap flex-shrink-0">
                        {fmtAmount(item.quantity * item.unit_price)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Financial summary */}
            <section
              className="rounded-2xl p-5"
              style={{ background: 'linear-gradient(135deg,#F0F4FF,#E8EEFF)' }}
            >
              <div className="space-y-2.5">
                <FinRow label="Сумма товаров"  value={fmtAmount(order.total_amount)} />
                <FinRow label="Доставка"        value={fmtAmount(order.delivery_fee)} />
                <div className="h-px bg-indigo-200/60 my-1" />
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-slate-700">Итого к оплате</span>
                  <span className="text-xl font-black text-slate-900">
                    {fmtAmount(order.total_order_amount ?? ((order.total_amount ?? 0) + (order.delivery_fee ?? 0)))}
                  </span>
                </div>
                {order.net_revenue != null && (
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-xs text-slate-500">Чистая выручка</span>
                    <span className="text-sm font-bold text-emerald-600">{fmtAmount(order.net_revenue)}</span>
                  </div>
                )}
              </div>
            </section>

            {/* Customer */}
            <section>
              <SectionLabel>Клиент</SectionLabel>
              <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(226,232,240,0.8)' }}>
                {order.customer?.full_name && (
                  <CustomerRow icon={<User size={13} className="text-slate-400" />} label="Имя">
                    {order.customer.full_name}
                  </CustomerRow>
                )}
                {order.customer?.phone && (
                  <CustomerRow icon={<Phone size={13} className="text-slate-400" />} label="Телефон">
                    <a href={`tel:${order.customer.phone}`} className="text-indigo-600 font-semibold">
                      {order.customer.phone}
                    </a>
                  </CustomerRow>
                )}
                {order.city_id && citiesById[order.city_id] && (
                  <CustomerRow icon={<MapPin size={13} className="text-slate-400" />} label="Город">
                    {citiesById[order.city_id]}
                  </CustomerRow>
                )}
                {order.delivery_address && (
                  <CustomerRow icon={<MapPin size={13} className="text-slate-400" />} label="Адрес">
                    {order.delivery_address}
                  </CustomerRow>
                )}
                {order.customer_note && (
                  <CustomerRow icon={<FileText size={13} className="text-slate-400" />} label="Примечание">
                    <span className="text-slate-600 italic">{order.customer_note}</span>
                  </CustomerRow>
                )}
              </div>
            </section>
          </div>
        )}

        {/* ── СТАТУСЫ ── */}
        {activeTab === 'timeline' && (
          <div className="p-6">
            <div className="relative pl-10">
              {/* Vertical line */}
              <div className="absolute left-4 top-4 bottom-4 w-px bg-slate-100" />

              <div className="space-y-1">
                {TIMELINE_STEPS.map((step, idx) => {
                  const done   = idx <= currentIdx
                  const active = idx === currentIdx
                  return (
                    <div key={step.status} className="flex items-center gap-3 py-2.5 relative">
                      <div
                        className={`absolute -left-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10 transition-all
                          ${active ? 'shadow-lg shadow-indigo-200' : ''}`}
                        style={{
                          background: active ? '#4F46E5' : done ? '#10B981' : '#F1F5F9',
                        }}
                      >
                        {done && !active && (
                          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {active && <div className="w-2 h-2 rounded-full bg-white" />}
                        {!done && !active && <div className="w-2 h-2 rounded-full bg-slate-300" />}
                      </div>
                      <span className={`text-sm font-medium
                        ${active ? 'text-indigo-700 font-bold' : done ? 'text-slate-700' : 'text-slate-300'}`}>
                        {step.label}
                      </span>
                      {active && (
                        <span className="ml-auto text-[10px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">
                          Текущий
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── КОММЕНТАРИИ ── */}
        {activeTab === 'comments' && (
          <div className="p-6 space-y-3">
            {comments.length === 0 && (
              <div className="text-center py-8">
                <MessageCircle size={28} className="mx-auto mb-2 text-slate-200" />
                <p className="text-xs text-slate-400">Комментариев пока нет</p>
              </div>
            )}
            {comments.map((c, i) => (
              <div key={i} className="rounded-xl p-3.5" style={{ background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.6)' }}>
                <p className="text-xs font-semibold text-slate-700">
                  {c.author_name ?? '—'}
                  <span className="ml-2 inline-flex text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                    {roleLabel(c.author_role)}
                  </span>
                </p>
                <p className="text-sm text-slate-600 mt-1">{c.comment}</p>
                <p className="text-[10px] text-slate-400 mt-1.5">{fmtDate(c.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Comment input */}
      {activeTab === 'comments' && (
        <div className="flex-shrink-0 px-6 py-3 flex gap-2" style={{ borderTop: '1px solid rgba(226,232,240,0.7)' }}>
          <input
            type="text"
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
            placeholder="Добавить комментарий…"
            className="input flex-1 text-xs py-2.5 px-3"
          />
          <button
            onClick={handleSend}
            disabled={!comment.trim() || addComment.isPending}
            className="btn btn-primary btn-sm"
          >
            <Send size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }) {
  return <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">{children}</p>
}

function FinRow({ label, value }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs font-semibold text-slate-700">{value}</span>
    </div>
  )
}

function CustomerRow({ icon, label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3"
         style={{ borderBottom: '1px solid rgba(226,232,240,0.5)' }}>
      <div className="flex items-center gap-2 flex-shrink-0">
        {icon}
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <span className="text-xs font-semibold text-slate-800 text-right break-words max-w-[60%]">
        {children}
      </span>
    </div>
  )
}
