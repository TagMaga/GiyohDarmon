import { useNavigate } from 'react-router-dom'
import { Truck, MapPin, Settings, Users, ChevronRight, CheckCircle, XCircle } from 'lucide-react'
import useDeliverySettings from '../../seller/hooks/useDeliverySettings'
import useCities           from '../../seller/hooks/useCities'

const fmtMoney = (n) => (n == null ? '—' : `${(+n || 0).toLocaleString('ru-RU')} с`)

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

  const { data: settings, isLoading: settingsLoading } = useDeliverySettings()
  const { data: cities   = [], isLoading: citiesLoading }  = useCities()

  return (
    <div className="p-4 md:p-6 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Настройки</h1>
        <p className="text-sm text-slate-500 mt-0.5">Управление доставкой, тарифами и городами</p>
      </div>

      {/* Delivery fees */}
      <SettingsCard
        icon={Truck}
        title="Настройки доставки"
        description="Стоимость доставки для клиента"
        action="Изменить"
        onClick={() => navigate('/owner/settings/delivery')}
      >
        {settingsLoading ? (
          <p className="text-sm text-slate-400">Загрузка...</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Обычная доставка
              </p>
              <p className="text-[22px] font-bold text-slate-900 tracking-tight">
                {settings?.normal_fee === 0 ? 'Бесплатно' : fmtMoney(settings?.normal_fee)}
              </p>
              <p className="text-[11px] text-slate-400">для клиента</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Быстрая доставка
              </p>
              <p className="text-[22px] font-bold text-slate-900 tracking-tight">
                {fmtMoney(settings?.fast_fee)}
              </p>
              <p className="text-[11px] text-slate-400">для клиента</p>
            </div>
          </div>
        )}
      </SettingsCard>

      {/* Cities */}
      <SettingsCard
        icon={MapPin}
        title="Города доставки"
        description="Города, в которые работает доставка"
        action={null}
        onClick={() => {}}
      >
        {citiesLoading ? (
          <p className="text-sm text-slate-400">Загрузка...</p>
        ) : cities.length === 0 ? (
          <p className="text-sm text-slate-400">Нет городов</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {cities.map(c => (
              <span
                key={c.id}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border ${
                  c.is_active
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-slate-50 border-slate-200 text-slate-400'
                }`}
              >
                {c.is_active
                  ? <CheckCircle size={13} className="text-emerald-500" />
                  : <XCircle size={13} className="text-slate-400" />}
                {c.name}
              </span>
            ))}
          </div>
        )}
      </SettingsCard>

      {/* Courier payouts */}
      <SettingsCard
        icon={Settings}
        title="Тарифы выплат курьерам"
        description="Индивидуальные тарифы на нормальную и быструю доставку"
        action="Перейти"
        onClick={() => navigate('/owner/couriers')}
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
        onClick={() => navigate('/owner/teams')}
      >
        <p className="text-[13px] text-slate-500 leading-relaxed">
          Структура комиссии настраивается в разделе <strong>Команды</strong> — профиль
          каждой команды и сотрудника.
        </p>
      </SettingsCard>
    </div>
  )
}
