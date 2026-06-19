import Badge from '../../../shared/components/Badge'
import {
  fmtPct, fmtDate,
  COMMISSION_TYPE_LABEL, COMMISSION_TYPE_BADGE,
  SCOPE_LABEL, SCOPE_BADGE,
  teamName, userName,
} from '../utils/hrHelpers'

export default function HistoryTable({ items = [], teamMap = {}, userMap = {} }) {
  if (items.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
            <th className="text-left px-4 py-3">Тип</th>
            <th className="text-left px-4 py-3">Область</th>
            <th className="text-left px-4 py-3">Цель</th>
            <th className="text-right px-4 py-3">Ставка</th>
            <th className="text-left px-4 py-3">С</th>
            <th className="text-left px-4 py-3">По</th>
            <th className="text-left px-4 py-3">Статус</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const active = !item.effective_to || new Date(item.effective_to) > new Date()
            return (
              <tr key={item.id ?? i} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <Badge variant={COMMISSION_TYPE_BADGE[item.commission_type] ?? 'slate'} size="sm">
                    {COMMISSION_TYPE_LABEL[item.commission_type] ?? item.commission_type}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={SCOPE_BADGE[item.scope] ?? 'slate'} size="sm">
                    {SCOPE_LABEL[item.scope] ?? item.scope}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate">
                  {item.scope === 'team'     && item.team_id && teamName(teamMap, item.team_id)}
                  {item.scope === 'employee' && item.user_id && userName(userMap, item.user_id)}
                  {item.scope === 'global'   && '—'}
                </td>
                <td className="px-4 py-3 text-right font-bold text-indigo-700">{fmtPct(item.rate)}</td>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(item.effective_from)}</td>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{item.effective_to ? fmtDate(item.effective_to) : '—'}</td>
                <td className="px-4 py-3">
                  <Badge variant={active ? 'emerald' : 'slate'} size="sm">{active ? 'Активна' : 'Архив'}</Badge>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
