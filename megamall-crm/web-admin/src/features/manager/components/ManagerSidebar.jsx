import { NavLink, useNavigate } from 'react-router-dom'
import { Home, ShoppingCart, Wallet, Users, User, Plus, LogOut, ClipboardList } from 'lucide-react'
import useAuthStore from '../../../shared/store/authStore'
import useProfile from '../../../shared/hooks/useProfile'
import { M } from '../../seller/components/mobileUi'

const NAV = [
  { label: 'Главная',        icon: Home,          path: '/manager',           end: true },
  { label: 'Заказы команды', icon: ShoppingCart,  path: '/manager/orders' },
  { label: 'Продавцы',       icon: Users,         path: '/manager/sellers' },
  { label: 'Личные заказы',  icon: ClipboardList, path: '/manager/my-orders' },
  { label: 'Доходы',         icon: Wallet,        path: '/manager/income' },
  { label: 'Профиль',        icon: User,          path: '/manager/profile' },
]

export default function ManagerSidebar() {
  const { clearAuth } = useAuthStore()
  const { fullName, initials, phone } = useProfile()
  const navigate = useNavigate()

  function handleLogout() {
    clearAuth()
    navigate('/login', { replace: true })
  }

  return (
    <aside
      className="hidden lg:flex fixed inset-y-0 left-0 z-40 flex-col w-[260px] px-4 py-6"
      style={{ background: M.dark, fontFamily: M.font }}
    >
      <div className="flex items-center gap-2.5 px-2 pb-5 flex-shrink-0">
        <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center flex-shrink-0" style={{ background: M.indigo }}>
          <span className="text-white font-extrabold text-[15px]">M</span>
        </div>
        <span className="text-white font-extrabold text-[15px] tracking-tight">MegaMall</span>
      </div>

      <NavLink
        to="/manager/my-orders/create"
        className="flex items-center justify-center gap-2 text-white font-bold text-[13.5px] py-3 rounded-xl mb-5 flex-shrink-0 transition-transform active:scale-[0.98]"
        style={{ background: 'linear-gradient(135deg,#6366F1,#4F46E5)', boxShadow: '0 6px 16px rgba(99,102,241,.35)' }}
      >
        <Plus size={15} strokeWidth={2.4} />
        Новый заказ
      </NavLink>

      <nav className="flex flex-col gap-0.5 flex-shrink-0">
        {NAV.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-[11px] rounded-xl text-[14px] transition-colors ${
                isActive ? 'text-white font-bold' : 'font-semibold hover:text-white'
              }`
            }
            style={({ isActive }) => ({ background: isActive ? M.indigo : 'transparent', color: isActive ? '#fff' : '#9A99AC' })}
          >
            <item.icon size={18} strokeWidth={2} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="flex-1" />

      <div className="flex items-center gap-2.5 px-2.5 py-3 rounded-xl flex-shrink-0" style={{ background: 'rgba(255,255,255,.05)' }}>
        <div
          className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center flex-shrink-0 font-bold text-[13px]"
          style={{ background: '#E7E5FB', color: M.indigoDeep }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white text-[13px] font-bold truncate leading-none mb-0.5">{fullName ?? phone ?? 'Менеджер'}</p>
          <p className="text-[11px] truncate" style={{ color: '#8E8DA0' }}>Менеджер</p>
        </div>
        <button
          onClick={handleLogout}
          aria-label="Выйти из системы"
          className="flex-shrink-0 transition-colors"
          style={{ color: '#8E8DA0' }}
        >
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  )
}
