import { Users, ChevronLeft } from 'lucide-react'
import { fmt } from '../../statusConfig'

function initials(name = '') {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return (parts[0][0] ?? '?').toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

const AVATAR_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6']
function avatarColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

export default function DispatcherCourierRail({
  couriers = [],
  selectedCourier,
  onSelect,
  onCollapse,
  highlightCourierId = null,  // current order's assigned courier (amber tint)
  pendingCourierId   = null,  // user-targeted courier for quick assign (indigo CTA)
}) {
  const total       = couriers.length
  const free        = couriers.filter(c => Number(c.active_orders ?? 0) === 0 && c.order_intake_enabled !== false).length
  const intakeOff   = couriers.filter(c => c.order_intake_enabled === false).length

  return (
    <div className="w-[260px] flex-shrink-0 border-l border-slate-100 flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <Users size={13} className="text-slate-400" />
        <span className="text-xs font-bold text-slate-700 flex-1">Курьеры</span>
        <span className="text-[10px] text-slate-400">{total}</span>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
            title="Скрыть"
          >
            <ChevronLeft size={13} />
          </button>
        )}
      </div>

      {/* Summary chips */}
      <div className="flex gap-1.5 px-4 py-2 flex-shrink-0">
        <Chip label="Свободны" value={free}      color="emerald" />
        <Chip label="Не прин." value={intakeOff} color="rose" />
      </div>

      {/* Unassigned filter */}
      <div className="px-3 pb-2 flex-shrink-0">
        <button
          onClick={() => onSelect(selectedCourier === 'unassigned' ? null : 'unassigned')}
          className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
            selectedCourier === 'unassigned'
              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
              : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          Без курьера
        </button>
      </div>

      {/* Courier list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
        {couriers.length === 0 ? (
          <div className="py-8 text-center">
            <Users size={24} className="mx-auto text-slate-200 mb-2" />
            <p className="text-xs text-slate-400">Нет курьеров</p>
          </div>
        ) : (
          couriers.map(courier => {
            const id = courier.courier_id ?? courier.id
            return (
              <CourierCard
                key={id}
                courier={courier}
                selected={selectedCourier === id}
                highlighted={highlightCourierId === id}
                pending={pendingCourierId === id}
                onSelect={onSelect}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

function Chip({ label, value, color }) {
  const cls = color === 'emerald'
    ? 'bg-emerald-50 text-emerald-700'
    : 'bg-rose-50 text-rose-600'
  return (
    <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold ${cls}`}>
      <span className="font-black">{value}</span>
      <span>{label}</span>
    </div>
  )
}

function CourierCard({ courier, selected, highlighted, pending, onSelect }) {
  const id         = courier.courier_id ?? courier.id
  const name       = courier.full_name ?? 'Курьер'
  const active     = Number(courier.active_orders ?? 0)
  const assigned   = Number(courier.assigned_orders ?? 0)
  const inDelivery = Number(courier.in_delivery ?? 0)
  const cash       = Number(courier.cash_owed ?? 0)
  const intake     = courier.order_intake_enabled !== false
  const color      = avatarColor(name)

  const dotCls = !intake ? 'bg-rose-400' : active > 0 ? 'bg-amber-400' : 'bg-emerald-400'

  const breakdown = [
    assigned   > 0 && `${assigned} назн.`,
    inDelivery > 0 && `${inDelivery} в пути`,
  ].filter(Boolean).join(' · ')

  // Visual priority: pending > highlighted > selected > default
  let containerCls
  if (pending) {
    containerCls = 'bg-indigo-50 border border-indigo-400 ring-1 ring-indigo-300'
  } else if (highlighted) {
    containerCls = 'bg-amber-50 border border-amber-200'
  } else if (selected) {
    containerCls = 'bg-indigo-50 border border-indigo-200'
  } else {
    containerCls = 'hover:bg-slate-50 border border-transparent'
  }

  return (
    <button
      onClick={() => onSelect(pending ? null : id)}
      className={`w-full text-left p-2.5 rounded-xl transition-colors ${containerCls} ${!intake ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2">
        {/* Avatar + status dot */}
        <div className="relative flex-shrink-0">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
            style={{ background: color }}
          >
            {initials(name)}
          </div>
          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${dotCls}`} />
        </div>

        {/* Name + stats */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-slate-800 truncate leading-tight">{name}</div>
          <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">
            {active === 0
              ? <span className="text-emerald-600 font-medium">Свободен</span>
              : <span>{active} акт.{breakdown ? ` (${breakdown})` : ''}</span>
            }
            {cash > 0 && (
              <span className="text-amber-600 font-semibold ml-1">· {fmt(cash)} с.</span>
            )}
          </div>
        </div>
      </div>

      {/* Pending label: quick-assign ready */}
      {pending && (
        <div className="mt-1.5 text-[10px] font-bold text-indigo-600 text-right">
          → Назначить
        </div>
      )}

      {/* Highlighted label: currently assigned to selected order */}
      {highlighted && !pending && (
        <div className="mt-0.5 text-[10px] font-medium text-amber-600">
          Назначен на заказ
        </div>
      )}

      {/* Load bar */}
      {active > 0 && (
        <div className="mt-1.5 h-1 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              active >= 5 ? 'bg-rose-400' : active >= 3 ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
            style={{ width: `${Math.min(100, (active / 6) * 100)}%` }}
          />
        </div>
      )}

      {!intake && courier.order_intake_reason && (
        <p className="text-[10px] text-rose-500 mt-0.5 truncate">{courier.order_intake_reason}</p>
      )}
    </button>
  )
}
