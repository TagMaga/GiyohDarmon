/**
 * LogisticsPage — /owner/logistics
 *
 * Tabbed logistics hub:
 *   0. Курьеры — full courier table
 *   1. Передачи — cash handovers CRUD
 */
import { useState } from 'react'
import { Truck, RefreshCw, Users, Banknote } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import Alert from '../../../shared/components/Alert'
import useLogisticsCouriers    from '../hooks/useLogisticsCouriers'
import CouriersTable           from '../components/CouriersTable'
import CashHandoversPage       from '../components/CashHandoversPage'

const TABS = [
  { id: 'couriers',  label: 'Курьеры',   icon: Users },
  { id: 'handovers', label: 'Передачи',  icon: Banknote },
]

export default function LogisticsPage() {
  const [tab, setTab] = useState('couriers')
  const qc = useQueryClient()

  const {
    data: couriers = [],
    isLoading: couriersLoading,
    isError: couriersError,
  } = useLogisticsCouriers()

  function refresh() {
    qc.invalidateQueries({ queryKey: ['logistics'] })
  }

  return (
    <div className="p-4 md:p-6 space-y-5">

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
      {couriersError && (
        <Alert variant="error">Ошибка загрузки курьеров</Alert>
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
