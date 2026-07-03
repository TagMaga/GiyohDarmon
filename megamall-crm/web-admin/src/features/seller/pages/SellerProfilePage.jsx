import { useLocation, Outlet, Link, NavLink } from 'react-router-dom'
import { Info, Users, ChevronRight, LogOut, Trophy, Percent, Pencil } from 'lucide-react'
import { useSellerMe, useSellerCompensation, useSellerTeamRank, useMyTeam } from '../hooks/useSellerMe'
import useSellerOrders from '../hooks/useSellerOrders'
import useAuthStore from '../../../shared/store/authStore'
import { M, MobileShell, Card, StatTile, InitialsAvatar, SectionLabel } from '../components/mobileUi'

function monthsOnline(iso) {
  if (!iso) return null
  const start = new Date(iso)
  if (Number.isNaN(start.getTime())) return null
  const months = (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  return Math.max(1, Math.floor(months))
}

const NAV_CARDS = [
  {
    to: '/seller/profile/info',
    icon: Info,
    label: 'Мои данные',
    desc: 'Имя, телефон, Telegram',
    iconBg: '#EEF2FF',
    iconColor: '#4F46E5',
  },
  {
    to: '/seller/profile/team',
    icon: Users,
    label: 'Моя команда',
    desc: 'Рейтинг и состав команды',
    iconBg: '#FEF3C7',
    iconColor: '#D97706',
  },
]

export default function SellerProfilePage() {
  const { pathname } = useLocation()
  const isRoot = pathname === '/seller/profile'

  const { data: me, isLoading } = useSellerMe()
  const { data: compensation } = useSellerCompensation()
  const { data: rankData } = useSellerTeamRank()
  const { data: myTeam } = useMyTeam()
  const { orders = [] } = useSellerOrders()
  const logout = useAuthStore(s => s.clearAuth)

  const fullName = me?.full_name ?? ''
  const initials = fullName.split(' ').map(n => n[0] ?? '').join('').slice(0, 2).toUpperCase() || 'SE'
  const commissionPct = compensation?.commission_percent ?? null
  const rank = rankData?.rank ?? null
  const totalMembers = rankData?.total_members ?? null
  const tenure = monthsOnline(me?.hire_date ?? me?.created_at)
  const teamSize = (myTeam?.members?.length ?? 0) + (myTeam?.team_lead ? 1 : 0) + (myTeam?.manager ? 1 : 0)
  const teamDesc = myTeam
    ? [myTeam.manager && 'менеджер', myTeam.team_lead && 'тимлид', myTeam.members?.length ? `${myTeam.members.length} коллег` : null]
        .filter(Boolean).join(', ')
    : 'Рейтинг и состав команды'

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP LAYOUT
      ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex gap-6 items-start p-6">

        {/* Left column — profile card + nav */}
        <div className="w-[240px] flex-shrink-0 space-y-4">

          {/* Profile card */}
          <div
            className="rounded-[24px] p-6 text-center"
            style={{
              background: 'linear-gradient(135deg,#1E293B,#334155)',
              boxShadow: '0 2px 8px rgba(15,23,42,0.15), 0 16px 40px rgba(15,23,42,0.2)',
            }}
          >
            {/* Avatar */}
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black text-white mx-auto mb-4"
              style={{ background: 'linear-gradient(135deg,#4F46E5,#6D28D9)' }}
            >
              {isLoading ? '…' : initials}
            </div>
            <p className="text-base font-black text-white truncate">
              {isLoading ? '—' : (fullName || '—')}
            </p>
            <p className="text-xs text-slate-400 mt-1">Продавец</p>
            {me?.phone && (
              <p className="text-[11px] text-slate-500 mt-1">{me.phone}</p>
            )}

            {/* Stat chips */}
            {(commissionPct !== null || rank !== null) && (
              <div className="flex flex-wrap gap-2 justify-center mt-4">
                {commissionPct !== null && (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
                    style={{ background: 'rgba(99,102,241,0.25)', color: '#A5B4FC' }}
                  >
                    <Percent size={10} />
                    {commissionPct}%
                  </span>
                )}
                {rank !== null && (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
                    style={{ background: 'rgba(245,158,11,0.2)', color: '#FCD34D' }}
                  >
                    <Trophy size={10} />
                    #{rank}{totalMembers ? `/${totalMembers}` : ''}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Desktop nav list */}
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

          {/* Logout */}
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

        {/* Right column — content */}
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

      {/* ═══════════════════════════════════════════════════════════
          MOBILE LAYOUT — Seller Panel Redesign
      ═══════════════════════════════════════════════════════════ */}
      <MobileShell>
        <div className="px-5">
          {isRoot ? (
            <>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0, paddingTop: 8 }}>Профиль</h1>

              {/* Profile card */}
              <Card className="flex flex-col items-center text-center" style={{ borderRadius: 20, padding: '22px 18px', marginTop: 14 }}>
                <div className="relative">
                  <div
                    className="flex items-center justify-center"
                    style={{ width: 80, height: 80, borderRadius: '50%', background: '#E7E5FB', color: M.indigoDeep, fontWeight: 800, fontSize: 26 }}
                  >
                    {isLoading ? '…' : initials}
                  </div>
                  <Link
                    to="/seller/profile/info"
                    className="absolute flex items-center justify-center"
                    style={{ right: -2, bottom: -2, width: 28, height: 28, borderRadius: '50%', background: M.indigo, border: '3px solid #fff', color: '#fff' }}
                  >
                    <Pencil size={12} />
                  </Link>
                </div>
                <div style={{ fontSize: 19, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 14 }}>
                  {isLoading ? '…' : (fullName || '—')}
                </div>
                {me?.phone && <div style={{ fontSize: 13.5, color: M.sub, fontWeight: 500, marginTop: 3 }}>{me.phone}</div>}
                <div className="flex items-center gap-[6px]" style={{ marginTop: 11, background: '#F0EFEA', padding: '5px 12px', borderRadius: 9 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#76766E' }}>Продавец</span>
                  {myTeam?.team_name && (
                    <>
                      <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#C7C5BC' }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#76766E' }}>{myTeam.team_name}</span>
                    </>
                  )}
                </div>
              </Card>

              {/* Stat tiles */}
              <div className="grid grid-cols-3 gap-[9px]" style={{ marginTop: 12 }}>
                <Card style={{ borderRadius: 15, padding: '13px 10px', textAlign: 'center' }}>
                  <div className="flex items-center justify-center gap-1">
                    <Trophy size={14} style={{ color: '#D97706' }} />
                    <span style={{ fontSize: 19, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>
                      {rank !== null ? `#${rank}` : '—'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: M.sub, fontWeight: 600, marginTop: 3 }}>
                    {totalMembers ? `Из ${totalMembers} в команде` : 'В команде'}
                  </div>
                </Card>
                <Card style={{ borderRadius: 15, padding: '13px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 19, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>{orders.length}</div>
                  <div style={{ fontSize: 11, color: M.sub, fontWeight: 600, marginTop: 3 }}>Заказов</div>
                </Card>
                <Card style={{ borderRadius: 15, padding: '13px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 19, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>{tenure ?? '—'}</div>
                  <div style={{ fontSize: 11, color: M.sub, fontWeight: 600, marginTop: 3 }}>Мес. в сети</div>
                </Card>
              </div>

              {/* Team section */}
              <SectionLabel style={{ margin: '22px 4px 10px' }}>Команда</SectionLabel>
              <Card className="overflow-hidden">
                <Link to="/seller/profile/team" className="flex items-center gap-3" style={{ padding: '14px 15px' }}>
                  <div className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 11, background: M.amberBg, color: M.amber }}>
                    <Users size={17} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 14, fontWeight: 700, color: M.ink }}>Моя команда</div>
                    <div className="truncate" style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>
                      {teamSize > 0 ? teamDesc : 'Рейтинг и состав команды'}
                    </div>
                  </div>
                  <ChevronRight size={17} style={{ color: '#C7C5BC' }} className="flex-shrink-0" />
                </Link>
              </Card>

              {/* Account section */}
              <SectionLabel style={{ margin: '20px 4px 10px' }}>Аккаунт</SectionLabel>
              <Card className="overflow-hidden">
                <Link to="/seller/profile/info" className="flex items-center gap-3" style={{ padding: '13px 15px' }}>
                  <div className="flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, color: '#76766E' }}>
                    <Info size={18} />
                  </div>
                  <span className="flex-1" style={{ fontSize: 13.5, fontWeight: 600, color: M.ink }}>Личные данные</span>
                  <ChevronRight size={16} style={{ color: '#C7C5BC' }} />
                </Link>
              </Card>

              {/* Logout */}
              <button
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
                style={{
                  background: '#FDECEC', color: '#B91C1C', border: 'none', fontFamily: 'inherit',
                  fontSize: 14, fontWeight: 700, padding: 13, borderRadius: 14, cursor: 'pointer', marginTop: 20,
                }}
              >
                <LogOut size={16} />
                Выйти из аккаунта
              </button>
              <div className="text-center" style={{ fontSize: 11.5, color: M.faint, fontWeight: 500, margin: '14px 0 6px' }}>
                MegaMall Seller
              </div>
            </>
          ) : (
            <div className="space-y-4" style={{ paddingTop: 8 }}>
              <Link
                to="/seller/profile"
                className="inline-flex items-center gap-1.5"
                style={{ fontSize: 12.5, fontWeight: 700, color: M.indigo }}
              >
                <ChevronRight size={13} className="rotate-180" />
                Назад к профилю
              </Link>
              <Outlet />
            </div>
          )}
        </div>
      </MobileShell>
    </>
  )
}
