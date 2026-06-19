/**
 * LogisticsPage — /owner/logistics
 *
 * Tabbed logistics hub:
 *   0. Дашборд — KPIs + top couriers + risk panel
 *   1. Курьеры — full courier table
 *   2. Передачи — cash handovers CRUD
 */
import { useState } from 'react'
import { Truck, RefreshCw, LayoutDashboard, Users, Banknote, AlertTriangle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import Alert from '../../../shared/components/Alert'
import useLogisticsDashboard   from '../hooks/useLogisticsDashboard'
import useLogisticsCouriers    from '../hooks/useLogisticsCouriers'
import LogisticsKpiStrip       from '../components/LogisticsKpiStrip'
import TopCouriersPanel        from '../components/TopCouriersPanel'
import CouriersTable           from '../components/CouriersTable'
import CashHandoversPage       from '../components/CashHandoversPage'

const TABS = [
  { id: 'dashboard', label: 'Дашборд',   icon: LayoutDashboard },
  { id: 'couriers',  label: 'Курьеры',   icon: Users },
  { id: 'handovers', label: 'Передачи',  icon: Banknote },
]

export default function LogisticsPage() {
  const [tab, setTab] = useState('dashboard')
  const qc = useQueryClient()

  const {
    data: dash,
    isLoading: dashLoading,
    isError: dashError,
    error: dashErr,
  } = useLogisticsDashboard()

  const {
    data: couriers = [],
    isLoading: couriersLoading,
    isError: couriersError,
  } = useLogisticsCouriers()

  function refresh() {
    qc.invalidateQueries({ queryKey: ['logistics'] })
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 flex-shrink-0">
            <Truck size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Логистика</h1>
            <p className="text-xs text-slate-400">Курьеры, доставки и передачи наличных</p>
          </div>
        </div>

        <button
          onClick={refresh}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all min-h-[44px] flex-shrink-0"
        >
          <RefreshCw size={14} />
          <span className="hidden sm:inline">Обновить</span>
        </button>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl w-fit">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150',
                active
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              ].join(' ')}
            >
              <Icon size={15} />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── Errors ─────────────────────────────────────────────────────── */}
      {dashError && (
        <Alert variant="error">
          {dashErr?.response?.data?.error?.message ?? 'Ошибка загрузки дашборда'}
        </Alert>
      )}
      {couriersError && (
        <Alert variant="error">Ошибка загрузки курьеров</Alert>
      )}

      {/* ── Tab: Dashboard ─────────────────────────────────────────────── */}
      {tab === 'dashboard' && (
        <div className="space-y-5 animate-fade-in">
          <LogisticsKpiStrip data={dash} loading={dashLoading} />

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            {/* Main content */}
            <div className="xl:col-span-2 space-y-4">
              {/* Risk / attention panel */}
              {dash && (dash.overdue_deliveries > 0 || dash.orders_without_courier > 0 || dash.at_risk_deliveries > 0) && (
                <div className="card p-4 border-l-4 border-amber-400 bg-amber-50/50">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={16} className="text-amber-600" />
                    <p className="text-sm font-bold text-amber-900">Требует внимания</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {dash.overdue_deliveries > 0 && (
                      <div className="bg-white rounded-xl p-3 border border-amber-100">
                        <p className="text-2xl font-black text-rose-600">{dash.overdue_deliveries}</p>
                        <p className="text-xs text-slate-600 mt-0.5">Просроченных доставок (&gt;4ч)</p>
                      </div>
                    )}
                    {dash.at_risk_deliveries > 0 && (
                      <div className="bg-white rounded-xl p-3 border border-amber-100">
                        <p className="text-2xl font-black text-amber-600">{dash.at_risk_deliveries}</p>
                        <p className="text-xs text-slate-600 mt-0.5">Рискуют опоздать (2–4ч)</p>
                      </div>
                    )}
                    {dash.orders_without_courier > 0 && (
                      <div className="bg-white rounded-xl p-3 border border-amber-100">
                        <p className="text-2xl font-black text-indigo-600">{dash.orders_without_courier}</p>
                        <p className="text-xs text-slate-600 mt-0.5">Без курьера</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Couriers preview */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-bold text-slate-800">Курьеры</p>
                  <button
                    onClick={() => setTab('couriers')}
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold transition-colors"
                  >
                    Все курьеры →
                  </button>
                </div>
                <CouriersTable couriers={couriers.slice(0, 5)} loading={couriersLoading} />
              </div>
            </div>

            {/* Sidebar */}
            <div>
              <TopCouriersPanel data={dash} loading={dashLoading} />
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Couriers ──────────────────────────────────────────────── */}
      {tab === 'couriers' && (
        <div className="animate-fade-in">
          <CouriersTable couriers={couriers} loading={couriersLoading} />
        </div>
      )}

      {/* ── Tab: Handovers ─────────────────────────────────────────────── */}
      {tab === 'handovers' && (
        <div className="animate-fade-in">
          <CashHandoversPage />
        </div>
      )}
    </div>
  )
}
