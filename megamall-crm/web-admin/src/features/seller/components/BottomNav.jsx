import { NavLink } from 'react-router-dom'
import { Home, ShoppingCart, Plus, Wallet, User } from 'lucide-react'

const SELLER_TABS = [
  { label: 'Главная',  icon: Home,         path: '/seller',              end: true  },
  { label: 'Заказы',   icon: ShoppingCart, path: '/seller/orders',       end: false },
  { label: null,       icon: Plus,         path: '/seller/orders/create', end: false, fab: true },
  { label: 'Доходы',   icon: Wallet,       path: '/seller/income',       end: false },
  { label: 'Профиль',  icon: User,         path: '/seller/profile',      end: false },
]

export default function BottomNav({ tabs = SELLER_TABS }) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 lg:hidden flex items-end justify-around px-3"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 12px)',
        paddingTop: 8,
        background: 'transparent',
      }}
    >
      {/* Floating pill container */}
      <div
        className="w-full flex items-center justify-around rounded-[28px] px-2 py-1"
        style={{
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '-8px -8px 16px rgba(255,255,255,0.7), 8px 8px 24px rgba(16,24,40,0.12)',
          border: '1px solid rgba(226,232,240,0.8)',
          marginBottom: 8,
        }}
      >
        {tabs.map(tab =>
          tab.fab ? (
            <NavLink
              key={tab.path}
              to={tab.path}
              className="flex items-center justify-center -mt-7 w-14 h-14 rounded-full text-white active:scale-90 transition-transform"
              style={{ background: 'linear-gradient(135deg,#4F46E5,#6D28D9)', boxShadow: '0 6px 20px rgba(79,70,229,0.5)' }}
            >
              <Plus size={24} strokeWidth={2.5} />
            </NavLink>
          ) : (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.end}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2 min-h-[52px] rounded-2xl transition-all duration-200"
            >
              {({ isActive }) => (
                <div
                  className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl transition-all duration-200"
                  style={isActive ? {
                    background: 'linear-gradient(135deg,#EEF2FF,#E0E7FF)',
                  } : {}}
                >
                  <tab.icon
                    size={20}
                    strokeWidth={isActive ? 2.5 : 1.8}
                    className={isActive ? 'text-indigo-600' : 'text-slate-400'}
                  />
                  {tab.label && (
                    <span
                      className="text-[10px] font-semibold leading-none"
                      style={{ color: isActive ? '#4F46E5' : '#94A3B8' }}
                    >
                      {tab.label}
                    </span>
                  )}
                </div>
              )}
            </NavLink>
          )
        )}
      </div>
    </nav>
  )
}
