import { useState }        from 'react'
import { RefreshCw }       from 'lucide-react'
import { useQueryClient }  from '@tanstack/react-query'
import { KEYS }            from '../../../shared/queryKeys'

import HrKpis          from '../components/HrKpis'
import HrTabs          from '../components/HrTabs'
import TariffCard      from '../components/TariffCard'
import ConfigsPanel    from '../components/ConfigsPanel'
import HistoryTable    from '../components/HistoryTable'
import HistoryMobileCard from '../components/HistoryMobileCard'
import PreviewCalculator from '../components/PreviewCalculator'
import EventsTimeline  from '../components/EventsTimeline'
import { CardSkeleton } from '../../../shared/components/Skeleton'

import { useActiveTariff, useTariffs } from '../hooks/useTariffs'
import useConfigs  from '../hooks/useConfigs'
import useHistory  from '../hooks/useHistory'
import { useTeams, useUsers } from '../hooks/useSupportingData'
import { buildTeamMap, buildUserMap } from '../utils/hrHelpers'

export default function HrDashboard() {
  const [tab, setTab] = useState('tariff')
  const qc = useQueryClient()

  // Data
  const { data: activeTariff, isLoading: tariffLoading } = useActiveTariff()
  const { data: allTariffs  = [], isLoading: tariffsLoading } = useTariffs()
  const { data: configs     = [], isLoading: configsLoading }  = useConfigs()
  const { data: historyRaw,       isLoading: historyLoading }  = useHistory()
  const { data: teamsRaw    = [] } = useTeams()
  const { data: usersRaw    = [] } = useUsers()

  // Normalise history (may be paginated object or plain array)
  const historyItems = Array.isArray(historyRaw)
    ? historyRaw
    : historyRaw?.items ?? historyRaw?.data ?? []
  const historyMeta  = { total: Array.isArray(historyRaw) ? historyRaw.length : (historyRaw?.total ?? historyItems.length), items: historyItems }

  const teamMap = buildTeamMap(teamsRaw)
  const userMap = buildUserMap(usersRaw)

  const kpiLoading = tariffLoading || configsLoading || historyLoading

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: KEYS.hr.tariffActive })
    qc.invalidateQueries({ queryKey: KEYS.hr.tariffs })
    qc.invalidateQueries({ queryKey: KEYS.hr.configs })
    qc.invalidateQueries({ queryKey: KEYS.hr.history })
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">HR / Финансовая модель</h1>
          <p className="text-sm text-slate-400">Тарифы, правила начисления, история изменений</p>
        </div>
        <button
          onClick={handleRefresh}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors"
          aria-label="Обновить"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* KPIs */}
      <HrKpis
        tariff={activeTariff ?? null}
        configs={configs}
        history={historyMeta}
        loading={kpiLoading}
      />

      {/* Tabs */}
      <HrTabs active={tab} onChange={setTab} />

      {/* Tab content */}
      {tab === 'tariff' && (
        <TariffCard
          activeTariff={activeTariff ?? null}
          tariffs={allTariffs}
          loading={tariffLoading || tariffsLoading}
        />
      )}

      {tab === 'configs' && (
        <ConfigsPanel
          configs={configs}
          teams={teamsRaw}
          users={usersRaw}
          teamMap={teamMap}
          userMap={userMap}
          loading={configsLoading}
        />
      )}

      {tab === 'history' && (
        historyLoading
          ? <div className="space-y-3">{[1,2,3].map(i => <CardSkeleton key={i} />)}</div>
          : <>
              <div className="hidden md:block">
                <HistoryTable items={historyItems} teamMap={teamMap} userMap={userMap} />
              </div>
              <div className="md:hidden">
                <HistoryMobileCard items={historyItems} teamMap={teamMap} userMap={userMap} />
              </div>
            </>
      )}

      {tab === 'preview' && <PreviewCalculator />}

      {tab === 'events'  && <EventsTimeline />}
    </div>
  )
}
