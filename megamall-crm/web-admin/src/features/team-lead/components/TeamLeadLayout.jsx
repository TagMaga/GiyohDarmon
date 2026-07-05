import { Outlet } from 'react-router-dom'
import { Home, ShoppingCart, Plus, Wallet, User } from 'lucide-react'
import TeamLeadSidebar from './TeamLeadSidebar'
import BottomNav from '../../seller/components/BottomNav'
import { M } from '../../seller/components/mobileUi'

const TEAM_LEAD_TABS = [
  { label: 'Главная', icon: Home,         path: '/team-lead',               end: true  },
  { label: 'Заказы',  icon: ShoppingCart, path: '/team-lead/orders',        end: false },
  { label: null,      icon: Plus,         path: '/team-lead/orders/create', end: false, fab: true },
  { label: 'Финансы', icon: Wallet,       path: '/team-lead/finance',       end: false },
  { label: 'Профиль', icon: User,         path: '/team-lead/profile',       end: false },
]

/**
 * Team Lead-only layout replacing the shared app Layout for the /team-lead subtree.
 * Desktop: dark TeamLeadSidebar (Teamlead Panel Redesign). Mobile: 5-tab BottomNav
 * with Team reached via Profile instead of its own tab.
 */
export default function TeamLeadLayout() {
  return (
    <div className="min-h-screen" style={{ background: M.bg }}>
      <TeamLeadSidebar />
      <div className="lg:pl-[260px] min-h-screen">
        <Outlet />
      </div>
      <BottomNav variant="teamlead" tabs={TEAM_LEAD_TABS} />
    </div>
  )
}
