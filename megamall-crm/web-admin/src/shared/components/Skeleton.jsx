/**
 * Skeleton — configurable loading placeholder.
 *
 * Props:
 *   className {string}  — Tailwind classes for sizing/shape
 *   count     {number}  — repeat N times (default 1)
 *   gap       {string}  — gap class between repeated items (default 'gap-3')
 */
export default function Skeleton({ className = 'h-4 w-full', count = 1, gap = 'gap-3' }) {
  if (count === 1) {
    return <div className={`skeleton ${className}`} />
  }
  return (
    <div className={`flex flex-col ${gap}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`skeleton ${className}`} />
      ))}
    </div>
  )
}

/** Preset: card skeleton matching KpiCard size */
export function KpiSkeleton() {
  return (
    <div className="kpi-card" style={{ background: 'linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)' }}>
      <div className="flex items-start justify-between mb-5">
        <div className="skeleton w-11 h-11 rounded-2xl" />
        <div className="skeleton w-14 h-5 rounded-full" />
      </div>
      <div className="skeleton w-20 h-8 rounded-xl mb-2" />
      <div className="skeleton w-28 h-4 rounded-full" />
    </div>
  )
}

/** Preset: table row skeleton */
export function TableRowSkeleton({ cols = 6 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-4 rounded" style={{ width: `${60 + (i % 3) * 20}%` }} />
        </td>
      ))}
    </tr>
  )
}

/** Preset: mobile card skeleton */
export function CardSkeleton() {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="skeleton h-4 w-28 rounded" />
        <div className="skeleton h-5 w-20 rounded-full" />
      </div>
      <div className="skeleton h-3 w-40 rounded" />
      <div className="skeleton h-3 w-32 rounded" />
      <div className="flex gap-2 mt-2">
        <div className="skeleton h-8 w-20 rounded-xl" />
        <div className="skeleton h-8 w-20 rounded-xl" />
      </div>
    </div>
  )
}
