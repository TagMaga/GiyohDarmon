/**
 * TeamLeadReportsPage — /team-lead/reports
 *
 * Period-filtered analytics for the team lead's own team.
 * No external chart libs — CSS bars + SVG sparkline (same pattern as OrdersAnalytics).
 *
 * Sections:
 *   1. Daily revenue trend (SVG polyline)
 *   2. Orders by status (horizontal CSS bars)
 *   3. Sellers ranking (bar list by order count)
 *   4. Conversion by seller (% delivered / total)
 */
import { useState, useMemo }  from 'react'
import { BarChart2, TrendingUp, Users, Target } from 'lucide-react'
import { CardSkeleton }       from '../../../shared/components/Skeleton'
import IncomePeriodFilter     from '../../hr/components/IncomePeriodFilter'
import { STATUS_LABELS }      from '../../../shared/orderStatusConfig'
import { fmtAmount }          from '../../../shared/orderStatusConfig'
import useMyTeam              from '../hooks/useMyTeam'
import useTeamMembers         from '../../people/hooks/useTeamMembers'
import useEmployeesByIds      from '../../people/hooks/useEmployeesByIds'
import { buildUserMap }       from '../../people/utils/peopleHelpers'
import useOwnerOrders         from '../../orders/hooks/useOwnerOrders'
import useCurrentUser         from '../../../shared/hooks/useCurrentUser'

// ── Section card wrapper ──────────────────────────────────────────────────────

function SectionCard({ icon, title, children, loading }) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
          {icon}
        </span>
        <p className="text-sm font-bold text-slate-800">{title}</p>
      </div>
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-4 bg-slate-100 rounded animate-pulse"/>)}</div>
      ) : children}
    </div>
  )
}

// ── Revenue trend (SVG) ───────────────────────────────────────────────────────

function RevenueTrend({ orders }) {
  const data = useMemo(() => {
    const m = {}
    orders.forEach(o => {
      const d = (o.created_at ?? o.CreatedAt ?? '').slice(0,10)
      if (!d) return
      m[d] = (m[d] ?? 0) + Number(o.net_revenue ?? o.total_amount ?? o.amount ?? 0)
    })
    return Object.entries(m).sort(([a],[b]) => a.localeCompare(b))
  }, [orders])

  if (data.length < 2) return <p className="text-xs text-slate-400 text-center py-4">Недостаточно данных для графика</p>

  const W=600, H=80, P=8
  const vals  = data.map(([,v]) => v)
  const minV  = Math.min(...vals), maxV = Math.max(...vals), range = maxV-minV||1

  const pts   = data.map(([,v],i) => {
    const x = P+(i/(data.length-1))*(W-P*2)
    const y = P+(1-(v-minV)/range)*(H-P*2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const area  = [`${P},${H-P}`,
    ...data.map(([,v],i) => {
      const x = P+(i/(data.length-1))*(W-P*2)
      const y = P+(1-(v-minV)/range)*(H-P*2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }),
    `${(W-P).toFixed(1)},${H-P}`
  ].join(' ')

  const total = vals.reduce((s,v)=>s+v,0)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{height:80}}>
        <defs>
          <linearGradient id="tlRevGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#6366f1" stopOpacity="0.2"/>
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#tlRevGrad)"/>
        <polyline points={pts} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
      </svg>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-slate-400">{data[0]?.[0]}</span>
        <span className="text-[10px] text-slate-400">{data[data.length-1]?.[0]}</span>
      </div>
      <p className="text-xs text-slate-500 mt-2">Итого: <strong className="text-slate-700">{fmtAmount(total)} сомони</strong></p>
    </div>
  )
}

// ── Status bar chart ──────────────────────────────────────────────────────────

const STATUS_COLOR = {
  new:'bg-indigo-500', confirmed:'bg-sky-500', in_delivery:'bg-amber-500',
  delivered:'bg-emerald-500', cancelled:'bg-slate-400', returned:'bg-orange-400', issue:'bg-rose-500',
}

function StatusChart({ orders }) {
  const data = useMemo(() => {
    const c = {}
    orders.forEach(o => { const s = o.status??o.Status??'unknown'; c[s]=(c[s]??0)+1 })
    return Object.entries(c).sort(([,a],[,b])=>b-a)
  }, [orders])
  const max = data[0]?.[1] ?? 1

  return (
    <div className="space-y-2.5">
      {data.map(([s,n]) => (
        <div key={s} className="flex items-center gap-3">
          <span className="text-[11px] text-slate-500 w-28 flex-shrink-0 truncate">{STATUS_LABELS[s]??s}</span>
          <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${STATUS_COLOR[s]??'bg-slate-400'}`} style={{width:`${(n/max)*100}%`}}/>
          </div>
          <span className="text-[11px] font-bold text-slate-700 w-6 text-right">{n}</span>
        </div>
      ))}
      {data.length===0 && <p className="text-xs text-slate-400 text-center py-3">Нет данных</p>}
    </div>
  )
}

// ── Sellers ranking ───────────────────────────────────────────────────────────

function SellersRanking({ orders, userMap }) {
  const data = useMemo(() => {
    const c = {}
    orders.forEach(o => { const id=o.seller_id??o.SellerID; if(id) c[id]=(c[id]??0)+1 })
    return Object.entries(c).sort(([,a],[,b])=>b-a).slice(0,10)
  }, [orders])

  const max = data[0]?.[1] ?? 1

  const name = (id) => {
    const u = userMap[id]
    return u ? (u.full_name ?? u.FullName ?? id.slice(0,8)) : id.slice(0,8)
  }

  return (
    <div className="space-y-2">
      {data.map(([id,n],i) => (
        <div key={id} className="flex items-center gap-3">
          <span className="text-[11px] font-bold text-slate-400 w-4 flex-shrink-0">{i+1}</span>
          <span className="text-[11px] text-slate-600 w-28 flex-shrink-0 truncate">{name(id)}</span>
          <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-indigo-500" style={{width:`${(n/max)*100}%`}}/>
          </div>
          <span className="text-[11px] font-bold text-slate-700 w-6 text-right">{n}</span>
        </div>
      ))}
      {data.length===0 && <p className="text-xs text-slate-400 text-center py-3">Нет данных</p>}
    </div>
  )
}

// ── Conversion by seller ──────────────────────────────────────────────────────

function ConversionBySeller({ orders, userMap }) {
  const data = useMemo(() => {
    const stats = {}
    orders.forEach(o => {
      const id = o.seller_id??o.SellerID
      if (!id) return
      if (!stats[id]) stats[id] = { total:0, delivered:0 }
      stats[id].total++
      if ((o.status??o.Status)==='delivered') stats[id].delivered++
    })
    return Object.entries(stats)
      .map(([id,s]) => [id, s.total>0 ? (s.delivered/s.total*100) : 0, s.total])
      .sort(([,a],[,b])=>b-a)
      .slice(0,10)
  }, [orders])

  const name = (id) => {
    const u = userMap[id]
    return u ? (u.full_name ?? u.FullName ?? id.slice(0,8)) : id.slice(0,8)
  }

  return (
    <div className="space-y-2">
      {data.map(([id, pct, total]) => (
        <div key={id} className="flex items-center gap-3">
          <span className="text-[11px] text-slate-600 w-28 flex-shrink-0 truncate">{name(id)}</span>
          <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{width:`${pct}%`}}/>
          </div>
          <span className="text-[11px] font-bold text-emerald-700 w-10 text-right">{pct.toFixed(0)}%</span>
          <span className="text-[10px] text-slate-400 w-12 text-right flex-shrink-0">{total} заказ.</span>
        </div>
      ))}
      {data.length===0 && <p className="text-xs text-slate-400 text-center py-3">Нет данных</p>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TeamLeadReportsPage() {
  const def = (() => {
    const now = new Date()
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10),
      to:   now.toISOString().slice(0,10),
    }
  })()

  const [from, setFrom] = useState(def.from)
  const [to,   setTo]   = useState(def.to)

  const { userId } = useCurrentUser()
  const { teamId } = useMyTeam()
  const { data: members = [] } = useTeamMembers(teamId)
  const memberIds = useMemo(() => members.map(m => m.user_id).filter(Boolean), [members])
  const { data: teamEmployees = [] } = useEmployeesByIds(memberIds)
  const userMap = useMemo(() => buildUserMap(teamEmployees), [teamEmployees])

  const orderParams = useMemo(() => ({
    from, to,
    team_lead_id: userId,
    ...(teamId ? { team_id: teamId } : {}),
    limit: 500,
    page:  1,
  }), [from, to, userId, teamId])

  const { items: orders, isLoading } = useOwnerOrders(orderParams)

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 flex-shrink-0">
          <BarChart2 size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Отчёты</h1>
          <p className="text-xs text-slate-400">Аналитика вашей команды</p>
        </div>
      </div>

      {/* Period filter */}
      <IncomePeriodFilter from={from} to={to} onChange={(f,t) => { setFrom(f); setTo(t) }} />

      {/* Summary */}
      {!isLoading && orders.length > 0 && (
        <div className="card p-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-slate-900">{orders.length}</p>
              <p className="text-xs text-slate-400 mt-0.5">Всего заказов</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-700">
                {orders.filter(o=>(o.status??o.Status)==='delivered').length}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Доставлено</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-violet-700">
                {fmtAmount(orders.reduce((s,o)=>s+Number(o.net_revenue??o.total_amount??0),0))} сомони
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Выручка</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard icon={<TrendingUp size={15}/>} title="Динамика выручки" loading={isLoading}>
          <RevenueTrend orders={orders} />
        </SectionCard>

        <SectionCard icon={<BarChart2 size={15}/>} title="По статусам" loading={isLoading}>
          <StatusChart orders={orders} />
        </SectionCard>

        <SectionCard icon={<Users size={15}/>} title="Рейтинг продавцов" loading={isLoading}>
          <SellersRanking orders={orders} userMap={userMap} />
        </SectionCard>

        <SectionCard icon={<Target size={15}/>} title="Конверсия по продавцу" loading={isLoading}>
          <ConversionBySeller orders={orders} userMap={userMap} />
        </SectionCard>
      </div>
    </div>
  )
}
