import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import useAuthStore from '../store/authStore'
import useExpiryAlerts from '../../features/warehouse/hooks/useExpiryAlerts'
import { ExpiryAlertsList } from '../../features/warehouse/components/ExpiryAlertsPanel'

// NotificationBell shows active batch-expiry warnings for owner /
// warehouse_manager. It never fabricates its own "seen" state — the badge
// count and list both come straight from useExpiryAlerts, which recomputes
// from live batch state, so an alert stays visible for as long as the
// underlying batch has remaining_quantity > 0, panel-open or not.
export default function NotificationBell({ variant = 'dark' }) {
  const { role } = useAuthStore()
  const eligible = role === 'owner' || role === 'warehouse_manager' || role === 'it_specialist'
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const { alerts, meta, isLoading, isError, error } = useExpiryAlerts({ enabled: eligible })

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  if (!eligible) return null

  // Expired first, then soonest-to-expire — mirrors the backend's own sort
  // (see inventory.Service.ExpiryAlerts), kept here too in case the list
  // shape ever changes upstream.
  const sorted = [...alerts].sort((a, b) => a.days_until_expiry - b.days_until_expiry)

  function openProduct(alert) {
    setOpen(false)
    const basePath = role === 'warehouse_manager' ? '/warehouse/inventory' : '/owner/warehouse'
    navigate(`${basePath}?q=${encodeURIComponent(alert.sku)}`)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          variant === 'light'
            ? 'relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] border border-[#E7EAF0] bg-white text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,.05)]'
            : 'relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-800 hover:text-white'
        }
        aria-label="Уведомления о сроках годности"
        title="Уведомления о сроках годности"
      >
        <Bell size={variant === 'light' ? 18 : 17} />
        {meta.total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {meta.total > 99 ? '99+' : meta.total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[340px] max-w-[90vw] rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold text-slate-950">Сроки годности</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {meta.expired_count > 0 && `Просрочено: ${meta.expired_count} · `}
              {meta.expiring_count > 0 ? `Скоро истекает: ${meta.expiring_count}` : (meta.expired_count === 0 ? 'Активных предупреждений нет' : '')}
            </p>
          </div>
          <div className="max-h-[360px] overflow-y-auto p-2">
            <ExpiryAlertsList alerts={sorted} loading={isLoading} error={isError ? error : null} onOpenProduct={openProduct} compact />
          </div>
        </div>
      )}
    </div>
  )
}
