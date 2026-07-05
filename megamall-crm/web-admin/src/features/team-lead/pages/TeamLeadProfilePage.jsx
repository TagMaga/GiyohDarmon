/**
 * TeamLeadProfilePage — /team-lead/profile ("Профиль")
 *
 * New page — Team Lead had no Profile route before this redesign. Mirrors
 * SellerProfilePage.jsx's shell (identity card, stat tiles, nav cards,
 * logout), swapping in team-lead data sources. "Личные данные" nests
 * SellerProfileInfoPage — same functional edit form Manager already reuses,
 * since /profile/me is role-agnostic (not actually seller-specific despite
 * living under features/seller).
 *
 * The mockup's third stat tile was a star "rating" with no backing data
 * anywhere in this codebase (no rating concept exists for team leads) — swapped
 * for "Заказов" (team orders this period), which is real and in the same spot.
 */
import { useLocation, Outlet, Link, NavLink } from 'react-router-dom'
import { Info, Users, ChevronRight, LogOut } from 'lucide-react'
import useCurrentUser from '../../../shared/hooks/useCurrentUser'
import useProfile from '../../../shared/hooks/useProfile'
import useAuthStore from '../../../shared/store/authStore'
import useMyTeam from '../hooks/useMyTeam'
import usePayables from '../hooks/usePayables'
import { M, MobileShell, Card, SectionLabel } from '../../seller/components/mobileUi'

function toYMD(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthsOnline(iso) {
  if (!iso) return null
  const start = new Date(iso)
  if (Number.isNaN(start.getTime())) return null
  const months = (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  return Math.max(1, Math.floor(months))
}

export default function TeamLeadProfilePage() {
  const { pathname } = useLocation()
  const isRoot = pathname === '/team-lead/profile'

  const { userId } = useCurrentUser()
  const { fullName, initials, phone, employee } = useProfile()
  const { team } = useMyTeam()
  const logout = useAuthStore(s => s.clearAuth)

  const now  = new Date()
  const from = toYMD(new Date(now.getFullYear(), now.getMonth(), 1))
  const to   = toYMD(now)
  const { data: payables } = usePayables(userId, { from, to })
  const members = payables?.members ?? []
  const sellerCount = members.filter(m => m.role === 'seller').length
  const periodOrders = members.reduce((sum, m) => sum + (m.orders_count ?? 0), 0)

  const tenure = monthsOnline(employee?.hire_date ?? employee?.created_at)

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP LAYOUT — Teamlead Panel Redesign
      ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex flex-col gap-5" style={{ minHeight: '100vh', fontFamily: M.font, ...(isRoot ? { padding: '36px 44px' } : {}) }}>
        {!isRoot ? (
          <Outlet />
        ) : (
        <>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Профиль</h1>

        <div className="grid gap-5 flex-1 min-h-0" style={{ gridTemplateColumns: '340px 1fr' }}>
          {/* Left: identity card */}
          <div className="flex flex-col gap-4 overflow-hidden">
            <Card style={{ borderRadius: 20, padding: '28px 22px' }} className="flex flex-col items-center text-center">
              <div
                className="flex items-center justify-center"
                style={{ width: 88, height: 88, borderRadius: '50%', background: M.amberBg, color: M.amber, fontWeight: 800, fontSize: 29 }}
              >
                {initials}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 16 }}>
                {fullName || '—'}
              </div>
              {phone && <div style={{ fontSize: 14, color: M.sub, fontWeight: 500, marginTop: 3 }}>{phone}</div>}
              <div className="flex items-center gap-[6px]" style={{ marginTop: 12, background: '#F0EFEA', padding: '6px 14px', borderRadius: 9 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#76766E' }}>Тимлид</span>
                {team?.name && (
                  <>
                    <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#C7C5BC' }} />
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#76766E' }}>{team.name}</span>
                  </>
                )}
              </div>
            </Card>

            <div className="grid grid-cols-3 gap-[10px]">
              <Card style={{ borderRadius: 15, padding: '14px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: M.ink }}>{sellerCount}</div>
                <div style={{ fontSize: 11, color: M.sub, fontWeight: 600, marginTop: 3 }}>Продавцов</div>
              </Card>
              <Card style={{ borderRadius: 15, padding: '14px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: M.ink }}>{periodOrders}</div>
                <div style={{ fontSize: 11, color: M.sub, fontWeight: 600, marginTop: 3 }}>Заказов</div>
              </Card>
              <Card style={{ borderRadius: 15, padding: '14px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: M.ink }}>{tenure ?? '—'}</div>
                <div style={{ fontSize: 11, color: M.sub, fontWeight: 600, marginTop: 3 }}>Мес. в должности</div>
              </Card>
            </div>

            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
              style={{ background: '#FDECEC', color: '#B91C1C', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, padding: 14, borderRadius: 14, cursor: 'pointer' }}
            >
              <LogOut size={16} />
              Выйти из аккаунта
            </button>
          </div>

          {/* Right: team + account nav */}
          <div className="overflow-hidden flex flex-col gap-5">
            <div>
              <SectionLabel style={{ margin: '0 0 10px' }}>Команда</SectionLabel>
              <Card style={{ borderRadius: 16, overflow: 'hidden' }}>
                <NavLink to="/team-lead/team" className="flex items-center gap-[14px]" style={{ padding: '16px 20px' }}>
                  <div className="flex items-center justify-center flex-shrink-0" style={{ width: 42, height: 42, borderRadius: 12, background: M.amberBg, color: M.amber }}>
                    <Users size={19} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 15, fontWeight: 700, color: M.ink }}>Команда</div>
                    <div className="truncate" style={{ fontSize: 12.5, color: M.muted, marginTop: 1 }}>
                      {sellerCount} продавцов
                    </div>
                  </div>
                  <ChevronRight size={18} style={{ color: '#C7C5BC' }} className="flex-shrink-0" />
                </NavLink>
              </Card>
            </div>

            <div>
              <SectionLabel style={{ margin: '0 0 10px' }}>Аккаунт</SectionLabel>
              <Card style={{ borderRadius: 16, overflow: 'hidden' }}>
                <NavLink to="/team-lead/profile/info" className="flex items-center gap-[14px]" style={{ padding: '15px 20px' }}>
                  <div className="flex items-center justify-center flex-shrink-0" style={{ width: 34, height: 34, color: '#76766E' }}>
                    <Info size={19} />
                  </div>
                  <span className="flex-1" style={{ fontSize: 14.5, fontWeight: 600, color: M.ink }}>Личные данные</span>
                  <ChevronRight size={17} style={{ color: '#C7C5BC' }} />
                </NavLink>
              </Card>
            </div>
          </div>
        </div>
        </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          MOBILE LAYOUT — Teamlead Panel Redesign
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
                    style={{ width: 80, height: 80, borderRadius: '50%', background: M.amberBg, color: M.amber, fontWeight: 800, fontSize: 26 }}
                  >
                    {initials}
                  </div>
                  <div className="absolute" style={{ right: -2, bottom: -2, width: 28, height: 28, borderRadius: '50%', background: M.indigo, border: '3px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                  </div>
                </div>
                <div style={{ fontSize: 19, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 14 }}>
                  {fullName || '—'}
                </div>
                {phone && <div style={{ fontSize: 13.5, color: M.sub, fontWeight: 500, marginTop: 3 }}>{phone}</div>}
                <div className="flex items-center gap-[6px]" style={{ marginTop: 11, background: '#F0EFEA', padding: '5px 12px', borderRadius: 9 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#76766E' }}>Тимлид</span>
                  {team?.name && (
                    <>
                      <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#C7C5BC' }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#76766E' }}>{team.name}</span>
                    </>
                  )}
                </div>
              </Card>

              {/* Stat tiles */}
              <div className="grid grid-cols-3 gap-[9px]" style={{ marginTop: 12 }}>
                <Card style={{ borderRadius: 15, padding: '13px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 19, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>{sellerCount}</div>
                  <div style={{ fontSize: 11, color: M.sub, fontWeight: 600, marginTop: 3 }}>Продавцов</div>
                </Card>
                <Card style={{ borderRadius: 15, padding: '13px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 19, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>{periodOrders}</div>
                  <div style={{ fontSize: 11, color: M.sub, fontWeight: 600, marginTop: 3 }}>Заказов</div>
                </Card>
                <Card style={{ borderRadius: 15, padding: '13px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 19, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>{tenure ?? '—'}</div>
                  <div style={{ fontSize: 11, color: M.sub, fontWeight: 600, marginTop: 3 }}>Мес. в должности</div>
                </Card>
              </div>

              {/* Team section */}
              <SectionLabel style={{ margin: '22px 4px 10px' }}>Команда</SectionLabel>
              <Card className="overflow-hidden">
                <Link to="/team-lead/team" className="flex items-center gap-3" style={{ padding: '14px 15px' }}>
                  <div className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 11, background: M.amberBg, color: M.amber }}>
                    <Users size={17} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 14, fontWeight: 700, color: M.ink }}>Команда</div>
                    <div className="truncate" style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>
                      {sellerCount} продавцов
                    </div>
                  </div>
                  <ChevronRight size={17} style={{ color: '#C7C5BC' }} className="flex-shrink-0" />
                </Link>
              </Card>

              {/* Account section */}
              <SectionLabel style={{ margin: '20px 4px 10px' }}>Аккаунт</SectionLabel>
              <Card className="overflow-hidden">
                <Link to="/team-lead/profile/info" className="flex items-center gap-3" style={{ padding: '13px 15px' }}>
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
                MegaMall Тимлид · v1.0.0
              </div>
            </>
          ) : (
            <div className="space-y-4" style={{ paddingTop: 8 }}>
              <Link
                to="/team-lead/profile"
                aria-label="Назад к профилю"
                className="inline-flex items-center justify-center active:scale-95 transition-transform"
                style={{ width: 34, height: 34, borderRadius: 12, color: M.indigo, background: '#fff', border: `1px solid ${M.borderAlt}` }}
              >
                <ChevronRight size={16} className="rotate-180" />
              </Link>
              <Outlet />
            </div>
          )}
        </div>
      </MobileShell>
    </>
  )
}
