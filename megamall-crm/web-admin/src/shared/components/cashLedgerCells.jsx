/**
 * Shared row-rendering pieces for the merged cash ledger (courier→dispatcher
 * handovers + dispatcher→company settlements), used by both the owner
 * logistics cash tab (CashLedgerPanel) and the dispatcher panel
 * (CompanySettlementTab) so the two views render identically.
 */
import { Eye } from 'lucide-react'
import { APP_TIMEZONE } from '../utils/date'

export const fmt = (n) => Number(n ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })

export const fmtDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: APP_TIMEZONE,
  })
}

export const STATUS_CFG = {
  pending:   { label: 'Ожидает',   badge: 'amber'   },
  confirmed: { label: 'Принято',   badge: 'emerald' },
  rejected:  { label: 'Отклонено', badge: 'rose'    },
  disputed:  { label: 'Спор',      badge: 'violet'  },
}
export const statusLabel = (s) => STATUS_CFG[s]?.label ?? s ?? '—'
export const ACTION_LABEL = { confirm: 'Подтверждение', reject: 'Отклонение', edit: 'Изменение', update: 'Обновление' }

export const ROLE_LABEL = { courier: 'Курьер', dispatcher: 'Диспетчер', company: 'Компания' }
export const ROLE_CLASS = {
  courier: 'bg-sky-50 text-sky-700',
  dispatcher: 'bg-indigo-50 text-indigo-700',
  company: 'bg-amber-50 text-amber-700',
}

export function PersonCell({ name, role }) {
  if (!name) return <span className="text-slate-300 text-xs">—</span>
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold text-slate-800">{name}</span>
      {role && (
        <span className={`self-start text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${ROLE_CLASS[role] ?? 'bg-slate-100 text-slate-600'}`}>
          {ROLE_LABEL[role] ?? role}
        </span>
      )}
    </div>
  )
}

export function DiffCell({ expected, actual }) {
  if (actual == null) return <span className="text-slate-300">—</span>
  const diff = actual - expected
  if (Math.abs(diff) < 0.01) return <span className="text-emerald-600 font-semibold tabular-nums">= 0</span>
  if (diff < 0) return <span className="text-rose-600 font-semibold tabular-nums">−{fmt(Math.abs(diff))}</span>
  return <span className="text-amber-600 font-semibold tabular-nums">+{fmt(diff)}</span>
}

export function DebtCell({ amount }) {
  const owes = (amount ?? 0) > 0.01
  return (
    <span className={`inline-flex ${owes ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'} font-semibold tabular-nums px-2 py-0.5 rounded-full text-xs`}>
      {owes ? fmt(amount) : '0'} c
    </span>
  )
}

export function ReceiptThumb({ mediaAssets, onClick }) {
  const assets = Array.isArray(mediaAssets) ? mediaAssets : []
  if (assets.length === 0) return <span className="text-slate-300 text-xs">—</span>
  const first = assets[0]
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      className="group relative w-10 h-10 rounded-lg overflow-hidden border border-slate-200 hover:border-indigo-400 transition-all flex-shrink-0"
      title="Просмотр квитанции"
    >
      <img src={first.thumb_url || first.url} alt="квитанция" loading="lazy" className="w-full h-full object-cover" />
      {assets.length > 1 && (
        <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[9px] px-1 rounded-tl">+{assets.length - 1}</span>
      )}
      <div className="absolute inset-0 bg-indigo-600/0 group-hover:bg-indigo-600/20 transition-all flex items-center justify-center">
        <Eye size={12} className="text-white opacity-0 group-hover:opacity-100 transition-all" />
      </div>
    </button>
  )
}

export const LEDGER_TABLE_HEADERS = ['Дата', 'Отправитель', 'Получатель', 'Ожидалось', 'Отправил', 'Разница', 'Текущий долг', 'Квитанция', 'Статус', 'Действия']
