import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, Phone, MapPin, User, Truck, Package, Clock,
  Banknote, CheckCircle, XCircle, AlertCircle, ZoomIn,
  ChevronDown, ChevronUp, Users, MessageSquare, Send, Loader2, Paperclip,
} from 'lucide-react'
import { KEYS } from '../../../shared/queryKeys'
import { STATUS_HEX, fmt, fmtDate } from '../statusConfig'
import { resolveCustomer, resolveAddress, resolveCity } from '../utils/resolveCustomer'
import { resolveCourier, resolveCourierDisplay, formatOrderLabel, getCourierId } from '../utils/orderHelpers'
import { fetchOrderDetail, fetchOrderTimeline, fetchOrderPrepayments, fetchComments, addComment, addOrderAttachment } from '../api'
import { translateMediaError } from '../../../shared/api/mediaErrors'
import { useToast } from '../../../shared/components/ToastProvider'

/* ── Design tokens (warm light — matches dispatcher board) ───────────── */
const BG      = '#FFFFFF'
const PANEL   = '#FFFFFF'
const CARD    = '#FBFAF7'
const BORDER  = '#EAE8E2'
const BORDER2 = '#F0EFEA'
const TEXT1   = '#1C1C1A'
const TEXT2   = '#76766E'
const TEXT3   = '#A3A39A'
const BLUE    = '#0369A1'
const GREEN   = '#047857'
const AMBER   = '#B45309'
const RED     = '#BE123C'
const VIOLET  = '#4338CA'

const STATUS_LABELS = {
  new: 'Новый', confirmed: 'Подтверждён', assigned: 'Назначен',
  in_delivery: 'В пути', delivered: 'Доставлен',
  returned: 'Возврат', issue: 'Проблема', cancelled: 'Отменён',
  prepayment_pending: 'Ожидает предоплату', prepayment_received: 'Предоплата получена',
}

const PREPAY_STATUS = {
  none:                 { label: null,                        color: TEXT3 },
  pending_verification: { label: '⏳ Ожидает проверки',       color: AMBER },
  verified:             { label: '✓ Предоплата подтверждена', color: GREEN },
  rejected:             { label: '✗ Отклонена',              color: RED },
}

const TIMELINE_LABELS = {
  new:                  { label: 'Создан',              dot: STATUS_HEX.new ?? '#64748b' },
  confirmed:            { label: 'Подтверждён',         dot: STATUS_HEX.confirmed ?? BLUE },
  prepayment_pending:   { label: 'Ожидает предоплату',  dot: AMBER },
  prepayment_received:  { label: 'Предоплата получена', dot: GREEN },
  assigned:             { label: 'Назначен курьеру',    dot: STATUS_HEX.assigned ?? VIOLET },
  in_delivery:          { label: 'В доставке',          dot: STATUS_HEX.in_delivery ?? AMBER },
  delivered:            { label: 'Доставлен',           dot: STATUS_HEX.delivered ?? GREEN },
  returned:             { label: 'Возврат',             dot: STATUS_HEX.returned ?? RED },
  issue:                { label: 'Проблема',            dot: STATUS_HEX.issue ?? RED },
  cancelled:            { label: 'Отменён',             dot: STATUS_HEX.cancelled ?? RED },
}

const ACTIONS = {
  new:                [{ key: 'confirm',  label: 'Подтвердить',      primary: true }, { key: 'cancel', label: 'Отменить', danger: true }],
  confirmed:          [{ key: 'assign',   label: 'Назначить курьера', primary: true }, { key: 'cancel', label: 'Отменить', danger: true }],
  prepayment_pending: [{ key: 'cancel',   label: 'Отменить',         danger: true }],
  assigned:           [{ key: 'reassign', label: 'Переназначить',    primary: true }, { key: 'unassign', label: 'Снять курьера', ghost: true }, { key: 'cancel', label: 'Отменить', danger: true }],
  in_delivery:        [{ key: 'unassign', label: 'Снять курьера',    ghost: true }, { key: 'issue', label: 'Проблема', ghost: true }, { key: 'cancel', label: 'Отменить', danger: true }],
  issue:              [{ key: 'resolve',  label: 'Решить проблему',  primary: true }, { key: 'unassign', label: 'Снять курьера', ghost: true }, { key: 'cancel', label: 'Отменить', danger: true }],
  returned:           [],
  delivered:          [],
  cancelled:          [],
}

export default function OrderDrawer({ order, open, onClose, onAction, customerMap = {}, courierMap = {}, isConfirming = false, isVerifyingPrepayment = false }) {
  const orderId = order?.id ?? order?.order_id
  const qc = useQueryClient()
  const toast = useToast()
  const attachmentFileRef = useRef()

  const addAttachmentMut = useMutation({
    mutationFn: (file) => addOrderAttachment(orderId, file, 'other'),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.dispatcher.orderDetail(orderId) }),
    onError: (err) => toast.error(translateMediaError(err)),
  })

  function handleAttachmentFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) addAttachmentMut.mutate(file)
  }

  const { data: fullOrder, isLoading: loadingOrder } = useQuery({
    queryKey: KEYS.dispatcher.orderDetail(orderId),
    queryFn:  () => fetchOrderDetail(orderId),
    enabled:  !!orderId && open,
    staleTime: 30_000,
  })

  const { data: timeline = [], isLoading: loadingTimeline } = useQuery({
    queryKey: KEYS.dispatcher.timeline(orderId),
    queryFn:  () => fetchOrderTimeline(orderId),
    enabled:  !!orderId && open,
    staleTime: 30_000,
  })

  const { data: prepayments = [] } = useQuery({
    queryKey: KEYS.dispatcher.prepayments(orderId),
    queryFn:  () => fetchOrderPrepayments(orderId),
    enabled:  !!orderId && open && !!(order?.prepayment_required || order?.prepayment_amount > 0),
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !order) return null

  const o           = fullOrder ?? order
  const customer    = resolveCustomer(o, customerMap)
  const courier     = resolveCourier(o, courierMap)
  const courierDisp = resolveCourierDisplay(o, courierMap)
  const address     = resolveAddress(o)
  const city        = resolveCity(o)
  const actions     = ACTIONS[o.status] ?? []
  const dot         = STATUS_HEX[o.status] ?? '#64748b'
  const isExpress   = o.delivery_method === 'express'

  const items        = Array.isArray(o.items)       ? o.items       : Array.isArray(o.order_items) ? o.order_items : []
  const attachments  = Array.isArray(o.attachments) ? o.attachments : []
  const courierId    = getCourierId(o)
  const courierEntry = courierId ? courierMap[courierId] : null
  const courierCash  = courierEntry?.cash_owed

  const productTotal    = Number(o.total_amount ?? 0)
  const deliveryFee     = Number(o.delivery_fee ?? 0)
  const totalOrderAmt   = Number(o.total_order_amount ?? (productTotal + deliveryFee))
  const prepayAmt       = Number(o.prepayment_amount ?? 0)
  const amountToCollect = Number(o.amount_to_collect ?? Math.max(0, totalOrderAmt - prepayAmt))
  const payLabel        = o.payment_label
  const prepayStatus    = o.prepayment_status ?? 'none'
  const prepayInfo      = PREPAY_STATUS[prepayStatus] ?? PREPAY_STATUS.none

  const sellerName  = o.seller?.full_name ?? o.seller_name ?? null
  const sellerPhone = o.seller?.phone ?? o.seller_phone ?? null
  const comment     = o.notes ?? o.comment ?? o.customer_comment
  const fullAddress = [address, city].filter(Boolean).join(', ')

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end sm:items-stretch sm:justify-end pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-fade-in pointer-events-auto"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="relative z-10 flex flex-col w-full sm:w-[480px] h-[94vh] sm:h-full rounded-t-2xl sm:rounded-none animate-slide-in-up sm:animate-slide-in-right pointer-events-auto"
        style={{ background: BG, borderTop: `1px solid ${BORDER}`, borderLeft: `1px solid ${BORDER2}` }}
        role="dialog"
        aria-modal="true"
        aria-label={`Заказ ${formatOrderLabel(order)}`}
      >
        {/* Mobile drag handle */}
        <div className="flex-shrink-0 flex justify-center pt-2.5 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full" style={{ background: BORDER2 }} />
        </div>

        {/* ── HEADER: ID · Status · Express · Total · Date · Close ──── */}
        <div
          className="flex-shrink-0 px-4 py-3 flex items-center gap-2"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
          <span className="text-sm font-bold font-mono" style={{ color: TEXT1 }}>#{formatOrderLabel(order)}</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: `${dot}18`, color: dot }}>
            {STATUS_LABELS[o.status] ?? o.status}
          </span>
          {isExpress && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: `${AMBER}18`, color: AMBER }}>
              ⚡ Экспресс
            </span>
          )}
          {/* Total amount */}
          <span className="text-xs font-bold tabular-nums ml-auto flex-shrink-0" style={{ color: TEXT2 }}>
            {fmt(totalOrderAmt)} сом
          </span>
          <span className="text-[10px] font-mono flex-shrink-0" style={{ color: TEXT3 }}>{fmtDate(o.created_at)}</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors flex-shrink-0"
            style={{ color: TEXT3 }}
            onMouseEnter={e => e.currentTarget.style.background = '#F0EFEA'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            aria-label="Закрыть"
          >
            <X size={14} />
          </button>
        </div>

        {/* ── PRIORITY HERO: Customer · Address · Comment · Collect ──── */}
        <div
          className="flex-shrink-0 px-4 py-3"
          style={{ borderBottom: `1px solid ${BORDER}`, background: PANEL }}
        >
          <div className="flex items-start justify-between gap-3">
            {/* Customer block — name + phone + address + comment */}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5">
                <User size={11} style={{ color: TEXT3 }} />
                <span className="text-sm font-bold truncate" style={{ color: TEXT1 }}>
                  {customer?.full_name ?? '—'}
                </span>
              </div>
              {customer?.phone && (
                <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 w-fit">
                  <Phone size={10} style={{ color: BLUE }} />
                  <span className="text-xs font-mono" style={{ color: BLUE }}>{customer.phone}</span>
                </a>
              )}
              {fullAddress && (
                <div className="flex items-start gap-1.5">
                  <MapPin size={10} className="flex-shrink-0 mt-0.5" style={{ color: TEXT3 }} />
                  <span className="text-xs leading-snug" style={{ color: TEXT2 }}>{fullAddress}</span>
                </div>
              )}
              {comment && (
                <div className="flex items-start gap-1.5 rounded-lg px-2 py-1.5 mt-0.5" style={{ background: `${AMBER}09`, border: `1px solid ${AMBER}20` }}>
                  <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: `${AMBER}80` }}>💬</span>
                  <span className="text-[11px] leading-snug" style={{ color: `${AMBER}cc` }}>{comment}</span>
                </div>
              )}
            </div>

            {/* Amount to collect */}
            <div className="flex-shrink-0 text-right">
              <div className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: TEXT3 }}>Получить</div>
              {amountToCollect > 0
                ? <div className="text-xl font-bold tabular-nums leading-none" style={{ color: VIOLET }}>
                    {fmt(amountToCollect)}
                    <span className="text-[10px] font-normal ml-0.5" style={{ color: TEXT3 }}>сом</span>
                  </div>
                : <div className="text-sm font-bold" style={{ color: GREEN }}>✓ Оплачено</div>
              }
              {prepayInfo.label && (
                <div className="text-[9px] mt-0.5" style={{ color: prepayInfo.color }}>{prepayInfo.label}</div>
              )}
            </div>
          </div>

          {/* Courier — shown once here, no separate section below */}
          {courierDisp.name ? (
            <div className="flex items-center gap-2 mt-2 pt-2" style={{ borderTop: `1px solid ${BORDER2}` }}>
              <Truck size={10} style={{ color: courierDisp.status === 'delivered_by' ? GREEN : TEXT3 }} />
              <span className="text-xs" style={{ color: TEXT2 }}>{courierDisp.name}</span>
              {courier?.phone && (
                <a href={`tel:${courier.phone}`} className="text-xs font-mono" style={{ color: BLUE }}>· {courier.phone}</a>
              )}
              {courierDisp.label && (
                <span className="text-[10px]" style={{ color: TEXT3 }}>· {courierDisp.label}</span>
              )}
              {courierCash > 0 && (
                <span className="text-[10px] ml-auto tabular-nums" style={{ color: AMBER }}>💰 {fmt(courierCash)} сом</span>
              )}
            </div>
          ) : ['confirmed', 'new'].includes(o.status) ? (
            <div className="flex items-center gap-2 mt-2 pt-2" style={{ borderTop: `1px solid ${BORDER2}` }}>
              <Truck size={10} style={{ color: TEXT3 }} />
              <span className="text-[11px] italic" style={{ color: TEXT3 }}>Курьер не назначен</span>
            </div>
          ) : null}
        </div>

        {/* ── SCROLLABLE BODY ───────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── PRODUCTS (compact cards) ────────────────────────────── */}
          <SectionHeader icon={<Package size={10} />} title={`Товары${items.length ? ` · ${items.length}` : ''}`} />
          <div style={{ borderBottom: `1px solid ${BORDER2}` }}>
            {loadingOrder && items.length === 0 ? (
              <div className="px-4 pb-3"><Skeleton lines={2} /></div>
            ) : items.length > 0 ? (
              <div className="px-4 pb-2 space-y-0">
                {items.map((item, i) => (
                  <div
                    key={item.id ?? i}
                    className="flex items-baseline justify-between gap-3 py-1.5"
                    style={{ borderBottom: i < items.length - 1 ? `1px solid ${BORDER2}` : 'none' }}
                  >
                    <span className="text-xs leading-snug min-w-0 flex-1" style={{ color: TEXT1 }}>
                      {item.product_name ?? item.name ?? <span style={{ color: TEXT3 }}>—</span>}
                      <span className="ml-1.5 text-[10px]" style={{ color: TEXT3 }}>×{item.quantity ?? 1}</span>
                    </span>
                    <span className="text-xs font-semibold tabular-nums flex-shrink-0" style={{ color: TEXT2 }}>
                      {fmt(item.total_price ?? item.price ?? 0)} сом
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 pb-3 text-xs italic" style={{ color: TEXT3 }}>Состав не указан</div>
            )}
          </div>

          {/* ── PAYMENT (compact: products · delivery · prepay · collect) */}
          <SectionHeader icon={<Banknote size={10} />} title="Финансы" />
          <div style={{ borderBottom: `1px solid ${BORDER2}` }}>
            <div className="mx-4 mb-3 rounded-xl p-3 space-y-1.5" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
              <PayRow label="Товары"                     value={`${fmt(productTotal)} сом`} />
              <PayRow
                label={`Доставка${isExpress ? ' ⚡' : ''}`}
                value={deliveryFee > 0 ? `${fmt(deliveryFee)} сом` : 'Бесплатно'}
                valueColor={deliveryFee > 0 ? AMBER : GREEN}
              />
              {prepayAmt > 0 && (
                <PayRow
                  label={payLabel === 'full_prepayment' ? 'Предоплата (полная)' : 'Предоплата (частичная)'}
                  value={`−${fmt(prepayAmt)} сом`}
                  valueColor={GREEN}
                />
              )}
              <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8, marginTop: 4 }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold" style={{ color: TEXT2 }}>Курьер получит</span>
                  {amountToCollect > 0
                    ? <span className="text-base font-bold tabular-nums" style={{ color: VIOLET }}>{fmt(amountToCollect)} сом</span>
                    : <span className="text-sm font-bold" style={{ color: GREEN }}>✓ Оплачено</span>
                  }
                </div>
              </div>
            </div>

            {/* Prepayment status actions */}
            {prepayStatus === 'pending_verification' && (
              <div className="mx-4 mb-3 rounded-xl p-3" style={{ background: `${AMBER}09`, border: `1px solid ${AMBER}25` }}>
                <div className="text-xs font-semibold mb-2" style={{ color: AMBER }}>⏳ Предоплата ожидает подтверждения</div>
                {o.prepayment_comment && (
                  <div className="text-[11px] mb-2.5 leading-relaxed" style={{ color: `${AMBER}99` }}>{o.prepayment_comment}</div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => onAction('verify_prepayment', order)}
                    disabled={isVerifyingPrepayment}
                    className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    style={{ background: GREEN }}
                  >
                    {isVerifyingPrepayment
                      ? <Loader2 size={11} className="inline mr-1 animate-spin" />
                      : <CheckCircle size={11} className="inline mr-1" />}
                    Подтвердить
                  </button>
                  <button
                    onClick={() => onAction('reject_prepayment', order)}
                    disabled={isVerifyingPrepayment}
                    className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-colors disabled:opacity-60"
                    style={{ border: `1px solid ${RED}40`, color: RED }}
                    onMouseEnter={e => e.currentTarget.style.background = `${RED}10`}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <XCircle size={11} className="inline mr-1" />Отклонить
                  </button>
                </div>
              </div>
            )}
            {prepayStatus === 'verified' && (
              <div className="mx-4 mb-3 flex items-center gap-2 text-xs" style={{ color: GREEN }}>
                <CheckCircle size={12} />
                <span>Предоплата подтверждена</span>
                {o.prepayment_verified_at && <span style={{ color: TEXT3 }}>· {fmtDate(o.prepayment_verified_at)}</span>}
              </div>
            )}
            {prepayStatus === 'rejected' && o.prepayment_rejection_reason && (
              <div className="mx-4 mb-3 rounded-xl p-2.5" style={{ background: `${RED}09`, border: `1px solid ${RED}25` }}>
                <div className="text-[10px] font-bold mb-1" style={{ color: `${RED}80` }}>Предоплата отклонена</div>
                <div className="text-xs" style={{ color: `${RED}cc` }}>{o.prepayment_rejection_reason}</div>
              </div>
            )}

            {/* Prepayment records */}
            {prepayments.length > 0 && (
              <div className="mx-4 mb-3">
                <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: TEXT3 }}>Записи предоплат</div>
                {prepayments.map((p, i) => (
                  <div key={p.id ?? i} className="flex items-center justify-between py-1.5" style={{ borderBottom: i < prepayments.length - 1 ? `1px solid ${BORDER2}` : 'none' }}>
                    <div>
                      <div className="text-xs font-semibold tabular-nums" style={{ color: TEXT1 }}>{fmt(p.amount)} сом</div>
                      <div className="text-[10px]" style={{ color: TEXT3 }}>{fmtDate(p.created_at)}</div>
                    </div>
                    {p.verified_at
                      ? <span className="text-[10px] font-bold" style={{ color: GREEN }}>✓ Подтверждена</span>
                      : <span className="text-[10px]" style={{ color: AMBER }}>Ожидает</span>
                    }
                  </div>
                ))}
              </div>
            )}

            {/* Attachments */}
            {!o.status || (o.status !== 'cancelled' && o.status !== 'returned') ? (
              <div className="mx-4 mb-3">
                <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: TEXT3 }}>
                  Файлы {attachments.length > 0 ? `· ${attachments.length}` : ''}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => attachmentFileRef.current?.click()}
                    disabled={addAttachmentMut.isPending}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl aspect-square transition-opacity"
                    style={{ background: CARD, border: `1px dashed ${BORDER}`, opacity: addAttachmentMut.isPending ? 0.5 : 1 }}
                  >
                    {addAttachmentMut.isPending
                      ? <Loader2 size={16} className="animate-spin" style={{ color: TEXT3 }} />
                      : <Paperclip size={16} style={{ color: TEXT3 }} />}
                    <span className="text-[9px]" style={{ color: TEXT3 }}>Прикрепить</span>
                  </button>
                  <input ref={attachmentFileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleAttachmentFileChange} />
                  {attachments.map((att) => {
                    // (\?|$) — not just $ — since a media-pipeline signed
                    // URL has a query string after the extension
                    // (/media/private/<key>.webp?sig=...&expires=...),
                    // unlike a legacy /uploads/<file> URL.
                    const isImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(att.file_url ?? '')
                    return (
                      <a
                        key={att.id}
                        href={att.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="group relative rounded-xl overflow-hidden block aspect-square"
                        style={{ background: CARD, border: `1px solid ${BORDER}` }}
                        title={att.type === 'payment_proof' ? 'Скриншот оплаты' : att.type === 'customer_chat' ? 'Переписка' : 'Файл'}
                      >
                        {isImage ? (
                          <>
                            <img src={att.file_url} alt="proof" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.5)' }}>
                              <ZoomIn size={16} style={{ color: '#fff' }} />
                            </div>
                          </>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                            <span className="text-2xl">{att.type === 'customer_chat' ? '💬' : '📄'}</span>
                            <span className="text-[9px]" style={{ color: TEXT3 }}>
                              {att.type === 'payment_proof' ? 'Оплата' : att.type === 'customer_chat' ? 'Чат' : 'Файл'}
                            </span>
                          </div>
                        )}
                        <div className="absolute bottom-1 left-1">
                          <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.65)', color: 'rgba(255,255,255,0.85)' }}>
                            {att.type === 'payment_proof' ? 'Оплата' : att.type === 'customer_chat' ? 'Чат' : 'Файл'}
                          </span>
                        </div>
                      </a>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {/* ── Issue reason ─────────────────────────────────────────── */}
          {o.status === 'issue' && (o.issue_comment ?? o.issue_reason) && (
            <div style={{ borderBottom: `1px solid ${BORDER2}` }}>
              <SectionHeader icon={<AlertCircle size={10} />} title="Причина проблемы" color={RED} />
              <div className="mx-4 mb-3 rounded-xl p-2.5" style={{ background: `${RED}09`, border: `1px solid ${RED}22` }}>
                <div className="text-xs leading-relaxed" style={{ color: `${RED}cc` }}>
                  {o.issue_comment ?? o.issue_reason}
                </div>
              </div>
            </div>
          )}

          {/* ── ИСТОРИЯ (collapsed by default) ─────────────────────── */}
          <CollapsibleSection
            title={`История${timeline.length ? ` (${timeline.length})` : ''}`}
            icon={<Clock size={10} />}
            defaultCollapsed
          >
            <div className="px-4 pb-4">
              {loadingTimeline ? (
                <Skeleton lines={3} />
              ) : timeline.length > 0 ? (
                timeline.map((ev, i) => {
                  const cfg    = TIMELINE_LABELS[ev.to_status] ?? { label: ev.to_status, dot: TEXT3 }
                  const isLast = i === timeline.length - 1
                  return (
                    <div key={ev.id ?? i} className="flex gap-3">
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div className="w-2 h-2 rounded-full mt-0.5 flex-shrink-0"
                          style={{ background: cfg.dot, boxShadow: `0 0 6px ${cfg.dot}70` }} />
                        {!isLast && <div className="w-px flex-1 mt-1.5" style={{ background: BORDER, minHeight: '18px' }} />}
                      </div>
                      <div className={`${isLast ? '' : 'pb-3'} min-w-0 flex-1`}>
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-xs font-semibold" style={{ color: TEXT1 }}>{cfg.label}</span>
                          {ev.actor_name && <span className="text-[10px]" style={{ color: TEXT3 }}>· {ev.actor_name}</span>}
                        </div>
                        <div className="text-[10px] font-mono mt-0.5" style={{ color: TEXT3 }}>{fmtDate(ev.created_at)}</div>
                        {ev.comment && <div className="text-[11px] mt-1 leading-snug italic" style={{ color: TEXT2 }}>"{ev.comment}"</div>}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="text-xs italic" style={{ color: TEXT3 }}>История не найдена</div>
              )}
            </div>
          </CollapsibleSection>

          {/* ── КОММЕНТАРИИ (collapsed by default) ───────────────────── */}
          <CollapsibleSection
            title="Комментарии"
            icon={<MessageSquare size={10} />}
            defaultCollapsed
          >
            <CommentsSection orderId={orderId} open={open} />
          </CollapsibleSection>

          {/* ── ДОПОЛНИТЕЛЬНО: seller + metadata (collapsed by default) */}
          <CollapsibleSection
            title="Дополнительно"
            icon={<Users size={10} />}
            defaultCollapsed
          >
            <div className="px-4 pb-3 space-y-2">
              {sellerName ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px]" style={{ color: TEXT3 }}>Продавец</span>
                    <span className="text-xs" style={{ color: TEXT2 }}>{sellerName}</span>
                  </div>
                  {sellerPhone && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px]" style={{ color: TEXT3 }}>Тел. продавца</span>
                      <a href={`tel:${sellerPhone}`} className="text-xs font-mono" style={{ color: BLUE }}>{sellerPhone}</a>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs italic" style={{ color: TEXT3 }}>Продавец не указан</div>
              )}
              {o.created_at && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: TEXT3 }}>Создан</span>
                  <span className="text-[10px] font-mono" style={{ color: TEXT3 }}>{fmtDate(o.created_at)}</span>
                </div>
              )}
            </div>
          </CollapsibleSection>

        </div>

        {/* ── STICKY FOOTER: action buttons ─────────────────────────── */}
        {actions.length > 0 && (
          <div
            className="flex-shrink-0 px-4 py-3 space-y-2"
            style={{ borderTop: `1px solid ${BORDER}`, background: PANEL }}
          >
            <div className="flex gap-2">
              {actions.filter(a => a.primary).map(a => (
                <button
                  key={a.key}
                  onClick={() => onAction(a.key, order)}
                  disabled={a.key === 'confirm' && isConfirming}
                  className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
                >
                  {a.key === 'confirm' && isConfirming
                    ? <Loader2 size={13} className="inline mr-1 animate-spin" />
                    : null}
                  {a.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              {actions.filter(a => a.ghost).map(a => (
                <button
                  key={a.key}
                  onClick={() => onAction(a.key, order)}
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-colors"
                  style={{ border: `1px solid ${BORDER}`, color: TEXT2 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F0EFEA'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {a.label}
                </button>
              ))}
              {actions.filter(a => a.danger).map(a => (
                <button
                  key={a.key}
                  onClick={() => onAction(a.key, order)}
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-colors"
                  style={{ border: `1px solid ${RED}35`, color: RED }}
                  onMouseEnter={e => e.currentTarget.style.background = `${RED}10`}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ── Sub-components ─────────────────────────────────────────────────── */

function SectionHeader({ title, icon, color }) {
  return (
    <div className="flex items-center gap-1.5 px-4 pt-3 pb-2">
      <span style={{ color: color ?? TEXT3 }}>{icon}</span>
      <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: color ?? TEXT3 }}>{title}</span>
    </div>
  )
}

function CollapsibleSection({ title, icon, children, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  return (
    <div style={{ borderBottom: `1px solid ${BORDER2}` }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-1.5 px-4 pt-3 pb-3 transition-colors"
        onMouseEnter={e => e.currentTarget.style.background = '#F7F6F2'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span style={{ color: TEXT3 }}>{icon}</span>
        <span className="text-[9px] font-bold uppercase tracking-widest flex-1 text-left" style={{ color: TEXT3 }}>{title}</span>
        {collapsed
          ? <ChevronDown size={10} style={{ color: TEXT3 }} />
          : <ChevronUp size={10} style={{ color: TEXT3 }} />
        }
      </button>
      {!collapsed && children}
    </div>
  )
}

function PayRow({ label, value, valueColor, bold }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px]" style={{ color: TEXT3 }}>{label}</span>
      <span className={`text-[11px] tabular-nums ${bold ? 'font-bold' : 'font-medium'}`} style={{ color: valueColor ?? TEXT2 }}>{value}</span>
    </div>
  )
}

function CommentsSection({ orderId, open }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')

  const { data: comments = [], isPending: loading, isError } = useQuery({
    queryKey: KEYS.dispatcher.comments(orderId),
    queryFn:  () => fetchComments(orderId),
    enabled:  !!orderId && open,
    retry:    false,
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
    <div className="px-4 pb-4">
      {loading && <Skeleton lines={2} />}
      {isError && (
        <div className="text-xs italic py-2" style={{ color: `${AMBER}99` }}>Комментарии недоступны</div>
      )}
      {!loading && !isError && comments.length === 0 && (
        <div className="flex items-center gap-1.5 py-2">
          <MessageSquare size={11} style={{ color: TEXT3 }} />
          <span className="text-xs italic" style={{ color: TEXT3 }}>Нет комментариев</span>
        </div>
      )}
      {!loading && Array.isArray(comments) && comments.map((c, i) => (
        <div key={c.id ?? i} className="rounded-xl p-2.5 mb-2" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[11px] font-semibold" style={{ color: TEXT1 }}>
              {c.author_name ?? c.author?.full_name ?? c.created_by ?? 'Система'}
            </span>
            <span className="text-[10px] font-mono" style={{ color: TEXT3 }}>{fmtDate(c.created_at)}</span>
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: TEXT2 }}>{c.comment ?? c.text}</p>
        </div>
      ))}
      <div className="mt-2 flex gap-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={2}
          placeholder="Добавить комментарий…"
          className="flex-1 resize-none rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: CARD, border: `1px solid ${BORDER}`, color: TEXT1, lineHeight: 1.5 }}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey && text.trim()) submit() }}
        />
        <button
          onClick={() => text.trim() && submit()}
          disabled={!text.trim() || sending}
          className="self-end flex items-center justify-center rounded-xl transition-opacity"
          style={{
            width: 36, height: 36, flexShrink: 0,
            background: text.trim() ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#F0EFEA',
            color: text.trim() ? '#fff' : TEXT3,
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
      <p className="text-[9px] mt-1.5" style={{ color: TEXT3 }}>Ctrl + Enter для отправки</p>
    </div>
  )
}

function Skeleton({ lines = 3 }) {
  return (
    <div className="space-y-2 py-1">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded animate-pulse" style={{ background: '#F0EFEA', width: `${60 + (i % 3) * 15}%` }} />
      ))}
    </div>
  )
}
