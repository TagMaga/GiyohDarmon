import { useNavigate } from 'react-router-dom'
import { Settings, Users, ChevronRight } from 'lucide-react'

function SettingsCard({ icon: Icon, title, description, action, onClick, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div
        className="px-5 py-4 border-b border-slate-100 flex items-center justify-between cursor-pointer hover:bg-slate-50/60 transition-colors"
        onClick={onClick}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Icon size={18} className="text-indigo-600" />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-slate-900">{title}</p>
            <p className="text-[12px] text-slate-400">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {action && <span className="text-[12px] text-indigo-600 font-medium">{action}</span>}
          <ChevronRight size={15} className="text-slate-300" />
        </div>
      </div>
      {children && <div className="px-5 py-4">{children}</div>}
    </div>
  )
}

export default function OwnerSettingsPage() {
  const navigate = useNavigate()

  return (
    <div className="p-4 md:p-6 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Настройки</h1>
        <p className="text-sm text-slate-500 mt-0.5">Управление тарифами и командами</p>
      </div>

      {/* Courier payouts */}
      <SettingsCard
        icon={Settings}
        title="Тарифы выплат курьерам"
        description="Индивидуальные тарифы на нормальную и быструю доставку"
        action="Перейти"
        onClick={() => navigate('/owner/logistics')}
      >
        <p className="text-[13px] text-slate-500 leading-relaxed">
          Выплаты курьерам настраиваются индивидуально для каждого курьера
          в разделе <strong>Курьеры</strong>. Выплата полностью отделена от
          стоимости доставки для клиента и исходит из маржи компании.
        </p>
      </SettingsCard>

      {/* Team compensation */}
      <SettingsCard
        icon={Users}
        title="Ставки комиссии команд"
        description="Процент продавцов, менеджеров и тимлидов"
        action="Перейти"
        onClick={() => navigate('/owner/team-directory')}
      >
        <p className="text-[13px] text-slate-500 leading-relaxed">
          Структура комиссии настраивается в разделе <strong>Команды</strong> — профиль
          каждой команды и сотрудника.
        </p>
      </SettingsCard>
    </div>
  )
}
