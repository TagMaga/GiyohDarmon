import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Phone, MapPin, Send, Loader2, CheckCircle, XCircle } from 'lucide-react'
import Sheet from './Sheet'
import { C, statusPill } from './theme'
import { fmt, fmtDate } from '../statusConfig'
import { STATUS_ACTIONS } from '../statusConfig'
import { resolveCustomer, resolveAddress, resolveCity } from '../utils/resolveCustomer'
import { resolveCourier, resolveCourierDisplay, formatOrderLabel, getOrderId } from '../utils/orderHelpers'
import { fetchOrderDetail, fetchOrderTimeline, fetchComments, addComment, verifyPrepayment, rejectPrepayment } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { useToast } from '../../../shared/components/ToastProvider'

export default function OrderDetailSheet({ order, open, onClose, customerMap, courierMap, onAction, isConfirming }) {
  const toast = useToast()
  const qc = useQueryClient()
  const orderId = order ? getOrderId(order) : null

  const { data: fullOrder } = useQuery({
    queryKey: KEYS.dispatcher.orderDetail(orderId),
    queryFn: () => fetchOrderDetail(orderId),
    enabled: !!orderId && open,
    staleTime: 30_000,
  })
  const { data: timeline = [] } = useQuery({
    queryKey: KEYS.dispatcher.timeline(orderId),
    queryFn: () => fetchOrderTimeline(orderId),
    enabled: !!orderId && open,
    staleTime: 30_000,
  })

  const { mutate: doVerify, isPending: verifying } = useMutation({
    mutationFn: () => verifyPrepayment(orderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.orderDetail(orderId) })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
      toast.success('Предоплата подтверждена')
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })
  const { mutate: doRejectPrepay, isPending: rejectingPrepay } = useMutation({
    mutationFn: () => rejectPrepayment(orderId, { reason: 'Не подтверждено дисптечером' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.orderDetail(orderId) })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
      toast.success('Предоплата отклонена')
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  if (!open || !order) return null

  const o = fullOrder ?? order
  const customer = resolveCustomer(o, customerMap)
  const courier = resolveCourier(o, courierMap)
  const courierDisp = resolveCourierDisplay(o, courierMap)
  const address = [resolveAddress(o), resolveCity(o)].filter(Boolean).join(', ') || customer?.address || '—'
  const pill = statusPill(o.status)
  const isExpress = o.delivery_method === 'express'
  const items = Array.isArray(o.items) ? o.items : Array.isArray(o.order_items) ? o.order_items : []
  const comment = o.notes ?? o.comment ?? o.customer_comment

  const productTotal = Number(o.total_amount ?? 0)
  const deliveryFee = Number(o.delivery_fee ?? 0)
  const totalOrderAmt = Number(o.total_order_amount ?? (productTotal + deliveryFee))
  const prepayAmt = Number(o.prepayment_amount ?? 0)
  const amountToCollect = Number(o.amount_to_collect ?? Math.max(0, totalOrderAmt - prepayAmt))
  const prepayStatus = o.prepayment_status ?? 'none'

  const actions = (STATUS_ACTIONS[o.status] ?? []).filter((a) => a.key !== 'comment')
  const primary = actions.filter((a) => a.variant === 'primary')
  const others = actions.filter((a) => a.variant !== 'primary')

  return (
    <Sheet open={open} onClose={onClose} maxHeight="90%" zIndex={45}>
      {/* Header */}
      <div style={{ padding: '8px 4px 14px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: pill.dot }} />
          <span style={{ fontSize: 20, fontWeight: 900 }}>#{formatOrderLabel(o)}</span>
          <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: pill.bg, color: pill.color }}>{pill.label}</span>
          {isExpress && <span style={{ padding: '3px 8px', borderRadius: 99, fontSize: 10, fontWeight: 800, background: C.amberBg, color: C.amber }}>⚡ Экспресс</span>}
          <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'monospace', color: C.text3 }}>{fmtDate(o.created_at)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{customer?.full_name || 'Клиент —'}</div>
            {customer?.phone && (
              <a href={`tel:${customer.phone}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontFamily: 'monospace', color: C.blue, marginTop: 3 }}>
                <Phone size={11} />{customer.phone}
              </a>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginTop: 5 }}>
              <MapPin size={12} color={C.text3} style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.35 }}>{address}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.04em', color: C.text3 }}>Получить</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.violetDk, lineHeight: 1.1 }}>
              {fmt(amountToCollect)}<span style={{ fontSize: 11, fontWeight: 600, color: C.text3 }}> c</span>
            </div>
          </div>
        </div>
        {comment && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, background: 'rgba(180,83,9,.06)', border: '1px solid rgba(180,83,9,.16)', borderRadius: 10, padding: '8px 10px' }}>
            <span style={{ fontSize: 11 }}>💬</span>
            <span style={{ fontSize: 11.5, color: '#9A6B1E', lineHeight: 1.4 }}>{comment}</span>
          </div>
        )}
      </div>

      {/* Courier */}
      <div style={{ padding: '12px 4px', borderBottom: `1px solid ${C.border2}` }}>
        {courierDisp.name ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{courierDisp.name}</div>
              <div style={{ fontSize: 11.5, color: C.text4 }}>{courier?.phone || courierDisp.label || 'Назначен'}</div>
            </div>
            {courier?.phone && (
              <a href={`tel:${courier.phone}`} style={{ width: 34, height: 34, borderRadius: 10, background: C.greenBg, color: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Phone size={15} />
              </a>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: C.text3 }}>Курьер не назначен</div>
        )}
      </div>

      {/* Products */}
      <div style={{ padding: '13px 4px 4px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: C.text3 }}>Товары{items.length ? ` · ${items.length}` : ''}</div>
      <div style={{ padding: '0 4px 12px', borderBottom: `1px solid ${C.border2}` }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.text3, padding: '6px 0' }}>Состав не указан</div>
        ) : items.map((item, i) => (
          <div key={item.id ?? i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: i < items.length - 1 ? `1px solid ${C.border2}` : 'none' }}>
            <span style={{ fontSize: 12.5 }}>{item.product_name ?? item.name} <span style={{ fontSize: 10.5, color: C.text3 }}>×{item.quantity ?? 1}</span></span>
            <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: C.text2 }}>{fmt(item.total_price ?? item.price ?? 0)} c</span>
          </div>
        ))}
      </div>

      {/* Finance */}
      <div style={{ padding: '13px 4px 4px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: C.text3 }}>Финансы</div>
      <div style={{ padding: '0 4px 14px', borderBottom: `1px solid ${C.border2}` }}>
        <div style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 13, padding: '12px 13px' }}>
          <FinRow label="Товары" value={`${fmt(productTotal)} c`} />
          <FinRow label={`Доставка${isExpress ? ' ⚡' : ''}`} value={deliveryFee > 0 ? `${fmt(deliveryFee)} c` : 'Бесплатно'} color={deliveryFee > 0 ? C.amber : C.green} />
          {prepayAmt > 0 && <FinRow label="Предоплата" value={`−${fmt(prepayAmt)} c`} color={C.green} />}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, marginTop: 2, borderTop: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text2 }}>Курьер получит</span>
            <span style={{ fontSize: 15, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: C.violetDk }}>{fmt(amountToCollect)} c</span>
          </div>
        </div>
        {prepayStatus === 'pending_verification' && (
          <div style={{ marginTop: 11, background: 'rgba(180,83,9,.06)', border: '1px solid rgba(180,83,9,.22)', borderRadius: 13, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.amber, marginBottom: 8 }}>⏳ Предоплата ожидает проверки</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => doVerify()} disabled={verifying} style={{ flex: 1, padding: 9, border: 'none', borderRadius: 10, background: C.green, color: '#fff', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: verifying ? 0.6 : 1 }}>
                {verifying ? <Loader2 size={12} className="animate-spin" style={{ display: 'inline', marginRight: 4 }} /> : <CheckCircle size={12} style={{ display: 'inline', marginRight: 4 }} />}Подтвердить
              </button>
              <button onClick={() => doRejectPrepay()} disabled={rejectingPrepay} style={{ flex: 1, padding: 9, border: `1px solid ${C.redSoft}`, borderRadius: 10, background: '#fff', color: C.red, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: rejectingPrepay ? 0.6 : 1 }}>
                <XCircle size={12} style={{ display: 'inline', marginRight: 4 }} />Отклонить
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div style={{ padding: '13px 4px 4px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: C.text3 }}>История</div>
      <div style={{ padding: '4px 4px 14px', borderBottom: `1px solid ${C.border2}` }}>
        {timeline.length === 0 ? (
          <div style={{ fontSize: 12, color: C.text3, padding: '6px 0' }}>История не найдена</div>
        ) : timeline.map((ev, i) => {
          const isLast = i === timeline.length - 1
          return (
            <div key={ev.id ?? i} style={{ display: 'flex', gap: 11 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', marginTop: 3, background: statusPill(ev.to_status).dot }} />
                {!isLast && <span style={{ width: 2, flex: 1, marginTop: 3, background: C.border }} />}
              </div>
              <div style={{ paddingBottom: 12, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                  {statusPill(ev.to_status).label} {ev.actor_name && <span style={{ fontSize: 10.5, fontWeight: 500, color: C.text3 }}>· {ev.actor_name}</span>}
                </div>
                <div style={{ fontSize: 10, fontFamily: 'monospace', color: C.text3, marginTop: 1 }}>{fmtDate(ev.created_at)}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Comments */}
      <CommentsSection orderId={orderId} open={open} />

      {/* Footer actions */}
      <div style={{ position: 'sticky', bottom: 0, padding: '12px 4px 4px', background: C.bg, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {primary.map((a) => (
          <button
            key={a.key}
            onClick={() => onAction(a.key, o)}
            disabled={a.key === 'confirm' && isConfirming}
            style={{ padding: '13px 16px', borderRadius: 13, border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer', color: '#fff', background: C.gradient, opacity: (a.key === 'confirm' && isConfirming) ? 0.6 : 1 }}
          >
            {a.label}
          </button>
        ))}
        {others.length > 0 && (
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            {others.map((a) => (
              <button
                key={a.key}
                onClick={() => onAction(a.key, o)}
                style={{
                  flex: '1 1 auto', minWidth: 100, padding: '11px 12px', borderRadius: 12, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  border: a.variant === 'danger' ? `1px solid ${C.redSoft}` : `1px solid ${C.border}`,
                  background: a.variant === 'danger' ? '#fff' : C.card,
                  color: a.variant === 'danger' ? C.red : C.text2,
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}

function FinRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={{ fontSize: 11.5, color: C.text3 }}>{label}</span>
      <span style={{ fontSize: 11.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: color ?? C.text2 }}>{value}</span>
    </div>
  )
}

function CommentsSection({ orderId, open }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')

  const { data: comments = [], isPending: loading } = useQuery({
    queryKey: KEYS.dispatcher.comments(orderId),
    queryFn: () => fetchComments(orderId),
    enabled: !!orderId && open,
    retry: false,
    staleTime: 30_000,
  })

  const { mutate: submit, isPending: sending } = useMutation({
    mutationFn: () => addComment(orderId, { comment: text.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.comments(orderId) })
      setText('')
    },
  })

  return (
    <>
      <div style={{ padding: '13px 4px 4px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: C.text3 }}>Комментарии</div>
      <div style={{ padding: '4px 4px 14px' }}>
        {loading && <div style={{ fontSize: 12, color: C.text3 }}>Загрузка…</div>}
        {!loading && comments.length === 0 && <div style={{ fontSize: 11.5, color: C.text3, marginBottom: 8 }}>Нет комментариев</div>}
        {!loading && comments.map((c, i) => (
          <div key={c.id ?? i} style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 11, padding: '9px 11px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>{c.author_name ?? c.author?.full_name ?? 'Система'}</span>
              <span style={{ fontSize: 10, fontFamily: 'monospace', color: C.text3 }}>{fmtDate(c.created_at)}</span>
            </div>
            <div style={{ fontSize: 11.5, color: C.text2, lineHeight: 1.4 }}>{c.comment ?? c.text}</div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Добавить комментарий…"
            style={{ flex: 1, border: `1px solid ${C.border}`, background: C.cardAlt, borderRadius: 11, padding: '9px 12px', fontFamily: 'inherit', fontSize: 12, outline: 'none' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) submit() }}
          />
          <button
            onClick={() => text.trim() && submit()}
            disabled={!text.trim() || sending}
            style={{ width: 38, height: 38, border: 'none', borderRadius: 11, background: C.gradient, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: (!text.trim() || sending) ? 0.6 : 1 }}
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </>
  )
}
