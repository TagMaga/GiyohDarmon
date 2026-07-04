import { NavLink, useNavigate } from 'react-router-dom'
import {
  Home, ShoppingCart, TrendingUp, Users, Users2,
  UserCheck, BarChart2, ClipboardList, Wallet,
  LayoutDashboard, PlusCircle, LogOut, ShoppingBag,
  Truck, Settings,
  Package, PackagePlus,
  Building2, User, BookUser,
} from 'lucide-react'
import useAuthStore from '../store/authStore'
import useProfile   from '../hooks/useProfile'

// ─── Navigation config per role ───────────────────────────────────────────────
// Rules:
//   • Only include links that point to implemented pages.
//   • ComingSoon links are removed — users must not click into empty pages.
//   • Redirects counted as implemented only if the target is also implemented.
const NAV = {
  owner: [
    { label: 'Дашборд',    icon: Home,          path: '/owner' },
    { label: 'Заказы',     icon: ShoppingCart,  path: '/owner/orders' },
    { label: 'Логистика',  icon: Truck,         path: '/owner/logistics' },
    { label: 'Финансы',         icon: TrendingUp, path: '/owner/finance' },
    { label: 'Бюджет компании', icon: Wallet,     path: '/owner/budget' },
    { label: 'Команды',         icon: Users2,     path: '/owner/teams' },
    { label: 'Сотрудники', icon: Users,         path: '/owner/employees' },
    { label: 'Склад',      icon: Building2,     path: '/owner/warehouse' },
    { label: 'Команда',    icon: BookUser,      path: '/owner/team-directory' },
    { label: 'Настройки',  icon: Settings,      path: '/owner/settings' },
  ],
  sales_team_lead: [
    { label: 'Dashboard', icon: Home,         path: '/team-lead' },
    { label: 'Orders',    icon: ShoppingCart, path: '/team-lead/orders' },
    { label: 'Team',      icon: Users,        path: '/team-lead/team' },
    { label: 'Finance',   icon: Wallet,       path: '/team-lead/finance' },
    { label: 'Reports',   icon: BarChart2,    path: '/team-lead/reports' },
  ],
  manager: [
    { label: 'Главная',        icon: Home,          path: '/manager' },
    { label: 'Заказы команды', icon: ShoppingCart,  path: '/manager/orders' },
    { label: 'Продавцы',       icon: UserCheck,     path: '/manager/sellers' },
    { label: 'Личные заказы',  icon: ClipboardList, path: '/manager/my-orders' },
    { label: 'Доходы',         icon: TrendingUp,    path: '/manager/income' },
  ],
  seller: [
    { label: 'Главная',       icon: Home,         path: '/seller' },
    { label: 'Мои заказы',    icon: ShoppingCart, path: '/seller/orders' },
    { label: 'Создать заказ', icon: PlusCircle,   path: '/seller/orders/create' },
    { label: 'Мои доходы',    icon: Wallet,       path: '/seller/income' },
    { label: 'Профиль',       icon: User,         path: '/seller/profile' },
  ],
  dispatcher: [
    { label: 'Доска заказов', icon: LayoutDashboard, path: '/dispatcher' },
    { label: 'Касса',         icon: Wallet,          path: '/dispatcher/cash' },
  ],
  warehouse_manager: [
    { label: 'Рабочий стол', icon: Home,             path: '/warehouse' },
    { label: 'Остатки и товары', icon: Package,      path: '/warehouse/inventory' },
    { label: 'Приёмка и списания', icon: PackagePlus, path: '/warehouse/receiving' },
  ],
  courier: [],
}

// ─── Role display names ────────────────────────────────────────────────────────
const ROLE_LABELS = {
  owner:             'Владелец',
  sales_team_lead:   'Руководитель группы',
  manager:           'Менеджер',
  seller:            'Продавец',
  dispatcher:        'Диспетчер',
  warehouse_manager: 'Склад',
  courier:           'Курьер',
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
export default function Sidebar({ open, onClose }) {
  const { clearAuth }                    = useAuthStore()
  const { fullName, initials, phone, role } = useProfile()
  const navigate  = useNavigate()
  const items     = NAV[role] ?? []

  function handleLogout() {
    clearAuth()
    navigate('/login', { replace: true })
  }

  return (
    <>
      {/* ── Sidebar panel ─────────────────────────────────────────── */}
      <aside
        className={[
          // Base styles — mobile: 85vw up to 300px; desktop: fixed 260px
          'fixed inset-y-0 left-0 z-40 flex flex-col',
          'w-[85vw] max-w-[300px] lg:w-[260px]',
          'bg-sidebar-bg border-r border-sidebar-border',
          'transition-transform duration-300 ease-in-out',
          // Desktop: always visible; mobile: slide in/out
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* ── Logo ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800/60">
          <div className="flex-shrink-0 w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <ShoppingBag size={16} className="text-white" />
          </div>
          <div>
            <span className="text-sm font-bold text-white tracking-tight leading-none">
              MegaMall
            </span>
            <span className="block text-[10px] text-slate-500 font-medium tracking-widest uppercase">
              CRM
            </span>
          </div>
        </div>

        {/* ── Navigation ───────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path.split('/').length === 2}
              onClick={onClose}
              className={({ isActive }) =>
                `nav-item min-h-[44px] ${isActive ? 'active' : ''}`
              }
            >
              <item.icon size={17} className="flex-shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* ── User footer ──────────────────────────────────────────── */}
        <div className="px-3 py-4 border-t border-slate-800/60">
          {/* User info */}
          <div className="flex items-center gap-3 px-3 py-2.5 mb-1">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white uppercase">
                {initials}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-white truncate leading-none mb-0.5">
                {fullName ?? phone ?? 'Пользователь'}
              </p>
              <p className="text-[11px] text-slate-400 truncate">
                {ROLE_LABELS[role] ?? role}
              </p>
              {fullName && phone && (
                <p className="text-[10px] text-slate-500 truncate">{phone}</p>
              )}
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="nav-item min-h-[44px] w-full text-red-400 hover:text-red-300 mt-1"
            style={{ background: 'transparent' }}
          >
            <LogOut size={16} className="flex-shrink-0" />
            <span>Выйти из системы</span>
          </button>
        </div>
      </aside>
    </>
  )
}
