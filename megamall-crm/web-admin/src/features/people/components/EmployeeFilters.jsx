import { Search, X } from 'lucide-react'
import { ALL_ROLES, ROLE_LABEL } from '../utils/peopleHelpers'

/**
 * EmployeeFilters — role dropdown + team dropdown + search input.
 *
 * Props:
 *   roleFilter   {string}    current role filter value
 *   teamFilter   {string}    current team_id filter value
 *   search       {string}    current search string
 *   teams        {Array}     list of teams for the dropdown
 *   onChange     {function}  ({ role?, team?, search? }) => void
 */
export default function EmployeeFilters({ roleFilter = '', teamFilter = '', search = '', teams = [], onChange }) {
  return (
    <div className="flex flex-col sm:flex-row gap-2">
      {/* Search */}
      <div className="relative flex-1">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Имя, телефон…"
          value={search}
          onChange={e => onChange({ search: e.target.value })}
          className="input pl-8 w-full"
        />
        {search && (
          <button onClick={() => onChange({ search: '' })} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1">
            <X size={13} />
          </button>
        )}
      </div>

      {/* Role filter */}
      <select
        value={roleFilter}
        onChange={e => onChange({ role: e.target.value })}
        className="input sm:w-48"
      >
        <option value="">Все роли</option>
        {ALL_ROLES.filter(r => r !== 'owner').map(r => (
          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
        ))}
      </select>

      {/* Team filter */}
      <select
        value={teamFilter}
        onChange={e => onChange({ team: e.target.value })}
        className="input sm:w-48"
      >
        <option value="">Все команды</option>
        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  )
}
