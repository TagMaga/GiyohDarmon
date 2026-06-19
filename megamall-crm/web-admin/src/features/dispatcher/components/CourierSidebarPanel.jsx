import { useQuery } from '@tanstack/react-query'
import { Truck, Wallet } from 'lucide-react'
import { KEYS } from '../../../shared/queryKeys'
import { fetchCouriersOverview } from '../api'

// 0-3 orders → green, 4-8 → yellow, 9+ → red
function loadColor(active) {
  if (active <= 3) return '#10b981'
  if (active <= 8) return '#f59e0b'
  return '#ef4444'
}

/**
 * CourierSidebarPanel — live fleet grouped by workload.
 * Free couriers first, then busy. No fake online/offline — workload only.
 */
export default function CourierSidebarPanel({ onSelectCourier, activeCourier }) {
  const { data, isPending, isError } = useQuery({
    queryKey: KEYS.dispatcher.couriers,
    queryFn:  fetchCouriersOverview,
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  const couriers = Array.isArray(data) ? data : (data?.couriers ?? data?.data ?? [])
  const free = couriers.filter((c) => (c.active_orders ?? 0) === 0)
  // Sort busy couriers: least loaded first so dispatcher sees available capacity at top
  const busy = couriers
    .filter((c) => (c.active_orders ?? 0) > 0)
    .sort((a, b) => (a.active_orders ?? 0) - (b.active_orders ?? 0))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-2 pb-3 min-h-0">
        {isPending && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[56px] rounded-xl mb-2 mt-2 animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
        ))}

        {isError && (
          <p className="text-xs text-rose-400 text-center py-4">Ошибка загрузки</p>
        )}

        {!isPending && couriers.length === 0 && (
          <div className="flex flex-col items-center py-8 text-center">
            <Truck size={20} className="text-white/15 mb-2" />
            <p className="text-[11px] text-white/25">Нет курьеров</p>
          </div>
        )}

        {/* Free couriers */}
        {free.length > 0 && (
          <div className="mt-2">
            <p className="text-[9px] font-bold text-emerald-500/60 uppercase tracking-widest px-1 pb-1.5">
              Свободные · {free.length}
            </p>
            <div className="space-y-1">
              {free.map((c) => (
                <CourierRow
                  key={c.courier_id ?? c.id}
                  courier={c}
                  active={activeCourier === (c.courier_id ?? c.id)}
                  onSelect={onSelectCourier}
                />
              ))}
            </div>
          </div>
        )}

        {/* Busy couriers */}
        {busy.length > 0 && (
          <div className={free.length > 0 ? 'mt-3' : 'mt-2'}>
            <p className="text-[9px] font-bold text-amber-500/60 uppercase tracking-widest px-1 pb-1.5">
              На заказах · {busy.length}
            </p>
            <div className="space-y-1">
              {busy.map((c) => (
                <CourierRow
                  key={c.courier_id ?? c.id}
                  courier={c}
                  active={activeCourier === (c.courier_id ?? c.id)}
                  onSelect={onSelectCourier}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CourierRow({ courier, active, onSelect }) {
  const id       = courier.courier_id ?? courier.id
  const name     = courier.full_name ?? courier.courier?.full_name ?? 'Курьер'
  const phone    = courier.phone ?? courier.courier?.phone ?? ''
  const activeN  = courier.active_orders ?? 0
  const inDeliv  = courier.in_delivery ?? 0
  const cashOwed = courier.cash_owed ?? 0
  const color    = loadColor(activeN)

  return (
    <button
      onClick={() => onSelect?.(active ? null : id)}
      className="w-full text-left rounded-xl px-2.5 py-2 transition-colors hover:bg-white/5"
      style={{
        border: `1px solid ${active ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.05)'}`,
        background: active ? 'rgba(99,102,241,0.1)' : 'transparent',
      }}
    >
      <div className="flex items-center gap-2">
        {/* Avatar */}
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-[10px] font-bold text-white/70 flex-shrink-0">
          {name[0]?.toUpperCase() ?? '?'}
        </div>

        {/* Name + phone */}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white/85 truncate leading-tight">{name}</p>
          {phone && <p className="text-[9px] text-white/30 font-mono">{phone}</p>}
        </div>

        {/* Active orders badge */}
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 tabular-nums"
          style={{ background: `${color}22`, color }}
        >
          {activeN}
        </span>
      </div>

      {/* Stats row — only when courier has activity */}
      {(inDeliv > 0 || cashOwed > 0) && (
        <div className="flex items-center gap-3 mt-1.5 pl-8 text-[9px] text-white/35">
          {inDeliv > 0 && (
            <span className="flex items-center gap-0.5">
              <Truck size={8} className="text-white/25" />{inDeliv} в пути
            </span>
          )}
          {cashOwed > 0 && (
            <span className="flex items-center gap-0.5">
              <Wallet size={8} className="text-white/25" />{Math.round(cashOwed / 1000)}k
            </span>
          )}
        </div>
      )}
    </button>
  )
}
