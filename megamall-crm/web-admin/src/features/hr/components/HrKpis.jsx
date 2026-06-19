import KpiCard from '../../../shared/components/KpiCard'
import { Truck, Percent, Users, FileText } from 'lucide-react'
import { fmtMoney, fmtPct, isConfigActive } from '../utils/hrHelpers'

/**
 * HrKpis — 4 KPI tiles for the HR dashboard.
 *
 * Props:
 *   tariff   {object|null}
 *   configs  {Array}
 *   history  {object}   — { items, total }
 *   loading  {bool}
 */
export default function HrKpis({ tariff, configs = [], history = {}, loading = false }) {
  const activeFee = tariff?.fixed_fee != null
    ? fmtMoney(tariff.fixed_fee)
    : tariff
      ? 'Ступенчатый'
      : '—'

  const activeConfigsCount = configs.filter(isConfigActive).length
  const totalConfigs       = configs.length
  const historyTotal       = history?.total ?? history?.items?.length ?? 0

  // Seller rate from configs
  const sellerConfig = configs.find(c => c.commission_type === 'seller_rate' && isConfigActive(c))
  const sellerRate   = sellerConfig ? fmtPct(sellerConfig.rate) : '—'

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <KpiCard
        label="Тариф доставки"
        value={loading ? '—' : activeFee}
        icon={<Truck size={20} />}
        color="sky"
        loading={loading}
        trend={tariff?.name ?? undefined}
      />
      <KpiCard
        label="Ставка продавца"
        value={loading ? '—' : sellerRate}
        icon={<Percent size={20} />}
        color="indigo"
        loading={loading}
      />
      <KpiCard
        label="Активных конфигов"
        value={loading ? '—' : `${activeConfigsCount} / ${totalConfigs}`}
        icon={<FileText size={20} />}
        color="emerald"
        loading={loading}
      />
      <KpiCard
        label="Записей в истории"
        value={loading ? '—' : String(historyTotal)}
        icon={<Users size={20} />}
        color="violet"
        loading={loading}
      />
    </div>
  )
}
