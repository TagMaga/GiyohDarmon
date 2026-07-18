import { useLocation, Outlet, Link, NavLink } from 'react-router-dom'
import { Info, ChevronRight, LogOut } from 'lucide-react'
import { useSellerMe } from '../../seller/hooks/useSellerMe'
import useAuthStore from '../../../shared/store/authStore'
import { M, MobileShell, Card, SectionLabel } from '../../seller/components/mobileUi'
import { withCacheBust } from '../../../shared/api/mediaUpload'

function monthsOnline(iso) {
  if (!iso) return null
  const start = new Date(iso)
  if (Number.isNaN(start.getTime())) return null
  const months = (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  return Math.max(1, Math.floor(months))
}

export default function OwnerProfilePage() {
  const { pathname } = useLocation()
  const isRoot = pathname === '/owner/profile'
  const isInfoRoute = pathname === '/owner/profile/info'

  const { data: me, isLoading } = useSellerMe()
  const logout = useAuthStore(s => s.clearAuth)

  const fullName = me?.full_name ?? ''
  const initials = fullName.split(' ').map(n => n[0] ?? '').join('').slice(0, 2).toUpperCase() || 'ВЛ'
  const avatarUrl = withCacheBust(me?.avatar_url, me?.updated_at)
  const tenure = monthsOnline(me?.hire_date ?? me?.created_at)

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP LAYOUT
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
              <div className="relative">
                <div
                  className="flex items-center justify-center overflow-hidden"
                  style={{ width: 88, height: 88, borderRadius: '50%', background: '#E7E5FB', color: M.indigoDeep, fontWeight: 800, fontSize: 29 }}
                >
                  {avatarUrl ? <img src={avatarUrl} alt={fullName || 'Профиль'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (isLoading ? '…' : initials)}
                </div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 16 }}>
                {isLoading ? '…' : (fullName || '—')}
              </div>
              {me?.phone && <div style={{ fontSize: 14, color: M.sub, fontWeight: 500, marginTop: 3 }}>{me.phone}</div>}
              <div className="flex items-center gap-[6px]" style={{ marginTop: 12, background: '#F0EFEA', padding: '6px 14px', borderRadius: 9 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#76766E' }}>Владелец</span>
                {tenure != null && (
                  <>
                    <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#C7C5BC' }} />
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#76766E' }}>{tenure} мес. в сети</span>
                  </>
                )}
              </div>
            </Card>

            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
              style={{ background: '#FDECEC', color: '#B91C1C', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, padding: 14, borderRadius: 14, cursor: 'pointer' }}
            >
              <LogOut size={16} />
              Выйти из аккаунта
            </button>
          </div>

          {/* Right: account nav */}
          <div className="overflow-hidden flex flex-col gap-5">
            <div>
              <SectionLabel style={{ margin: '0 0 10px' }}>Аккаунт</SectionLabel>
              <Card style={{ borderRadius: 16, overflow: 'hidden' }}>
                <NavLink to="/owner/profile/info" className="flex items-center gap-[14px]" style={{ padding: '15px 20px' }}>
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
          MOBILE LAYOUT
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
                    className="flex items-center justify-center overflow-hidden"
                    style={{ width: 80, height: 80, borderRadius: '50%', background: '#E7E5FB', color: M.indigoDeep, fontWeight: 800, fontSize: 26 }}
                  >
                    {avatarUrl ? <img src={avatarUrl} alt={fullName || 'Профиль'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (isLoading ? '…' : initials)}
                  </div>
                </div>
                <div style={{ fontSize: 19, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 14 }}>
                  {isLoading ? '…' : (fullName || '—')}
                </div>
                {me?.phone && <div style={{ fontSize: 13.5, color: M.sub, fontWeight: 500, marginTop: 3 }}>{me.phone}</div>}
                <div className="flex items-center gap-[6px]" style={{ marginTop: 11, background: '#F0EFEA', padding: '5px 12px', borderRadius: 9 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#76766E' }}>Владелец</span>
                  {tenure != null && (
                    <>
                      <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#C7C5BC' }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#76766E' }}>{tenure} мес. в сети</span>
                    </>
                  )}
                </div>
              </Card>

              {/* Account section */}
              <SectionLabel style={{ margin: '22px 4px 10px' }}>Аккаунт</SectionLabel>
              <Card className="overflow-hidden">
                <Link to="/owner/profile/info" className="flex items-center gap-3" style={{ padding: '13px 15px' }}>
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
                MegaMall Owner
              </div>
            </>
          ) : isInfoRoute ? (
            <Outlet />
          ) : (
            <div className="space-y-4" style={{ paddingTop: 8 }}>
              <Link
                to="/owner/profile"
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
