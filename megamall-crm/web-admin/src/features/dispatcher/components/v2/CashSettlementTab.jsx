import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Phone } from 'lucide-react'
import { KEYS } from '../../../../shared/queryKeys'
import { fetchCashSettlement, fetchHandovers } from '../../api'
import { fmt, fmtDate } from '../../statusConfig'
import Skeleton from '../../../../shared/components/Skeleton'
import EmptyState from '../../../../shared/components/EmptyState'
import Badge from '../../../../shared/components/Badge'

const AVATAR_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6']
function avatarColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
function initials(name = '') {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return (parts[0][0] ?? '?').toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
function fmtDuration(seconds) {
  if (!seconds) return '—'
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}м`
  const h = Math.floor(m / 60), rem = m % 60
  return rem > 0 ? `${h}ч ${rem}м` : `${h}ч`
}

const HANDOVER_STATUS = {
  pending:   { label: 'Ожидает',  variant: 'amber'   },
  confirmed: { label: 'Принят',   variant: 'emerald' },
  disputed:  { label: 'Спор',     variant: 'rose'    },
  rejected:  { label: 'Отклонён', variant: 'slate'   },
}

export default function CashSettlementTab() {
  const [expanded, setExpanded] = useState({})

  const { data: settlementRaw, isLoading } = useQuery({
    queryKey: KEYS.dispatcher.cashSettlement({}),
    queryFn:  () => fetchCashSettlement(),
    staleTime: 60_000,
  })
  const { data: handoversRaw = [] } = useQuery({
    queryKey: KEYS.dispatcher.handovers,
    queryFn:  fetchHandovers,
    staleTime: 30_000,
  })

  const couriers  = Array.isArray(settlementRaw) ? settlementRaw : (settlementRaw?.data ?? [])
  const handovers = Array.isArray(handoversRaw)  ? handoversRaw  : (handoversRaw?.data  ?? [])

  const bycourier = handovers.reduce((acc, h) => {
    const cid = h.courier_id
    if (!cid) return acc
    if (!acc[cid]) acc[cid] = []
    acc[cid].push(h)
    return acc
  }, {})

  function toggle(id) { setExpanded(p => ({ ...p, [id]: !p[id] })) }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
      </div>
    )
  }
  if (couriers.length === 0) {
    return <EmptyState title="Нет данных" subtitle="Информация о расчётах появится здесь" />
  }

  return (
    <div className="space-y-2">
      {couriers.map(c => {
        const isOpen  = expanded[c.courier_id]
        const ch      = bycourier[c.courier_id] ?? []
        const pending = ch.filter(h => h.status === 'pending' || h.status === 'disputed')
        const rate    = c.success_rate != null ? Math.round(c.success_rate) : null
        const hasCash = Number(c.cash_debt ?? 0) > 0
        const color   = avatarColor(c.courier_name ?? '')

        return (
          <div key={c.courier_id} className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
            <button
              className="w-full text-left px-4 py-3 hover:bg-slate-50/60 transition-colors"
              onClick={() => toggle(c.courier_id)}
            >
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ background: color }}
                  >
                    {initials(c.courier_name ?? '')}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                    c.is_online ? 'bg-emerald-400' : 'bg-slate-300'
                  }`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800 truncate">{c.courier_name}</span>
                    {hasCash && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        Долг {fmt(c.cash_debt)} с.
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                    {c.active_orders > 0 && <span>{c.active_orders} акт.</span>}
                    <span>{c.delivered ?? 0} дост. · {c.failed ?? 0} ош.</span>
                    {rate != null && (
                      <span className={rate >= 90 ? 'text-emerald-600 font-semibold' : rate >= 70 ? 'text-amber-600' : 'text-rose-500 font-semibold'}>
                        {rate}%
                      </span>
                    )}
                    {c.avg_delivery_seconds > 0 && (
                      <span>⌛ {fmtDuration(c.avg_delivery_seconds)}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {pending.length > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                      {pending.length}
                    </span>
                  )}
                  {isOpen
                    ? <ChevronUp  size={14} className="text-slate-400" />
                    : <ChevronDown size={14} className="text-slate-400" />
                  }
                </div>
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/50 space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <StatCell value={c.delivered ?? 0}       label="Доставлено" />
                  <StatCell value={c.failed ?? 0}          label="Ошибок"    />
                  <StatCell value={`${fmt(c.cash_debt ?? 0)} с.`} label="Долг" accent={hasCash ? 'text-amber-600' : 'text-emerald-600'} />
                </div>

                {pending.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ожидающие сдачи</p>
                    {pending.map(h => (
                      <div key={h.id} className="bg-white rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-xs font-semibold text-slate-700">{fmt(h.total_to_return)} с.</span>
                          <span className="text-[10px] text-slate-400 ml-2">
                            {h.orders?.length ?? 0} заказ. · {fmtDate(h.created_at)}
                          </span>
                        </div>
                        <Badge variant={HANDOVER_STATUS[h.status]?.variant ?? 'amber'} size="sm">
                          {HANDOVER_STATUS[h.status]?.label ?? h.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}

                {pending.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-1">
                    {ch.length > 0 ? 'Все сдачи подтверждены' : 'Нет записей о сдаче'}
                  </p>
                )}

                {c.courier_phone && (
                  <a href={`tel:${c.courier_phone}`} className="flex items-center gap-1.5 text-xs text-indigo-600 font-medium hover:text-indigo-700">
                    <Phone size={11} />
                    {c.courier_phone}
                  </a>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StatCell({ value, label, accent }) {
  return (
    <div className="bg-white rounded-xl px-2 py-2">
      <div className={`text-xs font-bold ${accent ?? 'text-slate-800'}`}>{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  )
}
