import { useNavigate }   from 'react-router-dom'
import Badge             from '../../../shared/components/Badge'
import { ChevronRight }  from 'lucide-react'
import { ROLE_LABEL, ROLE_BADGE, teamName } from '../utils/peopleHelpers'

/**
 * EmployeeCard — one row in the employees list (mobile card style).
 *
 * Props:
 *   user     {object}
 *   teamMap  {object}  id → team  (to resolve team name from hierarchy entry)
 *   teamId   {string|null}  (from hierarchy)
 */
export default function EmployeeCard({ user, teamMap = {}, teamId = null }) {
  const navigate   = useNavigate()
  const role       = user.role ?? user.Role ?? ''
  const initials   = (user.full_name ?? user.FullName ?? '?').slice(0, 2).toUpperCase()
  const tn         = teamId ? teamName(teamMap, teamId) : null

  return (
    <button
      onClick={() => navigate('/owner/team-directory')}
      className="card p-4 text-left w-full hover:shadow-md transition-shadow group flex items-center gap-3"
    >
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-white">{initials}</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-slate-900 truncate">
            {user.full_name ?? user.FullName}
          </p>
          <Badge variant={ROLE_BADGE[role] ?? 'slate'} size="sm">
            {user.position || ROLE_LABEL[role] || role}
          </Badge>
          {user.is_active === false && (
            <Badge variant="slate" size="sm">Неактивен</Badge>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5">{user.phone}</p>
        {tn && <p className="text-xs text-slate-400">{tn}</p>}
      </div>

      <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" />
    </button>
  )
}
