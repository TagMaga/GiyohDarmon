import { Outlet } from 'react-router-dom'
import { Home, ShoppingCart, Plus, Wallet, User } from 'lucide-react'
import BottomNav from '../../seller/components/BottomNav'
import { M } from '../../seller/components/mobileUi'
import ManagerSidebar from './ManagerSidebar'

const MANAGER_TABS = [
  { label: 'Главная', icon: Home,         path: '/manager',                 end: true },
  { label: 'Заказы',  icon: ShoppingCart, path: '/manager/orders',          end: false },
  { label: null,      icon: Plus,         path: '/manager/my-orders/create', end: false, fab: true },
  { label: 'Доходы',  icon: Wallet,       path: '/manager/income',          end: false },
  { label: 'Профиль', icon: User,         path: '/manager/profile',         end: false },
]

export default function ManagerLayout() {
  return (
    <div className="min-h-screen" style={{ background: M.bg }}>
      <ManagerSidebar />
      <div className="lg:pl-[260px] min-h-screen">
        <Outlet />
      </div>
      <BottomNav variant="teamlead" tabs={MANAGER_TABS} />
    </div>
  )
}
