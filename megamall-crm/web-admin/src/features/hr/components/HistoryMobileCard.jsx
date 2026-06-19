import Badge from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import {
  fmtPct, fmtDate,
  COMMISSION_TYPE_LABEL, COMMISSION_TYPE_BADGE,
  SCOPE_LABEL, SCOPE_BADGE,
  teamName, userName,
} from '../utils/hrHelpers'
import { FileText } from 'lucide-react'

export default function HistoryMobileCard({ items = [], teamMap = {}, userMap = {} }) {
  if (items.length === 0) return <EmptyState icon={<FileText size={22} />} title="История пуста" />
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const active = !item.effective_to || new Date(item.effective_to) > new Date()
        return (
          <div key={item.id ?? i} className={`card p-4 space-y-2 ${active ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant={COMMISSION_TYPE_BADGE[item.commission_type] ?? 'slate'} size="sm">
                  {COMMISSION_TYPE_LABEL[item.commission_type] ?? item.commission_type}
                </Badge>
                <Badge variant={SCOPE_BADGE[item.scope] ?? 'slate'} size="sm">
                  {SCOPE_LABEL[item.scope] ?? item.scope}
                </Badge>
                <Badge variant={active ? 'emerald' : 'slate'} size="sm">{active ? 'Активна' : 'Архив'}</Badge>
              </div>
              <p className="text-base font-bold text-indigo-700 flex-shrink-0">{fmtPct(item.rate)}</p>
            </div>

            {item.scope === 'team'     && item.team_id && <p className="text-xs text-slate-500">Команда: <span className="font-medium">{teamName(teamMap, item.team_id)}</span></p>}
            {item.scope === 'employee' && item.user_id && <p className="text-xs text-slate-500">Сотрудник: <span className="font-medium">{userName(userMap, item.user_id)}</span></p>}

            <div className="flex gap-3 text-xs text-slate-400 flex-wrap">
              <span>С {fmtDate(item.effective_from)}</span>
              {item.effective_to && <span>по {fmtDate(item.effective_to)}</span>}
            </div>

            {item.notes && <p className="text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-1.5">{item.notes}</p>}
          </div>
        )
      })}
    </div>
  )
}
