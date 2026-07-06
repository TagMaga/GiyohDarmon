/**
 * LogisticsPage — /owner/logistics
 *
 * Tabbed logistics hub:
 *   0. Курьеры — full courier table
 *   1. Передачи — cash handovers CRUD
 *   2. Настройки доставки — client delivery fees
 */
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import Alert from '../../../shared/components/Alert'
import { KEYS }                  from '../../../shared/queryKeys'
import useLogisticsCouriers    from '../hooks/useLogisticsCouriers'
import { useHandovers }        from '../hooks/useHandovers'
import CouriersTable           from '../components/CouriersTable'
import CashCenterTab           from '../components/CashCenterTab'
import DeliverySettingsTab     from '../components/DeliverySettingsTab'

const TABS = [
  { id: 'couriers',          label: 'Курьеры' },
  { id: 'handovers',         label: 'Передачи кассы' },
  { id: 'delivery-settings', label: 'Настройки доставки' },
]

export default function LogisticsPage() {
  const [tab, setTab] = useState('couriers')
  const qc = useQueryClient()

  const {
    data: couriers = [],
    isLoading: couriersLoading,
    isError: couriersError,
  } = useLogisticsCouriers()

  const { data: pendingHandovers } = useHandovers({ status: 'pending', limit: 1 })
  const pendingCount = pendingHandovers?.meta?.total ?? 0

  function refresh() {
    qc.invalidateQueries({ queryKey: ['logistics'] })
    qc.invalidateQueries({ queryKey: KEYS.settings.delivery })
  }

  return (
    <div className="p-4 md:p-6 space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">Логистика</h1>
          <p className="text-[12.5px] text-slate-400 mt-0.5">Курьеры, доставки и передачи наличных</p>
        </div>

        <button
          onClick={refresh}
          className="flex items-center gap-2 px-3 py-2 rounded-[10px] text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all min-h-[44px] flex-shrink-0"
        >
          <RefreshCw size={14} />
          <span className="hidden sm:inline">Обновить</span>
        </button>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="max-w-full overflow-x-auto">
        <div className="inline-flex bg-slate-100 rounded-[10px] p-[3px]">
          {TABS.map(t => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={[
                  'flex items-center gap-1.5 px-3.5 py-1.5 rounded-[7px] text-[12.5px] font-semibold transition-all duration-150 whitespace-nowrap',
                  active
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                ].join(' ')}
              >
                {t.label}
                {t.id === 'handovers' && pendingCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] rounded-full bg-rose-500 text-white text-[10px] font-bold px-1">
                    {pendingCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>
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

      {/* ── Tab: Cash center ───────────────────────────────────────────── */}
      {tab === 'handovers' && (
        <div className="animate-fade-in">
          <CashCenterTab />
        </div>
      )}

      {/* ── Tab: Client delivery settings ─────────────────────────────── */}
      {tab === 'delivery-settings' && (
        <div className="animate-fade-in">
          <DeliverySettingsTab />
        </div>
      )}
    </div>
  )
}
