import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Home, ShoppingCart, Plus, Wallet, User, Users } from 'lucide-react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import useAuthStore from '../store/authStore'
import BottomNav from '../../features/seller/components/BottomNav'

const MANAGER_TABS = [
  { label: 'Главная',  icon: Home,         path: '/manager',              end: true  },
  { label: 'Команда',  icon: Users,        path: '/manager/orders',       end: false },
  { label: null,       icon: Plus,         path: '/manager/my-orders/create', end: false, fab: true },
  { label: 'Доходы',   icon: Wallet,       path: '/manager/income',       end: false },
  { label: 'Профиль',  icon: User,         path: '/manager/profile',      end: false },
]

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const { role } = useAuthStore()
  const isDispatcherBoard = location.pathname.startsWith('/dispatcher')
  const isSeller  = role === 'seller'
  const isManager = role === 'manager'
  const hasMobileNav = isSeller || isManager

  if (isDispatcherBoard) {
    return <Outlet />
  }

  return (
    <div className="min-h-screen" style={{ background: '#F2F4F7' }}>
      {/* Sidebar — hidden on mobile for seller (replaced by BottomNav) */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex flex-col min-h-screen lg:pl-[260px]">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />

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
      {isSeller  && <BottomNav />}
      {isManager && <BottomNav tabs={MANAGER_TABS} />}
    </div>
  )
}
