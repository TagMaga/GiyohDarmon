/**
 * OrdersAnalytics — analytics block below the orders table.
 *
 * Sections (all derived client-side from the full orders array):
 *   1. Orders by status — horizontal bar chart (no external charting lib needed)
 *   2. Top 10 sellers — ranked bar list
 *   3. Top 10 products — ranked bar list
 *   4. Revenue trend — simple sparkline using SVG polyline
 *
 * No heavy charting library required — pure CSS/SVG for zero bundle cost.
 */
import { useMemo } from 'react'
import { BarChart2, Users, Package, TrendingUp } from 'lucide-react'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount } from '../../../shared/orderStatusConfig'

// Badge accent → bg/text class for status bars
const STATUS_COLOR = {
  new:                  'bg-indigo-500',
  confirmed:            'bg-sky-500',
  prepayment_pending:   'bg-amber-400',
  prepayment_received:  'bg-violet-500',
  assigned:             'bg-violet-400',
  in_delivery:          'bg-amber-500',
  delivered:            'bg-emerald-500',
  returned:             'bg-orange-400',
  cancelled:            'bg-slate-400',
  issue:                'bg-rose-500',
}

function SectionCard({ icon, title, children }) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
          {icon}
        </span>
        <p className="text-sm font-bold text-slate-800">{title}</p>
      </div>
      {children}
    </div>
  )
}

// ── Status chart ─────────────────────────────────────────────────────────────

function StatusChart({ orders }) {
  const counts = useMemo(() => {
    const c = {}
    orders.forEach(o => {
      const s = o.status ?? o.Status ?? 'unknown'
      c[s] = (c[s] ?? 0) + 1
    })
    return Object.entries(c)
      .sort(([,a],[,b]) => b - a)
      .slice(0, 8)
  }, [orders])

  const max = counts[0]?.[1] ?? 1

  return (
    <div className="space-y-2.5">
      {counts.map(([status, count]) => (
        <div key={status} className="flex items-center gap-3">
          <span className="text-[11px] text-slate-500 w-32 flex-shrink-0 truncate">
            {STATUS_LABELS[status] ?? status}
          </span>
          <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${STATUS_COLOR[status] ?? 'bg-slate-400'}`}
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="text-[11px] font-bold text-slate-700 w-8 text-right flex-shrink-0">
            {count}
          </span>
        </div>
      ))}
      {counts.length === 0 && <p className="text-xs text-slate-400 text-center py-3">Нет данных</p>}
    </div>
  )
}

// ── Top N ranked bar ─────────────────────────────────────────────────────────

function RankedBar({ entries, formatLabel, accentClass = 'bg-indigo-500' }) {
  const max = entries[0]?.[1] ?? 1
  return (
    <div className="space-y-2">
      {entries.map(([key, count], i) => (
        <div key={key} className="flex items-center gap-3">
          <span className="text-[11px] font-bold text-slate-400 w-5 flex-shrink-0">{i + 1}</span>
          <span className="text-[11px] text-slate-600 w-28 flex-shrink-0 truncate">
            {formatLabel(key)}
          </span>
          <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${accentClass}`}
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="text-[11px] font-bold text-slate-700 w-8 text-right">{count}</span>
        </div>
      ))}
      {entries.length === 0 && <p className="text-xs text-slate-400 text-center py-3">Нет данных</p>}
    </div>
  )
}

// ── Revenue sparkline (SVG) ──────────────────────────────────────────────────

function RevenueTrend({ orders }) {
  const dailyData = useMemo(() => {
    const map = {}
    orders.forEach(o => {
      const d = (o.created_at ?? o.CreatedAt ?? '').slice(0, 10)
      if (!d) return
      const totalOrd = Number(o.total_order_amount ?? o.total_amount ?? o.amount ?? 0)
      const courPay  = Number(o.courier_payout ?? 0)
      const amt = totalOrd - courPay
      map[d] = (map[d] ?? 0) + amt
    })
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
  }, [orders])

  if (dailyData.length < 2) {
    return <p className="text-xs text-slate-400 text-center py-6">Недостаточно данных для графика</p>
  }

  const W = 600, H = 80, PAD = 8
  const values = dailyData.map(([, v]) => v)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const range = maxV - minV || 1

  const pts = dailyData.map(([, v], i) => {
    const x = PAD + (i / (dailyData.length - 1)) * (W - PAD * 2)
    const y = PAD + (1 - (v - minV) / range) * (H - PAD * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  // Fill area polygon
  const first = dailyData.map((_, i) =>
    `${(PAD + (i / (dailyData.length - 1)) * (W - PAD * 2)).toFixed(1)},${H - PAD}`
  )
  const area = [
    `${PAD},${H - PAD}`,
    ...dailyData.map(([, v], i) => {
      const x = PAD + (i / (dailyData.length - 1)) * (W - PAD * 2)
      const y = PAD + (1 - (v - minV) / range) * (H - PAD * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }),
    `${(W - PAD).toFixed(1)},${H - PAD}`,
  ].join(' ')

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 80 }}>
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#6366f1" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#revGrad)" />
        <polyline
          points={pts}
          fill="none"
          stroke="#6366f1"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-slate-400">{dailyData[0]?.[0]}</span>
        <span className="text-[10px] text-slate-400">{dailyData[dailyData.length - 1]?.[0]}</span>
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>Мин: <strong className="text-slate-700">{fmtAmount(minV)} сомони</strong></span>
        <span>Макс: <strong className="text-slate-700">{fmtAmount(maxV)} сомони</strong></span>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function OrdersAnalytics({ orders = [], userMap = {} }) {
  const topSellers = useMemo(() => {
    const c = {}
    orders.forEach(o => {
      const id = o.seller_id ?? o.SellerID
      if (id) c[id] = (c[id] ?? 0) + 1
    })
    return Object.entries(c).sort(([,a],[,b]) => b-a).slice(0, 10)
  }, [orders])

  const topProducts = useMemo(() => {
    const c = {}
    orders.forEach(o => {
      const name = o.product_name ?? o.ProductName ?? o.product?.name ?? o.product?.Name
      if (name) c[name] = (c[name] ?? 0) + 1
    })
    return Object.entries(c).sort(([,a],[,b]) => b-a).slice(0, 10)
  }, [orders])

  function sellerLabel(id) {
    const u = userMap[id]
    return u ? (u.full_name ?? u.FullName ?? id.slice(0, 8)) : id.slice(0, 8)
  }

  if (orders.length === 0) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SectionCard icon={<BarChart2 size={15} />} title="По статусам">
        <StatusChart orders={orders} />
      </SectionCard>

      <SectionCard icon={<TrendingUp size={15} />} title="Динамика выручки">
        <RevenueTrend orders={orders} />
      </SectionCard>

      <SectionCard icon={<Users size={15} />} title="Топ продавцы">
        <RankedBar entries={topSellers} formatLabel={sellerLabel} accentClass="bg-indigo-500" />
      </SectionCard>

      <SectionCard icon={<Package size={15} />} title="Топ товары">
        <RankedBar entries={topProducts} formatLabel={x => x} accentClass="bg-emerald-500" />
      </SectionCard>
    </div>
  )
}
