import { useNavigate }  from 'react-router-dom'
import Badge            from '../../../shared/components/Badge'
import { Users2, ChevronRight } from 'lucide-react'
import { fmtDate, userName } from '../utils/peopleHelpers'

/**
 * TeamCard — shown in the Teams grid inside TeamsHub.
 *
 * Props:
 *   team     {object}   team row
 *   userMap  {object}   id → user (to resolve lead/manager names)
 *   memberCount {number}
 */
export default function TeamCard({ team, userMap = {}, memberCount = 0 }) {
  const navigate = useNavigate()
  const lead    = team.team_lead_id ? userName(userMap, team.team_lead_id) : null
  const manager = team.manager_id   ? userName(userMap, team.manager_id)   : null

  return (
    <button
      onClick={() => navigate(`/owner/teams/${encodeURIComponent(team.name)}`)}
      className="card p-4 text-left w-full hover:shadow-md transition-shadow group"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Users2 size={17} className="text-indigo-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 truncate">{team.name}</p>
            <p className="text-xs text-slate-400">{memberCount} участн.</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Badge variant={team.is_active !== false ? 'emerald' : 'slate'} size="sm">
            {team.is_active !== false ? 'Активна' : 'Архив'}
          </Badge>
          <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
        </div>
      </div>

      <div className="space-y-1">
        {lead && (
          <p className="text-xs text-slate-500">
            <span className="text-slate-400">Руководитель группы:</span> <span className="font-medium">{lead}</span>
          </p>
        )}
        {manager && (
          <p className="text-xs text-slate-500">
            <span className="text-slate-400">Менеджер команды:</span> <span className="font-medium">{manager}</span>
          </p>
        )}
        {!lead && !manager && (
          <p className="text-xs text-slate-400 italic">Руководство не назначено</p>
        )}
      </div>

      <p className="text-[10px] text-slate-300 mt-2">Создана {fmtDate(team.created_at)}</p>
    </button>
  )
}
