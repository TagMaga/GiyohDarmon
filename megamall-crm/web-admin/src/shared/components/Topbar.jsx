import { useState }          from 'react'
import { Menu, Bell, Activity } from 'lucide-react'
import { useQuery }          from '@tanstack/react-query'
import { getHealth }         from '../api/auth'
import StatusBadge           from './StatusBadge'
import NotificationsPanel    from './NotificationsPanel'

export default function Topbar({ onMenuClick }) {
  const [notifOpen, setNotifOpen] = useState(false)

  const { data: healthData, isError: healthError, isPending: healthPending } = useQuery({
    queryKey:        ['health'],
    queryFn:         getHealth,
    refetchInterval: 30_000,
    retry:           1,
    staleTime:       20_000,
  })

  const healthStatus = healthPending
    ? 'checking'
    : healthError
      ? 'offline'
      : healthData?.success === true
        ? 'online'
        : 'offline'

  return (
    <header
      className="hidden lg:flex sticky top-0 z-20 h-[60px] items-center justify-between px-4 lg:px-6 flex-shrink-0"
      style={{
        background: 'rgba(242, 244, 247, 0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(226, 232, 240, 0.6)',
      }}
    >
      {/* Left: hamburger + health */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-white/80 transition-colors"
          aria-label="Открыть меню"
        >
          <Menu size={20} />
        </button>

        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/70 rounded-full border border-slate-200/60">
          <Activity size={12} className="text-slate-400" />
          <StatusBadge status={healthStatus} />
        </div>
      </div>

      {/* Right: notifications + account */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            onClick={() => setNotifOpen(v => !v)}
            className={`relative p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl transition-colors ${
              notifOpen ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-white/80'
            }`}
          >
            <Bell size={18} />
            <span className="absolute top-2 right-2 w-2 h-2 bg-indigo-500 rounded-full ring-2 ring-white/80" />
          </button>
          <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
        </div>
      </div>
    </header>
  )
}
