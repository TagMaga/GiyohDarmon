import { useNavigate } from 'react-router-dom'
import { Truck, Users, AlertTriangle, Wallet, RefreshCw, ChevronRight } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import KpiCard             from '../../../shared/components/KpiCard'
import useLogisticsDashboard from '../../logistics/hooks/useLogisticsDashboard'
import useLogisticsCouriers  from '../../logistics/hooks/useLogisticsCouriers'

const fmtMoney = (n) => (n == null ? '—' : `${(+n || 0).toLocaleString('ru-RU')} с`)
const fmtPct   = (n) => (n == null ? '—' : `${Math.round(+n || 0)}%`)

const STATUS_CONFIG = {
  busy:     { dot: 'bg-emerald-400', label: 'В работе' },
  free:     { dot: 'bg-slate-300',   label: 'Свободен' },
  inactive: { dot: 'bg-rose-400',    label: 'Неактивен' },
}

export default function OwnerCouriersPage() {
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const { data: dash,     isLoading: dashLoading }     = useLogisticsDashboard()
  const { data: couriers = [], isLoading: couriersLoading } = useLogisticsCouriers()

  return (
    <div className="p-4 md:p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Курьеры</h1>
          <p className="text-sm text-slate-500 mt-0.5">Текущее состояние курьерского парка</p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['logistics'] })}
          className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <KpiCard
          label="В работе"
          value={dash?.busy_couriers ?? '—'}
          icon={<Truck size={22} />}
          color="emerald"
          loading={dashLoading}
        />
        <KpiCard
          label="Свободны"
          value={dash?.free_couriers ?? '—'}
          icon={<Users size={22} />}
          color="sky"
          loading={dashLoading}
        />
        <KpiCard
          label="Просрочено"
          value={dash?.overdue_deliveries ?? '—'}
          icon={<AlertTriangle size={22} />}
          color="rose"
          loading={dashLoading}
        />
        <KpiCard
          label="Кэш в обороте"
          value={fmtMoney(dash?.cash_in_circulation)}
          icon={<Wallet size={22} />}
          color="amber"
          loading={dashLoading}
        />
      </div>

      {/* Courier table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-slate-900">
            Список курьеров
            {couriers.length > 0 && (
              <span className="ml-2 text-[12px] font-normal text-slate-400">({couriers.length})</span>
            )}
          </h2>
        </div>

        {couriersLoading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Загрузка...</div>
        ) : couriers.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Нет курьеров</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Курьер', 'Статус', 'Активных', 'Доставлено', 'Успех', 'Долг', 'Заработок', ''].map(h => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {couriers.map((c) => {
                  const st = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.inactive
                  return (
                    <tr
                      key={c.courier_id}
                      onClick={() => navigate(`/owner/logistics/couriers/${c.courier_id}`)}
                      className="border-b border-slate-50 hover:bg-slate-50/70 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{c.full_name}</p>
                        <p className="text-slate-400 text-[11px]">{c.phone}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                          <span className="text-slate-600">{st.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">{c.active_orders}</td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">{c.delivered_today}</td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">{fmtPct(c.success_rate)}</td>
                      <td className={`px-4 py-3 font-medium tabular-nums ${c.cash_debt > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                        {fmtMoney(c.cash_debt)}
                      </td>
                      <td className="px-4 py-3 text-emerald-700 font-medium tabular-nums">
                        {fmtMoney(c.earnings)}
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight size={15} className="text-slate-300" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
