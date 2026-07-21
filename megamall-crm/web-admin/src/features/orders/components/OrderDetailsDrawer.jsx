/**
 * OrderDetailsDrawer — right-side slide-in drawer for order detail.
 *
 * Shows:
 *   - Customer: name, phone, address
 *   - Order: product, qty, total, delivery fee, net revenue
 *   - Prepayment: status and any submitted proof screenshots
 *   - Files: order attachments (e.g. payment proof, customer chat)
 *   - Assignment: seller, manager, team lead, team
 *   - Financial breakdown from finance events (if available)
 *
 * Owner read-only — no action buttons for order workflow.
 */
import { useState } from 'react'
import { X, User2, Package, Users2, TrendingUp, Loader2, MessageCircle, Banknote, Paperclip, ZoomIn, CheckCircle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import Badge from '../../../shared/components/Badge'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { useOwnerOrder, useOrderFinanceEvents } from '../hooks/useOwnerOrder'
import { formatOrderLabel } from '../../../features/dispatcher/utils/orderHelpers'
import { fetchCities } from '../../seller/api'
import { fetchOrderPrepayments } from '../../dispatcher/api'
import { KEYS } from '../../../shared/queryKeys'
import OrderCommentsPanel from './OrderCommentsPanel'

const PREPAY_STATUS_LABEL = {
  pending_verification: { label: '⏳ Ожидает проверки',       accent: 'text-amber-700' },
  verified:             { label: '✓ Предоплата подтверждена', accent: 'text-emerald-700' },
  rejected:             { label: '✗ Отклонена',               accent: 'text-rose-600' },
}

function ProofThumb({ url, title }) {
  if (!url) return null
  const isImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={title}
      className="group relative flex-shrink-0 w-9 h-9 rounded-lg overflow-hidden block border border-slate-200 bg-slate-50"
    >
      {isImage ? (
        <>
          <img src={url} alt={title} className="w-full h-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50">
            <ZoomIn size={12} className="text-white" />
          </div>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-base">📄</div>
      )}
    </a>
  )
}

const EVENT_LABEL = {
  seller_commission:       'Комиссия продавца',
  manager_team_commission: 'Комиссия менеджера (команда)',
  manager_personal_commission: 'Комиссия менеджера (личные)',
  team_lead_pool:          'Пул руководителя',
  company_revenue:         'Выручка компании',
  delivery_fee:            'Тариф доставки',
  courier_payout:          'Выплата курьеру',
  prepayment:              'Предоплата',
}

function Section({ icon, title, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 flex-shrink-0">
          {icon}
        </span>
        <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">{title}</p>
      </div>
      <div className="pl-9 space-y-2">{children}</div>
    </div>
  )
}

function Row({ label, value, accent }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-xs font-semibold ${accent ?? 'text-slate-800'}`}>
        {value ?? '—'}
      </span>
    </div>
  )
}

function OrderContent({ orderId, userMap, teamMap }) {
  const { data: order, isLoading: orderLoading } = useOwnerOrder(orderId)
  const { data: events = [], isLoading: eventsLoading } = useOrderFinanceEvents(orderId)
  const { data: cities = [] } = useQuery({
    queryKey: KEYS.seller.cities,
    queryFn: fetchCities,
    staleTime: 10 * 60 * 1000,
  })
  const citiesById = Object.fromEntries(cities.map((c) => [c.id, c.name]))

  const { data: prepayments = [] } = useQuery({
    queryKey: KEYS.dispatcher.prepayments(orderId),
    queryFn:  () => fetchOrderPrepayments(orderId),
    enabled:  !!orderId && !!(order?.prepayment_required || order?.prepayment_amount > 0),
    staleTime: 30_000,
  })

  if (orderLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={22} className="animate-spin text-indigo-400" />
      </div>
    )
  }

  if (!order) {
    return <p className="text-sm text-slate-400 text-center py-8">Заказ не найден</p>
  }

  const status = order.status ?? order.Status ?? ''

  function field(...keys) {
    for (const k of keys) if (order[k] != null) return order[k]
    return null
  }

  const customerName  = field('customer_name', 'CustomerName') ??
    order.customer?.full_name ?? order.customer?.name ?? '—'
  const customerPhone = field('customer_phone', 'CustomerPhone') ??
    order.customer?.phone ?? null
  const deliveryAddress = field('delivery_address') ?? null
  const cityId = order.city_id ?? order.CityID ?? null
  const cityName = cityId ? (citiesById[cityId] ?? null) : null
  const customerNote = order.notes ?? null

  const total       = field('total_order_amount', 'total_amount', 'amount', 'total', 'Amount') ?? 0
  const deliveryFee = field('delivery_fee', 'DeliveryFee') ?? 0
  const courierPayout = field('courier_payout', 'CourierPayout') ?? 0
  const netRevenue  = field('net_revenue', 'NetRevenue') ?? (Number(total) - Number(deliveryFee))

  function lookupUser(idFields) {
    for (const f of idFields) {
      const uid = order[f]
      if (!uid) continue
      const u = userMap[uid]
      return u ? (u.full_name ?? u.FullName) : uid.slice(0, 8)
    }
    return null
  }
  const sellerName   = order.seller?.full_name ?? lookupUser(['seller_id', 'SellerID'])
  const sellerPhone  = order.seller?.phone ?? null
  const manager  = lookupUser(['manager_id', 'ManagerID'])
  const teamLead = lookupUser(['team_lead_id', 'TeamLeadID'])
  const teamId   = field('team_id', 'TeamID')
  const team     = teamId ? (teamMap[teamId]?.name ?? teamId.slice(0, 8)) : null

  // Items list (when available from single-order fetch)
  const items = order.items ?? []
  const attachments = Array.isArray(order.attachments) ? order.attachments : []
  const prepayAmt = Number(field('prepayment_amount', 'PrepaymentAmount') ?? 0)
  const prepayStatus = field('prepayment_status', 'PrepaymentStatus')
  const prepayInfo = prepayStatus ? PREPAY_STATUS_LABEL[prepayStatus] : null

  return (
    <div className="space-y-6">
      {/* Status badge */}
      <div className="flex items-center gap-2">
        <Badge variant={STATUS_BADGE[status] ?? 'slate'}>
          {STATUS_LABELS[status] ?? status}
        </Badge>
        <span className="text-xs text-slate-400">{fmtDate(order.created_at ?? order.CreatedAt)}</span>
      </div>

      {/* Customer */}
      <Section icon={<User2 size={14} />} title="Клиент">
        <Row label="Имя"     value={customerName} />
        <Row label="Телефон" value={customerPhone} />
        {cityName       && <Row label="Город" value={cityName} />}
        {deliveryAddress && <Row label="Адрес" value={deliveryAddress} />}
        {customerNote   && <Row label="Комментарий клиента" value={customerNote} accent="text-amber-700" />}
      </Section>

      {/* Order items */}
      <Section icon={<Package size={14} />} title="Заказ">
        {items.length > 0
          ? items.map((it, i) => (
              <Row
                key={it.id ?? i}
                label={`${it.product_name ?? '—'} × ${it.quantity}`}
                value={`${fmtAmount(it.total_price)} с`}
              />
            ))
          : null}
        <Row label="Сумма товаров"  value={`${fmtAmount(field('total_amount', 'TotalAmount') ?? 0)} с`} accent="text-slate-900 font-bold" />
        {deliveryFee > 0 && <Row label="Доставка"       value={`${fmtAmount(deliveryFee)} с`} />}
        {courierPayout > 0 && <Row label="Тариф курьера" value={`${fmtAmount(courierPayout)} с`} />}
        {courierPayout > 0 && (
          <Row
            label="Комиссионная база"
            value={`${fmtAmount(Number(total) - Number(courierPayout))} с`}
            accent="text-indigo-700"
          />
        )}
        <Row label="Итого к оплате" value={`${fmtAmount(total)} с`} accent="text-slate-900 font-bold" />
        <Row label="Чистая выручка" value={`${fmtAmount(netRevenue)} с`} accent="text-emerald-700" />
      </Section>

      {/* Prepayment */}
      {(prepayAmt > 0 || prepayments.length > 0) && (
        <Section icon={<Banknote size={14} />} title="Предоплата">
          {prepayInfo && (
            <div className={`text-xs font-semibold ${prepayInfo.accent}`}>{prepayInfo.label}</div>
          )}
          {prepayments.map((p, i) => (
            <div key={p.id ?? i} className="flex items-center justify-between gap-2 py-1">
              <div className="flex items-center gap-2 min-w-0">
                <ProofThumb url={p.proof_url} title="Скриншот оплаты" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold tabular-nums text-slate-800">{fmtAmount(p.amount)} с</div>
                  <div className="text-[10px] text-slate-400">{fmtDate(p.created_at)}</div>
                </div>
              </div>
              {p.verified_at
                ? <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 flex-shrink-0"><CheckCircle size={11} />Подтверждена</span>
                : <span className="text-[10px] text-amber-700 flex-shrink-0">Ожидает</span>
              }
            </div>
          ))}
        </Section>
      )}

      {/* Files */}
      {attachments.length > 0 && (
        <Section icon={<Paperclip size={14} />} title={`Файлы · ${attachments.length}`}>
          <div className="flex flex-wrap gap-2">
            {attachments.map((att) => (
              <ProofThumb
                key={att.id}
                url={att.file_url}
                title={att.type === 'payment_proof' ? 'Скриншот оплаты' : att.type === 'customer_chat' ? 'Переписка' : 'Файл'}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Assignment */}
      <Section icon={<Users2 size={14} />} title="Ответственные">
        {sellerName  && <Row label="Продавец" value={sellerName} />}
        {sellerPhone && <Row label="Телефон продавца" value={sellerPhone} />}
        {manager     && <Row label="Менеджер"           value={manager} />}
        {teamLead    && <Row label="Руководитель группы" value={teamLead} />}
        {team        && <Row label="Команда"            value={team} />}
      </Section>

      {/* Financial breakdown */}
      {(eventsLoading || events.length > 0) && (
        <Section icon={<TrendingUp size={14} />} title="Финансовое распределение">
          {eventsLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 size={13} className="animate-spin" /> Загрузка…
            </div>
          ) : (
            events.map((e, i) => (
              <Row
                key={e.id ?? i}
                label={EVENT_LABEL[e.event_type] ?? e.event_type}
                value={`${fmtAmount(e.amount)} с`}
                accent={e.amount >= 0 ? 'text-emerald-700' : 'text-rose-600'}
              />
            ))
          )}
        </Section>
      )}
    </div>
  )
}

// ── Drawer shell ─────────────────────────────────────────────────────────────

export default function OrderDetailsDrawer({ order, onClose, userMap = {}, teamMap = {} }) {
  const [tab, setTab] = useState('details')
  const open = !!order
  const orderId = open
    ? (order.id ?? order.ID ?? order.order_id ?? null)
    : null

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-slate-900/40 z-40 transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 right-0 w-full sm:w-[440px] bg-white z-50 shadow-2xl flex flex-col
          transform transition-transform duration-250 ease-out ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <p className="text-sm font-bold text-slate-900">
              Заказ {order ? formatOrderLabel(order) : ''}
            </p>
            <p className="text-xs text-slate-400">Детали заказа</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 pt-3 border-b border-slate-100">
          <div className="flex gap-2">
            {[
              { id: 'details', label: 'Детали' },
              { id: 'comments', label: 'Комментарии' },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`px-3 py-2 text-xs font-bold rounded-t-xl transition-colors ${
                  tab === item.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-400 hover:text-slate-700'
                }`}
              >
                {item.id === 'comments' && <MessageCircle size={13} className="inline mr-1" />}
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {orderId && tab === 'details' && (
            <OrderContent orderId={orderId} userMap={userMap} teamMap={teamMap} />
          )}
          {orderId && tab === 'comments' && <OrderCommentsPanel orderId={orderId} compact />}
        </div>
      </div>
    </>
  )
}
