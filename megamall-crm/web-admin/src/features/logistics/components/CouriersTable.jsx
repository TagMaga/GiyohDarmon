/**
 * CouriersTable — full courier list with operational stats.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Search, Clock, Pencil, DollarSign, Power } from 'lucide-react'
import Badge from '../../../shared/components/Badge'
import { KEYS } from '../../../shared/queryKeys'
import { EditCourierModal, TariffsModal, ToggleOrderIntakeModal } from '../../dispatcher/components/CourierManageModals'

const fmtMoney = (n) =>
  n == null ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

const fmtPct = (n) =>
  n == null ? '—' : `${Number(n).toFixed(1)}%`

const fmtMin = (n) => {
  if (!n || n === 0) return '—'
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return h > 0 ? `${h}ч ${m}м` : `${m}м`
}

const fmtDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_CONFIG = {
  free:     { label: 'Свободен',  badge: 'emerald' },
  busy:     { label: 'Занят',     badge: 'amber'   },
  inactive: { label: 'Неактивен', badge: 'slate'   },
}

const AVATAR_COLORS = ['#10b981', '#38bdf8', '#f43f5e', '#f59e0b', '#8b5cf6', '#14b8a6', '#6366f1']
function avatarColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
function initials(name = '') {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return (parts[0]?.[0] ?? '?').toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function CourierAvatar({ name }) {
  return (
    <span
      className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
      style={{ background: avatarColor(name ?? '') }}
    >
      {initials(name ?? '')}
    </span>
  )
}

export default function CouriersTable({ couriers = [], loading }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [editTarget, setEditTarget] = useState(null)
  const [tariffsTarget, setTariffsTarget] = useState(null)
  const [toggleTarget, setToggleTarget] = useState(null)

  const filtered = couriers.filter(c =>
    !search ||
    c.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search)
  )

  const refreshCouriers = () => {
    qc.invalidateQueries({ queryKey: KEYS.logistics.couriers })
  }

  const ActionButtons = ({ courier }) => {
    const operational = courier.is_active !== false && courier.order_intake_enabled !== false
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          title="Изменить"
          onClick={() => setEditTarget(courier)}
          className="inline-flex items-center justify-center rounded-[7px] bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 transition-colors px-2 py-1.5"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          title="Тарифы"
          onClick={() => setTariffsTarget(courier)}
          className="inline-flex items-center justify-center rounded-[7px] bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors px-2 py-1.5"
        >
          <DollarSign size={14} />
        </button>
        <button
          type="button"
          title={operational ? 'Отключить приём заказов' : courier.is_active === false ? 'Активировать курьера' : 'Включить приём заказов'}
          onClick={() => setToggleTarget(courier)}
          className={[
            'inline-flex items-center justify-center rounded-[7px] transition-colors px-2 py-1.5',
            operational
              ? 'bg-rose-500/10 text-rose-600 hover:bg-rose-500/20'
              : 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20',
          ].join(' ')}
        >
          <Power size={14} />
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="skeleton w-48 h-8 rounded-xl" />
        </div>
        {[1,2,3,4,5].map(i => (
          <div key={i} className="px-5 py-4 border-b border-slate-50 flex gap-4">
            <div className="skeleton w-32 h-4 rounded-full" />
            <div className="skeleton w-24 h-4 rounded-full" />
            <div className="skeleton w-16 h-4 rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
    <div className="card overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9 py-2 text-base"
            placeholder="Поиск по имени или телефону…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className="text-xs text-slate-400">{filtered.length} курьер{filtered.length !== 1 ? 'ов' : ''}</span>
      </div>

      {/* Table — desktop */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              {['Курьер', 'Статус', 'Активн.', 'Сегодня', 'Доставл.', 'Неудача', 'Успех', 'Ср.время', 'Долг', 'Заработок', 'Послед. акт.'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-sm text-slate-400">
                  Курьеры не найдены
                </td>
              </tr>
            )}
            {filtered.map(c => {
              const sc = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.free
              return (
                <tr key={c.courier_id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CourierAvatar name={c.full_name} />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">{c.full_name}</p>
                        <p className="text-[11px] text-slate-400">{c.phone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={sc.badge}>{sc.label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-700 tabular-nums">{c.active_orders}</td>
                  <td className="px-4 py-3 text-slate-700 tabular-nums">{c.orders_today}</td>
                  <td className="px-4 py-3 text-emerald-700 font-medium tabular-nums">{c.delivered_today}</td>
                  <td className="px-4 py-3">
                    {c.failed_today > 0
                      ? <span className="text-rose-600 font-medium">{c.failed_today}</span>
                      : <span className="text-slate-400">0</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-semibold tabular-nums ${
                      c.success_rate >= 90 ? 'text-emerald-600' :
                      c.success_rate >= 70 ? 'text-amber-600' : 'text-rose-600'
                    }`}>
                      {fmtPct(c.success_rate)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs tabular-nums">
                    <span className="flex items-center gap-1">
                      <Clock size={11} className="text-slate-400" />
                      {fmtMin(c.avg_delivery_minutes)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {c.cash_debt > 0
                      ? <span className="text-rose-600 font-semibold tabular-nums">{fmtMoney(c.cash_debt)} сом</span>
                      : <span className="text-slate-300">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-slate-700 tabular-nums text-xs">{fmtMoney(c.earnings)} сом</td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmtDate(c.last_activity_at)}</td>
                  <td className="px-4 py-3">
                    <ActionButtons courier={c} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden divide-y divide-slate-50">
        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">Курьеры не найдены</p>
        )}
        {filtered.map(c => {
          const sc = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.free
          return (
            <div
              key={c.courier_id}
              className="w-full text-left px-5 py-4 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CourierAvatar name={c.full_name} />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{c.full_name}</p>
                    <p className="text-xs text-slate-400">{c.phone}</p>
                  </div>
                </div>
                <Badge variant={sc.badge}>{sc.label}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-slate-400">Сегодня</p>
                  <p className="font-medium text-slate-800">{c.delivered_today}/{c.orders_today}</p>
                </div>
                <div>
                  <p className="text-slate-400">Успех</p>
                  <p className="font-medium text-slate-800">{fmtPct(c.success_rate)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Долг</p>
                  <p className={`font-medium ${c.cash_debt > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                    {c.cash_debt > 0 ? `${fmtMoney(c.cash_debt)} сом` : '—'}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <ActionButtons courier={c} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
    {editTarget && (
      <EditCourierModal
        courier={editTarget}
        onClose={() => setEditTarget(null)}
        onSuccess={() => {
          setEditTarget(null)
          refreshCouriers()
        }}
      />
    )}
    {tariffsTarget && (
      <TariffsModal courier={tariffsTarget} onClose={() => setTariffsTarget(null)} />
    )}
    {toggleTarget && (
      <ToggleOrderIntakeModal
        courier={toggleTarget}
        onClose={() => setToggleTarget(null)}
        onSuccess={() => {
          setToggleTarget(null)
          refreshCouriers()
        }}
      />
    )}
    </>
  )
}
