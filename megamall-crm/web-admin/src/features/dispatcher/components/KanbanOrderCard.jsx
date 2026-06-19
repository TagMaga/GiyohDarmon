import { useState, useRef, useEffect, memo } from 'react'
import {
  MapPin, Truck, Banknote, Calendar, Zap, Clock,
  MoreHorizontal, CreditCard, Package, UserPlus,
} from 'lucide-react'
import {
  STATUS_ACTIONS, STATUS_HEX, fmt, fmtDate,
  orderAge, orderAgeMinutes, isUrgent, isOverdue, isToday, isTomorrow,
} from '../statusConfig'
import { resolveCustomer, resolveAddress, resolveCity } from '../utils/resolveCustomer'
import { resolveCourier, resolveCourierDisplay, getCourierId, getOrderId, formatOrderLabel } from '../utils/orderHelpers'

const KanbanOrderCard = memo(function KanbanOrderCard({
  order, onAction, customerMap = {}, courierMap = {}, onClick, isSelected,
}) {
  const [menuOpen,   setMenuOpen]   = useState(false)
  const [isHovered,  setIsHovered]  = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e) { if (!menuRef.current?.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const actions   = STATUS_ACTIONS[order.status] ?? []
  const customer  = resolveCustomer(order, customerMap)
  const courier   = resolveCourier(order, courierMap)
  const courierDisp = resolveCourierDisplay(order, courierMap)
  const address   = resolveAddress(order)
  const city      = resolveCity(order)
  const accent    = STATUS_HEX[order.status] ?? STATUS_HEX.new
  const age       = orderAge(order)
  const ageMin    = orderAgeMinutes(order)
  const urgent    = isUrgent(order)
  const overdue   = isOverdue(order)

  // Urgency: 0-29m neutral, 30-59m amber, 60+ red
  const ageColor = ageMin >= 60 ? '#ef4444' : ageMin >= 30 ? '#f59e0b' : null
  const ageBg    = ageMin >= 60 ? 'rgba(239,68,68,0.14)' : ageMin >= 30 ? 'rgba(245,158,11,0.12)' : undefined

  const schedule    = order.delivery_date || order.scheduled_at
  const todayDel    = isToday(schedule)
  const tomorrowDel = isTomorrow(schedule)
  const scheduleText = !todayDel && !tomorrowDel && schedule ? fmtDate(schedule) : null

  const isCash    = order.payment_method === 'cash' || order.payment_method === 'наличные'
  const isCard    = order.payment_method && !isCash
  const prepayPending = order.prepayment_status === 'pending_verification'

  const itemCount   = (order.items ?? order.order_items ?? []).length
  const courierLoad = courierMap[getCourierId(order)]?.active_orders

  // Unassigned confirmed orders need to stand out — eyes should go here first
  const isUnassigned = order.status === 'confirmed' && !courier?.full_name

  // Primary actions: skip comment, max 2
  const primaryActions = actions.filter((a) => a.key !== 'comment').slice(0, 2)

  function handleDragStart(e) {
    e.dataTransfer.setData('orderId', getOrderId(order))
    e.dataTransfer.setData('orderStatus', order.status)
    e.dataTransfer.effectAllowed = 'move'
  }

  const effectiveAccent = isUnassigned ? '#f59e0b' : accent

  const hoverShadow = isHovered
    ? `0 4px 20px ${effectiveAccent}28, 0 0 0 1px ${effectiveAccent}45`
    : isSelected
    ? `0 0 0 1px #6366f166`
    : isUnassigned
    ? '0 2px 14px rgba(245,158,11,0.16)'
    : undefined

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={() => onClick?.(order)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: isSelected
          ? 'rgba(99,102,241,0.10)'
          : isUnassigned
          ? isHovered ? 'rgba(245,158,11,0.06)' : 'rgba(245,158,11,0.03)'
          : isHovered ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
        borderTopColor:    isSelected ? '#6366f1' : 'rgba(255,255,255,0.07)',
        borderRightColor:  isSelected ? '#6366f1' : 'rgba(255,255,255,0.07)',
        borderBottomColor: isSelected ? '#6366f1' : 'rgba(255,255,255,0.07)',
        borderLeftColor:   isUnassigned ? '#f59e0b' : accent,
        borderLeftWidth:   '3px',
        borderLeftStyle:   'solid',
        boxShadow:         hoverShadow,
        transform:         isHovered && !isSelected ? 'translateY(-1px)' : undefined,
        transition:        'background 150ms ease, box-shadow 150ms ease, transform 150ms ease',
      }}
      className="relative rounded-xl border cursor-pointer select-none p-2.5 pl-3 group"
    >
      {/* Row 1: order number + alert badge + age + menu */}
      <div className="flex items-center justify-between gap-1.5 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-[12px] font-bold text-white leading-none tracking-tight">
            #{formatOrderLabel(order)}
          </span>
          {(urgent || overdue) && (
            <span
              className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5' }}
            >
              {overdue ? <Clock size={8} /> : <Zap size={8} />}
              {overdue ? 'ПРОСРОЧЕН' : 'СРОЧНО'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {age && (
            ageColor ? (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded font-mono tabular-nums"
                style={{ background: ageBg, color: ageColor }}
              >
                {age}
              </span>
            ) : (
              <span className="text-[9px] text-white/22 font-mono tabular-nums">{age}</span>
            )
          )}
          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o) }}
              className="p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-white/10 transition-opacity text-white/40 hover:text-white/80"
              aria-label="Действия"
            >
              <MoreHorizontal size={13} />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 min-w-[148px] rounded-xl overflow-hidden shadow-2xl py-1"
                style={{ background: '#1a2035', border: '1px solid rgba(255,255,255,0.10)' }}
                onClick={(e) => e.stopPropagation()}
              >
                {actions.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => { onAction(a.key, order); setMenuOpen(false) }}
                    className={[
                      'w-full text-left px-3 py-1.5 text-[11px] transition-colors',
                      a.variant === 'danger'   ? 'text-rose-400 hover:bg-rose-500/10'
                        : a.variant === 'primary' ? 'text-indigo-300 hover:bg-indigo-500/10'
                        : 'text-white/65 hover:bg-white/5',
                    ].join(' ')}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: customer name + phone */}
      <p className={`text-[12px] font-semibold leading-snug truncate ${customer._fallback ? 'text-white/30 italic' : 'text-white/88'}`}>
        {customer.full_name ?? '…'}
      </p>
      {customer.phone && (
        <p className="text-[10px] text-white/38 font-mono mt-0.5 tabular-nums">{customer.phone}</p>
      )}

      {/* Row 3: address (compact, 1 line) */}
      {address && (
        <div className="flex items-center gap-1 mt-1">
          <MapPin size={9} className="text-white/22 flex-shrink-0" />
          <p className="text-[10px] text-white/38 leading-snug truncate">
            {address}
          </p>
        </div>
      )}

      {/* Row 4: chips — city / items / date / payment / prepay */}
      {(city || itemCount > 0 || todayDel || tomorrowDel || scheduleText || isCash || isCard || prepayPending) && (
        <div className="flex items-center gap-1 flex-wrap mt-1.5">
          {city && (
            <Chip color="#0ea5e9" icon={<MapPin size={8} />}>{city}</Chip>
          )}
          {itemCount > 0 && (
            <Chip color="#64748b" icon={<Package size={8} />}>{itemCount}</Chip>
          )}
          {todayDel && (
            <Chip color="#10b981" icon={<Calendar size={8} />}>Сегодня</Chip>
          )}
          {tomorrowDel && (
            <Chip color="#f59e0b" icon={<Calendar size={8} />}>Завтра</Chip>
          )}
          {scheduleText && (
            <Chip color="#64748b" icon={<Calendar size={8} />}>{scheduleText}</Chip>
          )}
          {isCash && (
            <Chip color="#10b981" icon={<Banknote size={8} />}>Наличные</Chip>
          )}
          {isCard && (
            <Chip color="#8b5cf6" icon={<CreditCard size={8} />}>Карта</Chip>
          )}
          {prepayPending && (
            <Chip color="#f97316">Предоплата?</Chip>
          )}
        </div>
      )}

      {/* Row 5: amount + courier */}
      <div
        className="flex items-center justify-between gap-2 mt-2 pt-2"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
      >
        <span className="text-[13px] font-bold text-white tabular-nums leading-none">
          {fmt(order.total_amount)}
          <span className="text-[9px] font-normal text-white/35 ml-0.5">сом</span>
        </span>
        {courierDisp.name ? (
          <span className="flex items-center gap-1 min-w-0">
            <Truck size={10} className={`flex-shrink-0 ${courierDisp.status === 'delivered_by' ? 'text-emerald-400/80' : 'text-amber-400/70'}`} />
            <span className="text-[10px] text-white/55 max-w-[78px] truncate">{courierDisp.name}</span>
            {courierDisp.status !== 'delivered_by' && courierLoad != null && (
              <span
                className="text-[8px] font-bold px-1 rounded tabular-nums flex-shrink-0"
                style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
              >
                {courierLoad}
              </span>
            )}
          </span>
        ) : isUnassigned ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: '#f59e0b' }}>
            <UserPlus size={9} className="flex-shrink-0" /> Нужен курьер
          </span>
        ) : (
          <span className="text-[10px] text-white/22 italic">Без курьера</span>
        )}
      </div>

      {/* Row 6: primary actions */}
      {primaryActions.length > 0 && (
        <div className="flex gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
          {primaryActions.map((a) => (
            <button
              key={a.key}
              onClick={() => onAction(a.key, order)}
              className={[
                'flex-1 text-[11px] font-semibold py-1.5 px-2 rounded-lg transition-colors min-h-[32px]',
                a.variant === 'primary'
                  ? 'bg-indigo-500/90 hover:bg-indigo-500 text-white'
                  : a.variant === 'danger'
                  ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20'
                  : 'bg-white/5 hover:bg-white/10 text-white/55 border border-white/8',
              ].join(' ')}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

export default KanbanOrderCard

function Chip({ color, icon, children }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded"
      style={{ background: `${color}1e`, color }}
    >
      {icon}{children}
    </span>
  )
}
