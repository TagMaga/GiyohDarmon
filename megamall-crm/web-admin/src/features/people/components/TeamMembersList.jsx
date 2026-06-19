import { useNavigate }   from 'react-router-dom'
import Badge             from '../../../shared/components/Badge'
import EmptyState        from '../../../shared/components/EmptyState'
import { CardSkeleton }  from '../../../shared/components/Skeleton'
import { Users, ChevronRight } from 'lucide-react'
import { ROLE_LABEL, ROLE_BADGE } from '../utils/peopleHelpers'

/**
 * TeamMembersList — shows enriched team members inside TeamProfilePage.
 *
 * Props:
 *   members   {Array}  hierarchy rows [{ user_id, parent_id, team_id }]
 *   userMap   {object} id → user
 *   loading   {bool}
 */
export default function TeamMembersList({ members = [], userMap = {}, loading }) {
  const navigate = useNavigate()

  if (loading) return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => <CardSkeleton key={i} />)}
    </div>
  )

  if (members.length === 0) return (
    <EmptyState icon={<Users size={20} />} title="Участники не назначены" />
  )

  return (
    <div className="space-y-2">
      {members.map((m, i) => {
        const user = userMap[m.user_id]
        if (!user) return (
          <div key={m.user_id ?? i} className="card p-3 text-xs text-slate-400">
            ID: {m.user_id?.slice(0, 8)}… (данные не загружены)
          </div>
        )
        const role     = user.role ?? user.Role ?? ''
        const initials = (user.full_name ?? '?').slice(0, 2).toUpperCase()

        return (
          <button
            key={user.id}
            onClick={() => navigate(`/owner/employees/${user.id}`)}
            className="card p-3 text-left w-full hover:shadow-sm transition-shadow group flex items-center gap-3"
          >
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-[11px] font-bold text-white">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold text-slate-900 truncate">{user.full_name}</span>
                <Badge variant={ROLE_BADGE[role] ?? 'slate'} size="sm">{ROLE_LABEL[role] ?? role}</Badge>
              </div>
              <p className="text-xs text-slate-400">{user.phone}</p>
            </div>
            <ChevronRight size={13} className="text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
          </button>
        )
      })}
    </div>
  )
}
