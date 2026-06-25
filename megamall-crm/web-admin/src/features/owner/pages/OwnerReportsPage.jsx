import { BarChart2, TrendingUp, Truck, Package, Users, FileText, Clock } from 'lucide-react'

const PLANNED_REPORTS = [
  {
    icon: TrendingUp,
    title: 'Выручка по периодам',
    description: 'Динамика продаж, доставки и чистой прибыли с разбивкой по дням и месяцам.',
    color: 'indigo',
  },
  {
    icon: Users,
    title: 'Разбивка комиссий',
    description: 'Выплаты продавцам, менеджерам и тимлидам за выбранный период.',
    color: 'violet',
  },
  {
    icon: Truck,
    title: 'Эффективность курьеров',
    description: 'Показатели доставки: успешность, среднее время, долги и выплаты.',
    color: 'emerald',
  },
  {
    icon: Package,
    title: 'Оборот товаров',
    description: 'Движение по складу, топ продаваемых позиций, списания и остатки.',
    color: 'amber',
  },
  {
    icon: Users,
    title: 'Активность сотрудников',
    description: 'Количество заказов и конверсия по каждому продавцу и менеджеру.',
    color: 'sky',
  },
  {
    icon: FileText,
    title: 'Финансовый аудит',
    description: 'Полный журнал финансовых событий: выручка, комиссии, выплаты курьерам.',
    color: 'rose',
  },
]

const COLOR_MAP = {
  indigo: { bg: 'bg-indigo-50',  icon: 'text-indigo-500',  border: 'border-indigo-100' },
  violet: { bg: 'bg-violet-50',  icon: 'text-violet-500',  border: 'border-violet-100' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-500', border: 'border-emerald-100' },
  amber:  { bg: 'bg-amber-50',   icon: 'text-amber-500',   border: 'border-amber-100'  },
  sky:    { bg: 'bg-sky-50',     icon: 'text-sky-500',     border: 'border-sky-100'    },
  rose:   { bg: 'bg-rose-50',    icon: 'text-rose-500',    border: 'border-rose-100'   },
}

export default function OwnerReportsPage() {
  return (
    <div className="p-4 md:p-6 space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Отчёты</h1>
        <p className="text-sm text-slate-500 mt-0.5">Аналитика и экспорт данных</p>
      </div>

      {/* Status banner */}
      <div className="bg-slate-900 rounded-2xl px-6 py-5 flex items-start gap-4">
        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
          <BarChart2 size={20} className="text-white" />
        </div>
        <div>
          <p className="text-white font-semibold text-[15px]">Раздел отчётов в разработке</p>
          <p className="text-slate-400 text-[13px] mt-1 leading-relaxed max-w-xl">
            Все данные уже собираются в финансовом журнале. Экспорт и визуализация
            будут доступны в следующем обновлении. Текущие данные доступны
            в разделах Финансы и Дашборд.
          </p>
        </div>
      </div>

      {/* Planned reports grid */}
      <div>
        <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-4">
          Запланированные отчёты
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PLANNED_REPORTS.map((r) => {
            const c = COLOR_MAP[r.color]
            return (
              <div
                key={r.title}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex items-start gap-4"
              >
                <div className={`w-10 h-10 ${c.bg} border ${c.border} rounded-xl flex items-center justify-center flex-shrink-0`}>
                  <r.icon size={18} className={c.icon} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[14px] font-semibold text-slate-900">{r.title}</p>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                      <Clock size={9} />
                      Скоро
                    </span>
                  </div>
                  <p className="text-[13px] text-slate-500 leading-relaxed">{r.description}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Current data note */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-4">
        <p className="text-[13px] font-semibold text-indigo-800 mb-1">Где данные сейчас?</p>
        <ul className="text-[12px] text-indigo-700 space-y-1">
          <li>• <strong>Выручка и прибыль</strong> — Дашборд (блок «Разбивка прибыли») и Финансы</li>
          <li>• <strong>Заказы</strong> — раздел Заказы с фильтром по статусу</li>
          <li>• <strong>Курьеры</strong> — раздел Курьеры и Логистика</li>
          <li>• <strong>Склад</strong> — раздел Склад с остатками в реальном времени</li>
        </ul>
      </div>
    </div>
  )
}
