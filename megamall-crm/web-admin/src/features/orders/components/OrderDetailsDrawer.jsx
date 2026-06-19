/**
 * OrderDetailsDrawer — right-side slide-in drawer for order detail.
 *
 * Shows:
 *   - Customer: name, phone, address
 *   - Order: product, qty, total, delivery fee, net revenue
 *   - Assignment: seller, manager, team lead, team
 *   - Financial breakdown from finance events (if available)
 *
 * Owner read-only — no action buttons for order workflow.
 */
import { X, User2, Package, Users2, TrendingUp, Loader2 } from 'lucide-react'
import Badge from '../../../shared/components/Badge'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { useOwnerOrder, useOrderFinanceEvents } from '../hooks/useOwnerOrder'
import { formatOrderLabel } from '../../../features/dispatcher/utils/orderHelpers'

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

  // ── Resolve fields ──────────────────────────────────────────────────────
  function field(...keys) {
    for (const k of keys) if (order[k] != null) return order[k]
    return null
  }

  const customerName  = field('customer_name', 'CustomerName') ??
    order.customer?.full_name ?? order.customer?.name ?? '—'
  const customerPhone = field('customer_phone', 'CustomerPhone') ??
    order.customer?.phone ?? null
  const address = field('delivery_address', 'address', 'Address') ??
    order.customer?.address ?? null

  const productName = field('product_name', 'ProductName') ??
    order.product?.name ?? order.product?.Name ?? '—'
  const qty         = field('quantity', 'Quantity', 'qty') ?? 1
  const total       = field('total_amount', 'amount', 'total', 'Amount') ?? 0
  const deliveryFee = field('delivery_fee', 'DeliveryFee', 'courier_fee') ?? 0
  const netRevenue  = field('net_revenue', 'NetRevenue', 'company_revenue')

  function lookupUser(idFields) {
    for (const f of idFields) {
      const uid = order[f]
      if (!uid) continue
      const u = userMap[uid]
      return u ? (u.full_name ?? u.FullName) : uid.slice(0, 8)
    }
    return null
  }
  const seller   = lookupUser(['seller_id', 'SellerID'])
  const manager  = lookupUser(['manager_id', 'ManagerID'])
  const teamLead = lookupUser(['team_lead_id', 'TeamLeadID'])
  const teamId   = field('team_id', 'TeamID')
  const team     = teamId ? (teamMap[teamId]?.name ?? teamId.slice(0, 8)) : null

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
        <Row label="Имя"    value={customerName} />
        <Row label="Телефон" value={customerPhone} />
        {address && <Row label="Адрес" value={address} />}
      </Section>

      {/* Order */}
      <Section icon={<Package size={14} />} title="Заказ">
        <Row label="Товар"          value={productName} />
        <Row label="Количество"     value={qty} />
        <Row label="Сумма"          value={`${fmtAmount(total)} сомони`} accent="text-slate-900 font-bold" />
        {deliveryFee > 0 && <Row label="Доставка" value={`${fmtAmount(deliveryFee)} сомони`} />}
        {netRevenue != null && (
          <Row label="Чистая выручка" value={`${fmtAmount(netRevenue)} сомони`} accent="text-emerald-700" />
        )}
      </Section>

      {/* Assignment */}
      <Section icon={<Users2 size={14} />} title="Ответственные">
        {seller   && <Row label="Продавец"           value={seller} />}
        {manager  && <Row label="Менеджер"           value={manager} />}
        {teamLead && <Row label="Руководитель группы" value={teamLead} />}
        {team     && <Row label="Команда"            value={team} />}
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
                value={`${fmtAmount(e.amount)} сомони`}
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {orderId && (
            <OrderContent orderId={orderId} userMap={userMap} teamMap={teamMap} />
          )}
        </div>
      </div>
    </>
  )
}
