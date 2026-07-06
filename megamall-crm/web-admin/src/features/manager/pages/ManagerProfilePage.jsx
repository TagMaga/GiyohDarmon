import { useLocation, Outlet, Link, NavLink } from 'react-router-dom'
import { Info, ChevronRight, LogOut, Percent } from 'lucide-react'
import { useSellerMe, useSellerCompensation } from '../../seller/hooks/useSellerMe'
import useAuthStore from '../../../shared/store/authStore'

const NAV_CARDS = [
  {
    to: '/manager/profile/info',
    icon: Info,
    label: 'Мои данные',
    desc: 'Имя, телефон, Telegram',
    iconBg: '#EEF2FF',
    iconColor: '#4F46E5',
  },
]

export default function ManagerProfilePage() {
  const { pathname } = useLocation()
  const isRoot = pathname === '/manager/profile'

  const { data: me, isLoading } = useSellerMe()
  const { data: compensation } = useSellerCompensation()
  const logout = useAuthStore(s => s.clearAuth)

  const fullName = me?.full_name ?? ''
  const initials = fullName.split(' ').map(n => n[0] ?? '').join('').slice(0, 2).toUpperCase() || 'MG'
  const commissionPct = compensation?.commission_rate != null ? +(compensation.commission_rate * 100).toFixed(1) : null

  return (
    <>
      {/* ── DESKTOP ── */}
      <div className="hidden lg:flex gap-6 items-start">
        <div className="w-[240px] flex-shrink-0 space-y-4">
          <div
            className="rounded-[24px] p-6 text-center"
            style={{
              background: 'linear-gradient(135deg,#1E293B,#334155)',
              boxShadow: '0 2px 8px rgba(15,23,42,0.15), 0 16px 40px rgba(15,23,42,0.2)',
            }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black text-white mx-auto mb-4"
              style={{ background: 'linear-gradient(135deg,#4F46E5,#6D28D9)' }}
            >
              {isLoading ? '…' : initials}
            </div>
            <p className="text-base font-black text-white truncate">
              {isLoading ? '—' : (fullName || '—')}
            </p>
            <p className="text-xs text-slate-400 mt-1">Менеджер</p>
            {me?.phone && <p className="text-[11px] text-slate-500 mt-1">{me.phone}</p>}
            {commissionPct !== null && (
              <div className="flex justify-center mt-4">
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
                  style={{ background: 'rgba(99,102,241,0.25)', color: '#A5B4FC' }}
                >
                  <Percent size={10} />
                  {commissionPct}%
                </span>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            {NAV_CARDS.map((card, idx) => (
              <NavLink
                key={card.to}
                to={card.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50
                   ${isActive ? 'bg-indigo-50/60 text-indigo-700' : 'text-slate-700'}
                   ${idx > 0 ? 'border-t border-slate-100' : ''}`
                }
              >
                {({ isActive }) => (
                  <>
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: isActive ? '#EEF2FF' : card.iconBg }}
                    >
                      <card.icon size={16} style={{ color: isActive ? '#4F46E5' : card.iconColor }} />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold truncate ${isActive ? 'text-indigo-700' : 'text-slate-900'}`}>
                        {card.label}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">{card.desc}</p>
                    </div>
                    {isActive && <div className="w-1 h-1 rounded-full bg-indigo-600 ml-auto flex-shrink-0" />}
                  </>
                )}
              </NavLink>
            ))}
          </div>

          <button
            onClick={logout}
            className="w-full card flex items-center gap-3 p-4 hover:bg-rose-50/60 transition-colors"
          >
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#FFF1F2' }}>
              <LogOut size={15} style={{ color: '#E11D48' }} />
            </div>
            <span className="text-sm font-semibold text-rose-600">Выйти из системы</span>
          </button>
        </div>

        <div className="flex-1 min-w-0">
          {isRoot ? (
            <div className="card p-8 text-center text-slate-400">
              <p className="text-sm">Выберите раздел слева</p>
            </div>
          ) : (
            <Outlet />
          )}
        </div>
      </div>

      {/* ── MOBILE ── */}
      <div className="lg:hidden min-h-screen" style={{ background: '#F2F4F7' }}>
        <div
          className="relative overflow-hidden px-5 pt-10 pb-8"
          style={{
            background: 'linear-gradient(135deg, #1E293B 0%, #334155 100%)',
            borderRadius: '0 0 32px 32px',
            boxShadow: '0 8px 32px rgba(15,23,42,0.3)',
          }}
        >
          <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-white/5 -translate-y-12 translate-x-12" />
          <div className="relative z-10 flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#4F46E5,#6D28D9)' }}
            >
              {isLoading ? '…' : initials}
            </div>
            <div className="min-w-0">
              <p className="text-lg font-black text-white truncate">
                {isLoading ? '…' : (fullName || '—')}
              </p>
              <p className="text-sm text-slate-400 mt-0.5">Менеджер</p>
              {me?.phone && <p className="text-xs text-slate-500 mt-0.5">{me.phone}</p>}
            </div>
          </div>
          {commissionPct !== null && (
            <div className="relative z-10 flex gap-2 mt-5">
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                style={{ background: 'rgba(99,102,241,0.25)', color: '#A5B4FC' }}
              >
                {commissionPct}% комиссия
              </span>
            </div>
          )}
        </div>

        <div className="px-4 pt-5 pb-28">
          {isRoot ? (
            <div className="space-y-3">
              {NAV_CARDS.map(card => (
                <Link
                  key={card.to}
                  to={card.to}
                  className="card flex items-center gap-4 p-4 active:scale-[0.99] transition-transform"
                  style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.05)' }}
                >
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{ background: card.iconBg }}
                  >
                    <card.icon size={18} style={{ color: card.iconColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900">{card.label}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{card.desc}</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
                </Link>
              ))}
              <div className="pt-2" />
              <button
                onClick={logout}
                className="w-full card flex items-center gap-4 p-4 active:scale-[0.99] transition-transform"
                style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.05)' }}
              >
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: '#FFF1F2' }}>
                  <LogOut size={16} style={{ color: '#E11D48' }} />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-bold text-rose-600">Выйти</p>
                  <p className="text-xs text-slate-400 mt-0.5">Выход из аккаунта</p>
                </div>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <Link
                to="/manager/profile"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 mb-1"
              >
                <ChevronRight size={13} className="rotate-180" />
                Назад к профилю
              </Link>
              <Outlet />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
