import { useNavigate } from 'react-router-dom'
import { Users, UserCheck, Truck, BarChart2, ChevronRight, Clock } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import KpiCard      from '../../../shared/components/KpiCard'
import useEmployees from '../../people/hooks/useEmployees'
import useTeams     from '../../people/hooks/useTeams'
import { fmtPct, COMMISSION_TYPE_LABEL } from '../../people/utils/peopleHelpers'

const ROLE_LABEL = {
  seller:          'Продавцы',
  manager:         'Менеджеры',
  sales_team_lead: 'Руководители',
  courier:         'Курьеры',
  dispatcher:      'Диспетчеры',
  warehouse_manager: 'Склад',
}

export default function OwnerHRPage() {
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const { data: employees = [], isLoading: empLoading } = useEmployees()
  const { data: teams     = [], isLoading: teamLoading } = useTeams()

  const roleCount = employees.reduce((acc, e) => {
    acc[e.role] = (acc[e.role] ?? 0) + 1
    return acc
  }, {})

  const sellers   = roleCount.seller          ?? 0
  const couriers  = roleCount.courier         ?? 0
  const managers  = roleCount.manager         ?? 0
  const teamLeads = roleCount.sales_team_lead ?? 0

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">HR и компенсации</h1>
          <p className="text-sm text-slate-500 mt-0.5">Команды, ставки комиссии и кадровый состав</p>
        </div>
        <button
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['people'] })
            qc.invalidateQueries({ queryKey: ['hr'] })
          }}
          className="text-[13px] text-slate-500 hover:text-slate-700 bg-white border border-slate-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          Обновить
        </button>
      </div>

      {/* Staff KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <KpiCard
          label="Продавцы"
          value={sellers}
          icon={<UserCheck size={22} />}
          color="indigo"
          loading={empLoading}
        />
        <KpiCard
          label="Менеджеры"
          value={managers + teamLeads}
          icon={<BarChart2 size={22} />}
          color="violet"
          loading={empLoading}
        />
        <KpiCard
          label="Курьеры"
          value={couriers}
          icon={<Truck size={22} />}
          color="emerald"
          loading={empLoading}
        />
        <KpiCard
          label="Всего сотрудников"
          value={employees.length}
          icon={<Users size={22} />}
          color="sky"
          loading={empLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Teams list */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-slate-900">
              Команды
              {teams.length > 0 && (
                <span className="ml-2 text-[12px] font-normal text-slate-400">({teams.length})</span>
              )}
            </h2>
            <button
              onClick={() => navigate('/owner/teams')}
              className="text-[12px] text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Управление
            </button>
          </div>

          {teamLoading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Загрузка...</div>
          ) : teams.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">Команды не созданы</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {teams.map(t => (
                <div
                  key={t.id ?? t.team_id}
                  className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/60 cursor-pointer transition-colors"
                  onClick={() => navigate(`/owner/teams/${t.id ?? t.team_id}`)}
                >
                  <div>
                    <p className="text-[14px] font-medium text-slate-900">{t.name}</p>
                    {t.commission_type && (
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {COMMISSION_TYPE_LABEL[t.commission_type] ?? t.commission_type}
                        {t.commission_rate != null && ` · ${fmtPct(t.commission_rate * 100)}`}
                      </p>
                    )}
                  </div>
                  <ChevronRight size={15} className="text-slate-300" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Staff by role breakdown */}
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-slate-900">Состав по ролям</h2>
              <button
                onClick={() => navigate('/owner/employees')}
                className="text-[12px] text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Все сотрудники
              </button>
            </div>
            <div className="divide-y divide-slate-50">
              {Object.entries(ROLE_LABEL).map(([role, label]) => {
                const count = roleCount[role] ?? 0
                if (count === 0 && !empLoading) return null
                return (
                  <div key={role} className="px-5 py-3 flex items-center justify-between">
                    <span className="text-[13px] text-slate-700">{label}</span>
                    <span className="text-[13px] font-semibold text-slate-900 tabular-nums">
                      {empLoading ? '…' : count}
                    </span>
                  </div>
                )
              })}
              {!empLoading && employees.length === 0 && (
                <div className="px-5 py-6 text-center text-slate-400 text-sm">Нет сотрудников</div>
              )}
            </div>
          </div>

          {/* Salaries coming soon */}
          <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5 flex items-start gap-3">
            <div className="w-9 h-9 bg-slate-200 rounded-xl flex items-center justify-center flex-shrink-0">
              <Clock size={18} className="text-slate-500" />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-slate-700">Оклады и расходы</p>
              <p className="text-[12px] text-slate-400 mt-0.5 leading-relaxed">
                Учёт фиксированных окладов, аренды и операционных расходов появится в следующей версии.
                Влияние на чистую прибыль отражается в Дашборде после подключения.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
