import Badge   from '../../../shared/components/Badge'
import { fmtDate } from '../utils/peopleHelpers'

/**
 * WorkerApplicationCard — one row in the pending-applications list.
 *
 * Props:
 *   application {object}  — ApplicationResponse
 *   onOpen      {fn}      — () => void, opens the detail/approve/reject modal
 */
export default function WorkerApplicationCard({ application: a, onOpen }) {
  const initials = (a.full_name ?? '?').slice(0, 2).toUpperCase()

  return (
    <button
      onClick={onOpen}
      className="card p-4 text-left w-full hover:shadow-md transition-shadow flex items-center gap-3"
    >
      <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-white">{initials}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-slate-900 truncate">{a.full_name}</p>
          {a.desired_position && <Badge variant="amber" size="sm">{a.desired_position}</Badge>}
        </div>
        <p className="text-xs text-slate-400 mt-0.5">{a.phone}</p>
        <p className="text-xs text-slate-400">Подано {fmtDate(a.created_at)}</p>
      </div>
    </button>
  )
}
