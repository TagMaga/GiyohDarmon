import { Package2, BarChart3, Download, AlertTriangle } from 'lucide-react'
import RoleDashboard from '../shared/components/RoleDashboard'

const KPI_CARDS = [
  { label: 'Товаров в каталоге', icon: <Package2       size={20} />, color: 'indigo',  value: '—' },
  { label: 'Единиц на складе',   icon: <BarChart3      size={20} />, color: 'emerald', value: '—' },
  { label: 'Приходов сегодня',   icon: <Download       size={20} />, color: 'sky',     value: '—' },
  { label: 'Низкий запас',       icon: <AlertTriangle  size={20} />, color: 'amber',   value: '—' },
]

export default function WarehouseDashboard() {
  return (
    <RoleDashboard
      title="Управление складом"
      subtitle="Остатки, приход товаров, движение"
      kpiCards={KPI_CARDS}
      tableTitle="Движение товаров"
    />
  )
}
