/**
 * TopCouriersPanel — shows top 3, best success rate, biggest debt.
 */
import { useNavigate } from 'react-router-dom'
import { Trophy, Star, AlertCircle, ChevronRight } from 'lucide-react'
import Badge from '../../../shared/components/Badge'

const fmtMoney = (n) =>
  n == null ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

const fmtPct = (n) =>
  n == null ? '—' : `${Number(n).toFixed(1)}%`

function CourierCard({ courier, rank, variant = 'normal' }) {
  const navigate = useNavigate()
  if (!courier) return null

  const rankColors = ['text-amber-500', 'text-slate-400', 'text-amber-700']
  const bg = variant === 'warning'
    ? 'bg-rose-50 border-rose-100'
    : variant === 'star'
    ? 'bg-emerald-50 border-emerald-100'
    : 'bg-white border-slate-100'

  return (
    <button
      onClick={() => navigate(`/owner/logistics/couriers/${courier.courier_id}`)}
      className={`w-full text-left rounded-2xl border p-3.5 hover:shadow-card-md transition-all duration-150 ${bg}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {rank != null && (
            <span className={`text-lg font-black ${rankColors[rank] ?? 'text-slate-400'}`}>
              #{rank + 1}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{courier.full_name}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {fmtPct(courier.success_rate)} успеха · {courier.delivered_count} доставок
            </p>
          </div>
        </div>
        <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
      </div>
      {courier.cash_debt > 0 && (
        <p className="text-[11px] text-rose-600 font-medium mt-1.5">
          Долг: {fmtMoney(courier.cash_debt)} сом
        </p>
      )}
    </button>
  )
}

export default function TopCouriersPanel({ data, loading }) {
  if (loading) {
    return (
      <div className="card p-5 space-y-3">
        <div className="skeleton w-32 h-5 rounded-full" />
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton w-full h-14 rounded-2xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="card p-5 space-y-4">
      {/* Top 3 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={15} className="text-amber-500" />
          <p className="text-sm font-bold text-slate-800">Топ-3 курьера</p>
        </div>
        <div className="space-y-2">
          {data?.top_couriers?.length > 0 ? (
            data.top_couriers.map((c, i) => (
              <CourierCard key={c.courier_id} courier={c} rank={i} />
            ))
          ) : (
            <p className="text-xs text-slate-400 text-center py-4">Нет данных</p>
          )}
        </div>
      </div>

      {/* Best success rate */}
      {data?.best_success_courier && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Star size={15} className="text-emerald-500" />
            <p className="text-sm font-bold text-slate-800">Лучший процент успеха</p>
          </div>
          <CourierCard courier={data.best_success_courier} variant="star" />
        </div>
      )}

      {/* Biggest debt */}
      {data?.biggest_debt_courier && data.biggest_debt_courier.cash_debt > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={15} className="text-rose-500" />
            <p className="text-sm font-bold text-slate-800">Наибольший долг</p>
          </div>
          <CourierCard courier={data.biggest_debt_courier} variant="warning" />
        </div>
      )}
    </div>
  )
}
