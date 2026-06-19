import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import {
  X, Phone, MapPin, User, Truck, Package, Clock,
  Banknote, CheckCircle, XCircle, AlertCircle, ZoomIn,
  ShoppingBag, CreditCard, Wallet, Users,
} from 'lucide-react'
import { KEYS } from '../../../shared/queryKeys'
import { STATUS_HEX, fmt, fmtDate } from '../statusConfig'
import { resolveCustomer, resolveAddress, resolveCity } from '../utils/resolveCustomer'
import { resolveCourier, resolveCourierDisplay, formatOrderLabel, getCourierId } from '../utils/orderHelpers'
import { fetchOrderDetail, fetchOrderTimeline, fetchOrderPrepayments } from '../api'

/* ── Design tokens (dark CRM) ──────────────────────────────────────── */
const BG      = '#0a111e'
const PANEL   = '#0d1525'
const CARD    = '#111d30'
const BORDER  = 'rgba(255,255,255,0.07)'
const BORDER2 = 'rgba(255,255,255,0.04)'
const TEXT1   = 'rgba(255,255,255,0.90)'
const TEXT2   = 'rgba(255,255,255,0.55)'
const TEXT3   = 'rgba(255,255,255,0.28)'
const BLUE    = '#3b82f6'
const GREEN   = '#10b981'
const AMBER   = '#f59e0b'
const RED     = '#ef4444'
const VIOLET  = '#8b5cf6'

const STATUS_LABELS = {
  new: 'Новый', confirmed: 'Подтверждён', assigned: 'Назначен',
  in_delivery: 'В пути', delivered: 'Доставлен',
  returned: 'Возврат', issue: 'Проблема', cancelled: 'Отменён',
  prepayment_pending: 'Ожидает предоплату', prepayment_received: 'Предоплата получена',
}

const PREPAY_STATUS = {
  none:                 { label: 'Без предоплаты',    color: TEXT3 },
  pending_verification: { label: '⏳ Ожидает проверки', color: AMBER },
  verified:             { label: '✓ Подтверждена',    color: GREEN },
  rejected:             { label: '✗ Отклонена',       color: RED },
}

const RECEIVER_LABELS = {
  dispatcher_card: 'Карта диспетчера',
  company_card:    'Карта компании',
  cash:            'Наличные',
  other:           'Другое',
}

const TIMELINE_LABELS = {
  new:                  { label: 'Создан',               dot: STATUS_HEX.new ?? '#64748b' },
  confirmed:            { label: 'Подтверждён',          dot: STATUS_HEX.confirmed ?? BLUE },
  prepayment_pending:   { label: 'Ожидает предоплату',   dot: AMBER },
  prepayment_received:  { label: 'Предоплата получена',  dot: GREEN },
  assigned:             { label: 'Назначен курьеру',     dot: STATUS_HEX.assigned ?? VIOLET },
  in_delivery:          { label: 'В доставке',           dot: STATUS_HEX.in_delivery ?? AMBER },
  delivered:            { label: 'Доставлен',            dot: STATUS_HEX.delivered ?? GREEN },
  returned:             { label: 'Возврат',              dot: STATUS_HEX.returned ?? RED },
  issue:                { label: 'Проблема',             dot: STATUS_HEX.issue ?? RED },
  cancelled:            { label: 'Отменён',              dot: STATUS_HEX.cancelled ?? RED },
}

const DELIVERY_LABELS = {
  express: { label: 'Экспресс', color: AMBER, icon: '⚡' },
  normal:  { label: 'Обычная',  color: TEXT3,  icon: '📦' },
}

const ACTIONS = {
  new:                  [{ key: 'confirm', label: 'Подтвердить',   primary: true  }, { key: 'cancel', label: 'Отменить', danger: true }],
  confirmed:            [{ key: 'assign',  label: 'Назначить курьера', primary: true }, { key: 'cancel', label: 'Отменить', danger: true }],
  prepayment_pending:   [{ key: 'cancel', label: 'Отменить', danger: true }],
  assigned:             [{ key: 'reassign', label: 'Переназначить', primary: true }, { key: 'unassign', label: 'Снять курьера', ghost: true }, { key: 'cancel', label: 'Отменить', danger: true }],
  in_delivery:          [{ key: 'unassign', label: 'Снять курьера', ghost: true }, { key: 'issue', label: 'Проблема', ghost: true }, { key: 'cancel', label: 'Отменить', danger: true }],
  issue:                [{ key: 'resolve', label: 'Решить проблему', primary: true }, { key: 'unassign', label: 'Снять курьера', ghost: true }, { key: 'cancel', label: 'Отменить', danger: true }],
  returned:             [],
  delivered:            [],
  cancelled:            [],
}

export default function OrderDrawer({ order, open, onClose, onAction, customerMap = {}, courierMap = {} }) {
  const orderId = order?.id ?? order?.order_id

  // Fetch full detail when drawer opens
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

  // Merge board order (fast) with full detail (enriched)
  const o        = fullOrder ?? order
  const customer = resolveCustomer(o, customerMap)
  const courier  = resolveCourier(o, courierMap)
  const courierDisp = resolveCourierDisplay(o, courierMap)
  const address  = resolveAddress(o)
  const city     = resolveCity(o)
  const actions  = ACTIONS[o.status] ?? []
  const dot      = STATUS_HEX[o.status] ?? '#64748b'
  const deliv    = DELIVERY_LABELS[o.delivery_method] ?? DELIVERY_LABELS.normal

  const items       = Array.isArray(o.items)       ? o.items       : Array.isArray(o.order_items) ? o.order_items : []
  const attachments = Array.isArray(o.attachments) ? o.attachments : []
  const courierId   = getCourierId(o)
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

  const sellerName = o.seller?.full_name ?? o.seller_name ?? null
  const sellerPhone = o.seller?.phone ?? o.seller_phone ?? null

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
          <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
        </div>

        {/* ── HEADER ──────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 px-4 py-3 flex items-center justify-between gap-3"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
            <span className="text-sm font-bold font-mono" style={{ color: TEXT1 }}>#{formatOrderLabel(order)}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: `${dot}18`, color: dot }}>
              {STATUS_LABELS[o.status] ?? o.status}
            </span>
            {o.delivery_method === 'express' && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: `${AMBER}18`, color: AMBER }}>
                ⚡ Экспресс
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] font-mono" style={{ color: TEXT3 }}>{fmtDate(o.created_at)}</span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: TEXT3 }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              aria-label="Закрыть"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── PRIORITY HERO ─────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 px-4 py-3"
          style={{ borderBottom: `1px solid ${BORDER}`, background: PANEL }}
        >
          {/* Client + amount row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <User size={11} style={{ color: TEXT3 }} />
                <span className="text-sm font-bold truncate" style={{ color: TEXT1 }}>
                  {customer?.full_name ?? '—'}
                </span>
              </div>
              {customer?.phone && (
                <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 mb-1 group w-fit">
                  <Phone size={10} style={{ color: BLUE }} />
                  <span className="text-xs font-mono" style={{ color: BLUE }}>{customer.phone}</span>
                </a>
              )}
              {sellerName && (
                <div className="flex items-center gap-1.5">
                  <Users size={10} style={{ color: TEXT3 }} />
                  <span className="text-[11px]" style={{ color: TEXT2 }}>{sellerName}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)', color: TEXT3 }}>продавец</span>
                </div>
              )}
            </div>
            <div className="flex-shrink-0 text-right">
              <div className="text-[10px] mb-0.5" style={{ color: TEXT3 }}>Курьер получит</div>
              {amountToCollect > 0
                ? <div className="text-xl font-bold tabular-nums" style={{ color: VIOLET }}>{fmt(amountToCollect)}<span className="text-xs font-normal ml-1" style={{ color: TEXT3 }}>сом</span></div>
                : <div className="text-base font-bold" style={{ color: GREEN }}>Оплачено</div>
              }
              <div className="text-[10px] mt-0.5" style={{ color: prepayInfo.color }}>{prepayInfo.label}</div>
            </div>
          </div>

          {/* Courier chip */}
          {courierDisp.name ? (
            <div className="flex items-center gap-2 mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${BORDER2}` }}>
              <Truck size={10} style={{ color: courierDisp.status === 'delivered_by' ? '#10b981' : TEXT3 }} />
              <span className="text-xs" style={{ color: TEXT2 }}>{courierDisp.name}</span>
              {courier?.phone && <span className="text-xs font-mono" style={{ color: BLUE }}>· {courier.phone}</span>}
              {courierDisp.label && (
                <span className="text-[10px]" style={{ color: TEXT3 }}>· {courierDisp.label}</span>
              )}
            </div>
          ) : ['confirmed', 'new'].includes(o.status) ? (
            <div className="flex items-center gap-2 mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${BORDER2}` }}>
              <Truck size={10} style={{ color: TEXT3 }} />
              <span className="text-[11px] italic" style={{ color: TEXT3 }}>Курьер не назначен</span>
            </div>
          ) : null}
        </div>

        {/* ── SCROLLABLE BODY ───────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── 1. CLIENT ─────────────────────────────────────────── */}
          <Section title="Клиент" icon={<User size={10} />}>
            <div className="px-4 pb-3 space-y-2">
              <Row label="Имя" value={customer?.full_name ?? '—'} />
              {customer?.phone && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: TEXT3 }}>Телефон</span>
                  <a href={`tel:${customer.phone}`} className="text-xs font-mono" style={{ color: BLUE }}>{customer.phone}</a>
                </div>
              )}
              {city && <Row label="Город" value={city} />}
              {address && (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[10px] flex-shrink-0" style={{ color: TEXT3 }}>Адрес</span>
                  <span className="text-xs text-right leading-snug" style={{ color: TEXT2 }}>{address}</span>
                </div>
              )}
              {(o.notes ?? o.comment ?? o.customer_comment) && (
                <div className="rounded-lg p-2.5 mt-1" style={{ background: `${AMBER}09`, border: `1px solid ${AMBER}20` }}>
                  <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: `${AMBER}80` }}>Комментарий</div>
                  <div className="text-xs leading-relaxed" style={{ color: `${AMBER}cc` }}>{o.notes ?? o.comment ?? o.customer_comment}</div>
                </div>
              )}
            </div>
          </Section>

          {/* ── 2. SELLER ─────────────────────────────────────────── */}
          <Section title="Продавец / Создатель" icon={<Users size={10} />}>
            <div className="px-4 pb-3 space-y-2">
              {sellerName ? (
                <>
                  <Row label="Имя" value={sellerName} />
                  {sellerPhone && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px]" style={{ color: TEXT3 }}>Телефон</span>
                      <a href={`tel:${sellerPhone}`} className="text-xs font-mono" style={{ color: BLUE }}>{sellerPhone}</a>
                    </div>
                  )}
                  <Row label="Роль" value="Продавец" />
                </>
              ) : loadingOrder ? (
                <Skeleton lines={2} />
              ) : (
                <div className="text-xs italic" style={{ color: TEXT3 }}>Данные продавца недоступны</div>
              )}
            </div>
          </Section>

          {/* ── 3. PRODUCTS ───────────────────────────────────────── */}
          <Section title={`Товары${items.length ? ` · ${items.length}` : ''}`} icon={<Package size={10} />}>
            {loadingOrder && items.length === 0 ? (
              <div className="px-4 pb-3"><Skeleton lines={3} /></div>
            ) : items.length > 0 ? (
              <div className="px-4 pb-3">
                {/* Table header */}
                <div className="grid gap-2 pb-1.5 mb-1" style={{ gridTemplateColumns: '1fr auto auto auto', borderBottom: `1px solid ${BORDER2}` }}>
                  {['Наименование', 'Кол', 'Цена', 'Сумма'].map(h => (
                    <span key={h} className="text-[9px] font-bold uppercase tracking-wide" style={{ color: TEXT3 }}>{h}</span>
                  ))}
                </div>
                {items.map((item, i) => (
                  <div key={item.id ?? i} className="grid gap-2 py-1.5" style={{ gridTemplateColumns: '1fr auto auto auto', borderBottom: i < items.length - 1 ? `1px solid ${BORDER2}` : 'none' }}>
                    <span className="text-xs leading-snug" style={{ color: TEXT1 }}>
                      {item.product_name ?? item.name ?? <span style={{ color: TEXT3 }}>—</span>}
                    </span>
                    <span className="text-xs tabular-nums" style={{ color: TEXT2 }}>×{item.quantity ?? 1}</span>
                    <span className="text-xs tabular-nums" style={{ color: TEXT2 }}>{fmt(item.unit_price ?? 0)}</span>
                    <span className="text-xs font-semibold tabular-nums" style={{ color: TEXT1 }}>{fmt(item.total_price ?? item.price ?? 0)}</span>
                  </div>
                ))}
                {/* Subtotal row */}
                <div className="flex items-center justify-between pt-2 mt-0.5" style={{ borderTop: `1px solid ${BORDER}` }}>
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: TEXT3 }}>Итого товары</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: TEXT1 }}>{fmt(productTotal)} сом</span>
                </div>
              </div>
            ) : (
              <div className="px-4 pb-3 text-xs italic" style={{ color: TEXT3 }}>Состав не указан</div>
            )}
          </Section>

          {/* ── 4. PAYMENT ────────────────────────────────────────── */}
          <Section title="Финансы и оплата" icon={<Banknote size={10} />}>
            <div className="mx-4 mb-3 rounded-xl p-3 space-y-2" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
              <PayRow label="Стоимость товаров" value={`${fmt(productTotal)} сом`} />
              <PayRow
                label={`Доставка (${deliv.label})`}
                value={deliveryFee > 0 ? `${fmt(deliveryFee)} сом` : 'Бесплатно'}
                valueColor={deliveryFee > 0 ? AMBER : GREEN}
              />
              <div style={{ borderTop: `1px solid ${BORDER2}`, paddingTop: 8 }}>
                <PayRow label="Итого заказ" value={`${fmt(totalOrderAmt)} сом`} bold />
              </div>
              {prepayAmt > 0 && (
                <>
                  <PayRow
                    label={payLabel === 'full_prepayment' ? 'Полная предоплата' : 'Частичная предоплата'}
                    value={`−${fmt(prepayAmt)} сом`}
                    valueColor={GREEN}
                  />
                  {o.prepayment_receiver && (
                    <PayRow label="Поступила на" value={RECEIVER_LABELS[o.prepayment_receiver] ?? o.prepayment_receiver} />
                  )}
                </>
              )}
              {prepayAmt === 0 && <PayRow label="Способ оплаты" value="Оплата при получении" />}
              <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold" style={{ color: TEXT2 }}>Курьер получит от клиента</span>
                  {amountToCollect > 0
                    ? <span className="text-base font-bold tabular-nums" style={{ color: VIOLET }}>{fmt(amountToCollect)} сом</span>
                    : <span className="text-sm font-bold" style={{ color: GREEN }}>✓ Оплачено полностью</span>
                  }
                </div>
              </div>
            </div>

            {/* Prepayment status + verify/reject */}
            {prepayStatus === 'pending_verification' && (
              <div className="mx-4 mb-3 rounded-xl p-3" style={{ background: `${AMBER}09`, border: `1px solid ${AMBER}25` }}>
                <div className="text-xs font-semibold mb-2" style={{ color: AMBER }}>⏳ Предоплата ожидает подтверждения</div>
                {o.prepayment_comment && (
                  <div className="text-[11px] mb-2.5 leading-relaxed" style={{ color: `${AMBER}99` }}>{o.prepayment_comment}</div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => onAction('verify_prepayment', order)}
                    className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: GREEN }}
                  >
                    <CheckCircle size={11} className="inline mr-1" />Подтвердить
                  </button>
                  <button
                    onClick={() => onAction('reject_prepayment', order)}
                    className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-colors"
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

            {/* Prepayment records list */}
            {prepayments.length > 0 && (
              <div className="mx-4 mb-3">
                <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: TEXT3 }}>Записи предоплат</div>
                {prepayments.map((p, i) => (
                  <div key={p.id ?? i} className="flex items-center justify-between py-2" style={{ borderBottom: i < prepayments.length - 1 ? `1px solid ${BORDER2}` : 'none' }}>
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

            {/* Attachment image grid */}
            {attachments.length > 0 && (
              <div className="mx-4 mb-3">
                <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: TEXT3 }}>
                  Файлы · {attachments.length}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {attachments.map((att) => {
                    const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(att.file_url ?? '')
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
                        {/* Type badge */}
                        <div className="absolute bottom-1 left-1">
                          <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.65)', color: TEXT2 }}>
                            {att.type === 'payment_proof' ? 'Оплата' : att.type === 'customer_chat' ? 'Чат' : 'Файл'}
                          </span>
                        </div>
                      </a>
                    )
                  })}
                </div>
                {/* Created dates per attachment */}
                <div className="space-y-1 mt-2">
                  {attachments.map((att) => (
                    <div key={`meta-${att.id}`} className="flex items-center gap-2">
                      <span className="text-[9px]" style={{ color: TEXT3 }}>{fmtDate(att.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* ── 5. COURIER ────────────────────────────────────────── */}
          <Section title="Курьер" icon={<Truck size={10} />}>
            <div className="px-4 pb-3">
              {courier?.full_name ? (
                <div className="rounded-xl p-3" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: `${VIOLET}25`, color: VIOLET }}>
                      {courier.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-semibold" style={{ color: TEXT1 }}>{courier.full_name}</div>
                      {courier.phone && <a href={`tel:${courier.phone}`} className="text-xs font-mono" style={{ color: BLUE }}>{courier.phone}</a>}
                    </div>
                  </div>
                  {courierCash > 0 && (
                    <div className="flex items-center gap-1.5 pt-2" style={{ borderTop: `1px solid ${BORDER2}` }}>
                      <Wallet size={10} style={{ color: AMBER }} />
                      <span className="text-[11px]" style={{ color: TEXT2 }}>На руках:</span>
                      <span className="text-[11px] font-bold" style={{ color: AMBER }}>{fmt(courierCash)} сом</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs italic" style={{ color: TEXT3 }}>Курьер не назначен</div>
              )}
            </div>
          </Section>

          {/* ── 6. TIMELINE ───────────────────────────────────────── */}
          <Section title="История" icon={<Clock size={10} />}>
            <div className="px-4 pb-4">
              {loadingTimeline ? (
                <Skeleton lines={4} />
              ) : timeline.length > 0 ? (
                timeline.map((ev, i) => {
                  const cfg = TIMELINE_LABELS[ev.to_status] ?? { label: ev.to_status, dot: TEXT3 }
                  const isLast = i === timeline.length - 1
                  return (
                    <div key={ev.id ?? i} className="flex gap-3">
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div className="w-2 h-2 rounded-full mt-0.5 flex-shrink-0"
                          style={{ background: cfg.dot, boxShadow: `0 0 6px ${cfg.dot}70` }} />
                        {!isLast && (
                          <div className="w-px flex-1 mt-1.5" style={{ background: BORDER, minHeight: '18px' }} />
                        )}
                      </div>
                      <div className={`${isLast ? '' : 'pb-3'} min-w-0 flex-1`}>
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-xs font-semibold" style={{ color: TEXT1 }}>{cfg.label}</span>
                          {ev.actor_name && (
                            <span className="text-[10px]" style={{ color: TEXT3 }}>· {ev.actor_name}</span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono mt-0.5" style={{ color: TEXT3 }}>{fmtDate(ev.created_at)}</div>
                        {ev.comment && (
                          <div className="text-[11px] mt-1 leading-snug italic" style={{ color: TEXT2 }}>"{ev.comment}"</div>
                        )}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="text-xs italic" style={{ color: TEXT3 }}>История не найдена</div>
              )}
            </div>
          </Section>

          {/* ── Issue reason ─────────────────────────────────────── */}
          {o.status === 'issue' && (o.issue_comment ?? o.issue_reason) && (
            <Section title="Причина проблемы" icon={<AlertCircle size={10} />}>
              <div className="mx-4 mb-3 rounded-xl p-2.5" style={{ background: `${RED}09`, border: `1px solid ${RED}22` }}>
                <div className="text-xs leading-relaxed" style={{ color: `${RED}cc` }}>
                  {o.issue_comment ?? o.issue_reason}
                </div>
              </div>
            </Section>
          )}

        </div>

        {/* ── STICKY FOOTER ─────────────────────────────────────────── */}
        {actions.length > 0 && (
          <div
            className="flex-shrink-0 px-4 py-3 space-y-2"
            style={{ borderTop: `1px solid ${BORDER}`, background: PANEL }}
          >
            {/* Primary actions */}
            <div className="flex gap-2">
              {actions.filter(a => a.primary).map(a => (
                <button
                  key={a.key}
                  onClick={() => onAction(a.key, order)}
                  className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {/* Secondary actions */}
            <div className="flex gap-2">
              <button
                onClick={() => onAction('comment', order)}
                className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-colors"
                style={{ border: `1px solid ${BORDER}`, color: TEXT2 }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                Комментарий
              </button>
              {actions.filter(a => a.ghost).map(a => (
                <button
                  key={a.key}
                  onClick={() => onAction(a.key, order)}
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-colors"
                  style={{ border: `1px solid ${BORDER}`, color: TEXT2 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
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

function Section({ title, icon, children }) {
  return (
    <div style={{ borderBottom: `1px solid ${BORDER2}` }}>
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-1.5">
        <span style={{ color: TEXT3 }}>{icon}</span>
        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: TEXT3 }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, bold }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[10px] flex-shrink-0" style={{ color: TEXT3 }}>{label}</span>
      <span className={`text-xs text-right leading-snug ${bold ? 'font-bold' : ''}`} style={{ color: bold ? TEXT1 : TEXT2 }}>{value}</span>
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

function Skeleton({ lines = 3 }) {
  return (
    <div className="space-y-2 py-1">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.06)', width: `${60 + (i % 3) * 15}%` }} />
      ))}
    </div>
  )
}
