import KpiCard from '../../../shared/components/KpiCard'
import { Users, Users2, Truck, FileText } from 'lucide-react'

/**
 * PeopleKpis — 4 tiles across the top of TeamsHub.
 *
 * Props:
 *   employees  {Array}
 *   teams      {Array}
 *   configs    {Array}  — all compensation configs
 *   loading    {bool}
 */
export default function PeopleKpis({ employees = [], teams = [], configs = [], loading = false }) {
  const totalEmployees  = employees.length
  const activeTeams     = teams.filter(t => t.is_active !== false).length
  const couriers        = employees.filter(e => (e.role ?? e.Role) === 'courier').length
  const activeConfigs   = configs.filter(c => c.is_active !== false && (!c.effective_to || new Date(c.effective_to) > new Date())).length

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <KpiCard
        label="Сотрудников"
        value={loading ? '—' : String(totalEmployees)}
        icon={<Users size={20} />}
        color="indigo"
        loading={loading}
      />
      <KpiCard
        label="Активных команд"
        value={loading ? '—' : String(activeTeams)}
        icon={<Users2 size={20} />}
        color="sky"
        loading={loading}
      />
      <KpiCard
        label="Курьеров"
        value={loading ? '—' : String(couriers)}
        icon={<Truck size={20} />}
        color="amber"
        loading={loading}
      />
      <KpiCard
        label="Активных конфигов"
        value={loading ? '—' : String(activeConfigs)}
        icon={<FileText size={20} />}
        color="emerald"
        loading={loading}
      />
    </div>
  )
}
