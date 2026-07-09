import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { X, Send, Package, MessageCircle, Clock, Phone, ExternalLink, Calendar, MapPin, User, FileText, Pencil } from 'lucide-react'
import { fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { useOrderComments, useAddOrderComment } from '../hooks/useOrderComments'
import { roleLabel } from '../../orders/components/OrderCommentsPanel'
import { fetchOrderTimeline } from '../../dispatcher/api'
import { KEYS } from '../../../shared/queryKeys'
import { M, StatusPill } from './mobileUi'

const EDITABLE_STATUSES = new Set(['new', 'confirmed', 'assigned'])

const ROLE_BADGE = {
  seller:     { label: 'Продавец',  color: '#7C3AED', bg: '#F5F3FF' },
  dispatcher: { label: 'Диспетчер', color: '#2563EB', bg: '#EFF6FF' },
  courier:    { label: 'Курьер',    color: '#059669', bg: '#ECFDF5' },
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

export default function SellerOrderDetailPanel({ order, onClose, citiesById = {}, editBasePath = '/seller/orders', allowEdit = true }) {
  const navigate = useNavigate()
  const [comment, setComment]   = useState('')
  const [activeTab, setActiveTab] = useState('info')

  const { data: comments = [] } = useOrderComments(order?.id)
  const addComment = useAddOrderComment(order?.id)
  const { data: timelineEvents = [] } = useQuery({
    queryKey: KEYS.dispatcher.timeline(order?.id),
    queryFn: () => fetchOrderTimeline(order?.id),
    enabled: !!order?.id,
  })

  if (!order) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-12 text-center" style={{ background: M.bg, fontFamily: M.font }}>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5" style={{ background: '#ECEBFE' }}>
          <Package size={32} style={{ color: M.indigo }} />
        </div>
        <p style={{ fontSize: 15, fontWeight: 700, color: M.sub }}>Выберите заказ</p>
        <p className="max-w-[200px]" style={{ fontSize: 12, color: M.muted, marginTop: 6 }}>
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
    <div className="h-full flex flex-col" style={{ background: '#fff', fontFamily: M.font }}>

      {/* Header */}
      <div
        className="flex items-start justify-between px-6 py-4 flex-shrink-0"
        style={{ borderBottom: `1px solid ${M.border}` }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 mb-1">
            <p style={{ fontSize: 11, fontWeight: 700, color: M.faint, letterSpacing: '.03em', fontVariantNumeric: 'tabular-nums' }}>
              {order.order_number ?? order.id?.slice(0, 8)}
            </p>
            <StatusPill status={order.status} />
          </div>
          <p className="truncate" style={{ fontSize: 18, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>
            {order.customer?.full_name ?? '—'}
          </p>
          {order.created_at && (
            <p className="flex items-center gap-1" style={{ fontSize: 12, color: M.muted, marginTop: 2 }}>
              <Calendar size={11} />
              {fmtDate(order.created_at)}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full transition-colors ml-3 flex-shrink-0"
          style={{ color: M.muted }}
        >
          <X size={15} />
        </button>
      </div>

      {/* Contact + edit actions */}
      <div className="flex gap-2 px-6 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${M.border}` }}>
        {phone && (
          <a
            href={`tel:${phone}`}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl transition-opacity hover:opacity-90"
            style={{ background: M.greenBg, color: M.green, fontSize: 12.5, fontWeight: 700 }}
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
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl transition-opacity hover:opacity-90"
            style={{ background: M.greenBg, color: M.green, fontSize: 12.5, fontWeight: 700 }}
          >
            <ExternalLink size={13} />
            WhatsApp
          </a>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => navigate(`${editBasePath}/${order.id}/edit`, { state: { order } })}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl transition-opacity hover:opacity-90"
            style={{ background: M.indigoBg, color: M.indigoDeep, fontSize: 12.5, fontWeight: 700 }}
          >
            <Pencil size={13} />
            Редактировать
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-shrink-0 px-5 gap-0.5" style={{ borderBottom: `1px solid ${M.border}` }}>
        {[
          { id: 'info',     label: 'Заказ',       icon: Package },
          { id: 'timeline', label: 'Статусы',      icon: Clock },
          { id: 'comments', label: 'Комментарии',  icon: MessageCircle },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-1.5 px-3 py-2.5 transition-colors"
            style={{
              fontSize: 12.5, fontWeight: 700,
              borderBottom: activeTab === tab.id ? `2px solid ${M.indigo}` : '2px solid transparent',
              color: activeTab === tab.id ? M.indigo : M.muted,
            }}
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
                        ? <img src={item.product_image_url} alt="" className="w-14 h-14 rounded-2xl object-cover flex-shrink-0" style={{ background: '#F0EFEA' }} />
                        : (
                          <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: '#F0EFEA' }}>
                            <Package size={18} style={{ color: '#C0C0B6' }} />
                          </div>
                        )
                      }
                      <div className="flex-1 min-w-0">
                        <p className="truncate" style={{ fontSize: 14, fontWeight: 600, color: M.ink }}>{item.product_name ?? '—'}</p>
                        <p style={{ fontSize: 12, color: M.muted, marginTop: 2 }}>{item.quantity} × {fmtAmount(item.unit_price)}</p>
                      </div>
                      <p className="whitespace-nowrap flex-shrink-0" style={{ fontSize: 14, fontWeight: 800, color: M.ink, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtAmount(item.quantity * item.unit_price)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Financial summary */}
            <section className="rounded-2xl p-5" style={{ background: M.bg }}>
              <div className="space-y-2.5">
                <FinRow label="Сумма товаров"  value={fmtAmount(order.total_amount)} />
                <FinRow label="Доставка"        value={fmtAmount(order.delivery_fee)} />
                <div className="h-px my-1" style={{ background: M.border }} />
                <div className="flex justify-between items-center">
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: M.sub }}>Итого к оплате</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: M.ink, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtAmount(order.total_order_amount ?? ((order.total_amount ?? 0) + (order.delivery_fee ?? 0)))}
                  </span>
                </div>
                {(order.courier_payout ?? 0) > 0 && (
                  <div className="flex justify-between items-center pt-1">
                    <span style={{ fontSize: 12, fontWeight: 600, color: M.sub }}>Комиссионная база</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: M.indigoDeep }}>
                      {fmtAmount((order.total_order_amount ?? order.total_amount ?? 0) - (order.courier_payout ?? 0))}
                    </span>
                  </div>
                )}
                {order.net_revenue != null && (
                  <div className="flex justify-between items-center pt-1">
                    <span style={{ fontSize: 12, color: M.muted }}>Чистая выручка</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: M.green }}>{fmtAmount(order.net_revenue)}</span>
                  </div>
                )}
              </div>
            </section>

            {/* Customer */}
            <section>
              <SectionLabel>Клиент</SectionLabel>
              <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${M.border}` }}>
                {order.customer?.full_name && (
                  <CustomerRow icon={<User size={13} style={{ color: M.muted }} />} label="Имя">
                    {order.customer.full_name}
                  </CustomerRow>
                )}
                {order.customer?.phone && (
                  <CustomerRow icon={<Phone size={13} style={{ color: M.muted }} />} label="Телефон">
                    <a href={`tel:${order.customer.phone}`} style={{ color: M.indigo, fontWeight: 700 }}>
                      {order.customer.phone}
                    </a>
                  </CustomerRow>
                )}
                {order.city_id && citiesById[order.city_id] && (
                  <CustomerRow icon={<MapPin size={13} style={{ color: M.muted }} />} label="Город">
                    {citiesById[order.city_id]}
                  </CustomerRow>
                )}
                {order.delivery_address && (
                  <CustomerRow icon={<MapPin size={13} style={{ color: M.muted }} />} label="Адрес">
                    {order.delivery_address}
                  </CustomerRow>
                )}
                {order.customer_note && (
                  <CustomerRow icon={<FileText size={13} style={{ color: M.muted }} />} label="Примечание">
                    <span style={{ color: '#76766E', fontStyle: 'italic' }}>{order.customer_note}</span>
                  </CustomerRow>
                )}
              </div>
            </section>
          </div>
        )}

        {/* ── СТАТУСЫ ── */}
        {activeTab === 'timeline' && (
          <div className="p-6">
            <div className="space-y-2">
              {TIMELINE_STEPS.map((step, idx) => {
                const event  = timelineEvents.find(e => e.to_status === step.status)
                const done   = !!event
                const active = idx === currentIdx
                // No event for a step this order has already passed means the workflow
                // skipped it (e.g. no prepayment required) — it never happened, so don't
                // render it as a completed step with a guessed role.
                if (!done && idx <= currentIdx) return null
                const rb = ROLE_BADGE[step.role]
                return (
                  <div
                    key={step.status}
                    className="flex items-center gap-3 rounded-2xl px-4 py-3 transition-all"
                    style={{
                      background: active ? '#F5F4FE' : done ? M.bg : 'transparent',
                      border: active ? '1px solid #E3E1FB' : '1px solid transparent',
                      opacity: done || active ? 1 : 0.45,
                    }}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
                      style={{
                        background: active ? M.indigo : done ? '#10B981' : M.border,
                        color: active || done ? '#fff' : M.muted,
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: active ? M.indigoDeep : done ? M.ink : M.muted }}>
                        {step.label}
                      </p>
                      {event ? (
                        <p className="truncate" style={{ fontSize: 12, color: M.sub, marginTop: 2 }}>
                          {event.actor_name} · {fmtDate(event.created_at)}
                        </p>
                      ) : (
                        <p style={{ fontSize: 12, marginTop: 2, color: rb.color }}>{rb.label}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── КОММЕНТАРИИ ── */}
        {activeTab === 'comments' && (
          <div className="p-6 space-y-3">
            {comments.length === 0 && (
              <div className="text-center py-8">
                <MessageCircle size={28} className="mx-auto mb-2" style={{ color: M.border }} />
                <p style={{ fontSize: 12, color: M.muted }}>Комментариев пока нет</p>
              </div>
            )}
            {comments.map((c, i) => (
              <div key={i} className="rounded-xl p-3.5" style={{ background: M.bg, border: `1px solid ${M.border}` }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: M.sub }}>
                  {c.author_name ?? '—'}
                  <span className="ml-2 inline-flex" style={{ fontSize: 10, fontWeight: 700, color: M.indigoDeep, background: M.indigoBg, padding: '2px 8px', borderRadius: 999 }}>
                    {roleLabel(c.author_role)}
                  </span>
                </p>
                <p style={{ fontSize: 13.5, color: '#76766E', marginTop: 4 }}>{c.comment}</p>
                <p style={{ fontSize: 10, color: M.faint, marginTop: 6 }}>{fmtDate(c.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Comment input */}
      {activeTab === 'comments' && (
        <div className="flex-shrink-0 px-6 py-3 flex gap-2" style={{ borderTop: `1px solid ${M.border}` }}>
          <input
            type="text"
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
            placeholder="Добавить комментарий…"
            className="flex-1 outline-none"
            style={{ border: `1px solid ${M.borderAlt}`, borderRadius: 11, padding: '9px 13px', fontFamily: 'inherit', fontSize: 12.5, color: M.ink }}
          />
          <button
            onClick={handleSend}
            disabled={!comment.trim() || addComment.isPending}
            className="flex items-center justify-center transition-transform active:scale-95 disabled:opacity-50"
            style={{ width: 38, borderRadius: 11, background: M.indigo, color: '#fff', border: 'none' }}
          >
            <Send size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }) {
  return <p style={{ fontSize: 11, fontWeight: 700, color: M.muted, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 12 }}>{children}</p>
}

function FinRow({ label, value }) {
  return (
    <div className="flex justify-between items-center">
      <span style={{ fontSize: 12, color: M.sub }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#76766E' }}>{value}</span>
    </div>
  )
}

function CustomerRow({ icon, label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3" style={{ borderBottom: `1px solid ${M.bg}` }}>
      <div className="flex items-center gap-2 flex-shrink-0">
        {icon}
        <span style={{ fontSize: 12, color: M.muted }}>{label}</span>
      </div>
      <span className="text-right break-words max-w-[60%]" style={{ fontSize: 12.5, fontWeight: 700, color: M.ink }}>
        {children}
      </span>
    </div>
  )
}
