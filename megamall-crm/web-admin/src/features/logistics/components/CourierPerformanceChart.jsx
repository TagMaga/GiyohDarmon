/**
 * CourierPerformanceChart — simple CSS bar chart showing delivered/failed per day.
 * No external chart library needed.
 */

const fmtMin = (n) => {
  if (!n || n === 0) return '—'
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return h > 0 ? `${h}ч ${m}м` : `${m}м`
}

const fmtMoney = (n) =>
  Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

export default function CourierPerformanceChart({ data = [], loading }) {
  if (loading) {
    return (
      <div className="card p-5">
        <div className="skeleton w-32 h-4 rounded-full mb-4" />
        <div className="flex items-end gap-1 h-32">
          {[40,70,55,80,60,90,45].map((h, i) => (
            <div key={i} className="skeleton rounded-t flex-1" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    )
  }

  if (!data.length) {
    return (
      <div className="card p-5 flex items-center justify-center py-12">
        <p className="text-sm text-slate-400">Нет данных за выбранный период</p>
      </div>
    )
  }

  const maxDelivered = Math.max(...data.map(d => d.delivered), 1)
  const maxFailed    = Math.max(...data.map(d => d.failed), 1)
  const maxVal       = Math.max(maxDelivered, maxFailed, 1)

  const fmtLabel = (dateStr) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-bold text-slate-800">Динамика доставок</p>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Доставлено</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" /> Неудачно</span>
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1 h-32 mb-2">
        {data.map((point, i) => (
          <div key={i} className="flex-1 flex items-end gap-0.5 group relative">
            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 bg-slate-900 text-white text-[10px] rounded-lg px-2 py-1.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <p className="font-semibold">{fmtLabel(point.date)}</p>
              <p>Доставлено: {point.delivered}</p>
              {point.failed > 0 && <p>Неудачно: {point.failed}</p>}
              <p>Кэш: {fmtMoney(point.cash_collected)} c</p>
              <p>Ср.время: {fmtMin(point.avg_delivery_minutes)}</p>
            </div>
            <div
              className="flex-1 bg-emerald-400 rounded-t transition-all duration-300"
              style={{ height: `${(point.delivered / maxVal) * 100}%`, minHeight: point.delivered > 0 ? '4px' : '0' }}
            />
            {point.failed > 0 && (
              <div
                className="flex-1 bg-rose-300 rounded-t transition-all duration-300"
                style={{ height: `${(point.failed / maxVal) * 100}%`, minHeight: '4px' }}
              />
            )}
          </div>
        ))}
      </div>

      {/* X-axis labels */}
      <div className="flex gap-1">
        {data.map((point, i) => (
          <div key={i} className="flex-1 text-center text-[9px] text-slate-400 leading-tight">
            {data.length <= 14 ? fmtLabel(point.date) : (i % 3 === 0 ? fmtLabel(point.date) : '')}
          </div>
        ))}
      </div>

      {/* Summary row */}
      <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-lg font-bold text-emerald-700">{data.reduce((s, d) => s + d.delivered, 0)}</p>
          <p className="text-[11px] text-slate-400">Доставлено</p>
        </div>
        <div>
          <p className="text-lg font-bold text-rose-600">{data.reduce((s, d) => s + d.failed, 0)}</p>
          <p className="text-[11px] text-slate-400">Неудачно</p>
        </div>
        <div>
          <p className="text-lg font-bold text-slate-700">{fmtMoney(data.reduce((s, d) => s + d.cash_collected, 0))} c</p>
          <p className="text-[11px] text-slate-400">Собрано кэша</p>
        </div>
      </div>
    </div>
  )
}
