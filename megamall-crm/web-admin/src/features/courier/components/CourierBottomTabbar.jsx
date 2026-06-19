import { Home, Package, Compass, Wallet } from 'lucide-react'

export default function CourierBottomTabbar({ active, onChange, counts = {} }) {
  const tabs = [
    { id: 'home',   icon: Home,    label: 'Главная' },
    { id: 'orders', icon: Package, label: 'Доставки',  badge: (counts.assigned ?? 0) + (counts.in_delivery ?? 0) },
    { id: 'market', icon: Compass, label: 'Доступные', badge: counts.available ?? 0 },
    { id: 'cash',   icon: Wallet,  label: 'Касса' },
  ]

  return (
    <nav style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
      height: 'calc(72px + env(safe-area-inset-bottom))',
      background: 'rgba(255,255,255,0.92)',
      backdropFilter: 'blur(18px)',
      WebkitBackdropFilter: 'blur(18px)',
      borderTop: '1px solid #e6ecf3',
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      padding: `8px 8px calc(10px + env(safe-area-inset-bottom))`,
    }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            all: 'unset',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 3, cursor: 'pointer', position: 'relative',
            color: active === t.id ? '#1683ff' : '#8a93a3',
            fontSize: 11, fontWeight: 850,
            transition: 'color .15s',
          }}
        >
          <span style={{
            opacity: active === t.id ? 1 : 0.72,
            transform: active === t.id ? 'translateY(-2px)' : 'none',
            transition: 'all .15s',
            display: 'block',
          }}>
            <t.icon size={22} strokeWidth={active === t.id ? 2.4 : 2} />
          </span>
          <span>{t.label}</span>
          {!!t.badge && (
            <span style={{
              position: 'absolute', top: 0, right: '20%',
              background: '#ff453a', color: '#fff',
              fontSize: 9, fontWeight: 900,
              borderRadius: 999, padding: '1px 5px',
              lineHeight: 1.5,
            }}>{t.badge}</span>
          )}
        </button>
      ))}
    </nav>
  )
}
