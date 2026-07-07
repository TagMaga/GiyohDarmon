import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Home, ShoppingCart, Plus, Wallet, User, Users, TrendingUp, Package, PackagePlus, BarChart3, LayoutGrid } from 'lucide-react'
import Sidebar from './Sidebar'
import useAuthStore from '../store/authStore'
import BottomNav from '../../features/seller/components/BottomNav'
import OwnerMoreSheet from '../../features/owner/components/OwnerMoreSheet'

const MANAGER_TABS = [
  { label: 'Главная',  icon: Home,         path: '/manager',              end: true  },
  { label: 'Команда',  icon: Users,        path: '/manager/orders',       end: false },
  { label: null,       icon: Plus,         path: '/manager/my-orders/create', end: false, fab: true },
  { label: 'Доходы',   icon: Wallet,       path: '/manager/income',       end: false },
  { label: 'Профиль',  icon: User,         path: '/manager/profile',      end: false },
]

const OWNER_BASE_TABS = [
  { label: 'Главная',  icon: Home,         path: '/owner',           end: true  },
  { label: 'Заказы',   icon: ShoppingCart, path: '/owner/orders',    end: false },
  { label: 'Финансы',  icon: TrendingUp,   path: '/owner/finance',   end: false },
  { label: 'Склад',    icon: Package,      path: '/owner/warehouse', end: false },
]

const OWNER_MORE_PATHS = ['/owner/budget', '/owner/logistics', '/owner/team-directory']

const WAREHOUSE_TABS = [
  { label: 'Главная', icon: Home,        path: '/warehouse',           end: true },
  { label: 'Товары',  icon: Package,     path: '/warehouse/inventory', end: false },
  { label: 'Приёмка', icon: PackagePlus, path: '/warehouse/receiving', end: false },
  { label: 'Движ.',   icon: BarChart3,   path: '/warehouse/movements', end: false },
  { label: 'Профиль', icon: User,        path: '/warehouse/profile',   end: false },
]

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [ownerMoreOpen, setOwnerMoreOpen] = useState(false)
  const location = useLocation()
  const { role } = useAuthStore()
  const isDispatcherBoard = location.pathname.startsWith('/dispatcher')
  const isOwner   = role === 'owner'
  const isSeller  = role === 'seller'
  const isManager = role === 'manager'
  const isWarehouse = role === 'warehouse_manager'
  const hasMobileNav = isOwner || isSeller || isManager || isWarehouse

  if (isDispatcherBoard) {
    return <Outlet />
  }

  return (
    <div className="min-h-screen" style={{ background: '#F2F4F7' }}>
      {/* Sidebar — hidden on mobile for seller (replaced by BottomNav) */}
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`flex flex-col min-h-screen transition-[padding] duration-300 ease-in-out ${sidebarCollapsed ? 'lg:pl-[76px]' : 'lg:pl-[260px]'}`}>
        {/* Extra bottom padding on mobile for roles with BottomNav so content clears it */}
        <main className={`flex-1 p-0 ${hasMobileNav ? 'pb-20' : ''}`}>
          <Outlet />
        </main>

        <footer className="hidden lg:block px-7 py-3 border-t border-slate-200/60 bg-white/60">
          <p className="text-[11px] text-slate-400">
            MegaMall CRM &mdash; {new Date().getFullYear()}
          </p>
        </footer>
      </div>

      {/* Mobile bottom navigation */}
      {isOwner && (
        <>
          <BottomNav
            tabs={[
              ...OWNER_BASE_TABS,
              {
                label: 'Ещё',
                icon: LayoutGrid,
                active: ownerMoreOpen || OWNER_MORE_PATHS.some((p) => location.pathname.startsWith(p)),
                onClick: () => setOwnerMoreOpen(true),
              },
            ]}
          />
          <OwnerMoreSheet open={ownerMoreOpen} onClose={() => setOwnerMoreOpen(false)} />
        </>
      )}
      {isSeller  && <BottomNav variant="seller" />}
      {isManager && <BottomNav tabs={MANAGER_TABS} />}
      {isWarehouse && <BottomNav tabs={WAREHOUSE_TABS} />}
    </div>
  )
}
