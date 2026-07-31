import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import useAuthStore from '../store/authStore'
import useExpiryAlerts from '../../features/warehouse/hooks/useExpiryAlerts'
import useNotifications from '../hooks/useNotifications'
import { ExpiryAlertsList } from '../../features/warehouse/components/ExpiryAlertsPanel'

// Base list/board page each role lands on when a notification is clicked —
// there is no unified per-order deep-link route across roles today, so this
// takes the user to the right page rather than opening a specific order.
const ROLE_ORDERS_ROUTE = {
  owner: '/owner/orders',
  sales_team_lead: '/team-lead/orders',
  manager: '/manager/orders',
  seller: '/seller/orders',
  dispatcher: '/dispatcher',
}

// NotificationBell merges two independent sources into one dropdown:
//   1. Live batch-expiry warnings (owner / warehouse_manager / it_specialist
//      only) — never fabricates its own "seen" state, recomputed from live
//      batch data via useExpiryAlerts.
//   2. Persisted notifications (courier assignment, order comments, cash
//      reminders, etc.) — available to every authenticated role.
export default function NotificationBell({ variant = 'dark' }) {
  const { role } = useAuthStore()
  const expiryEligible = role === 'owner' || role === 'warehouse_manager' || role === 'it_specialist'
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState(null)
  const anchorRef = useRef(null)
  const panelRef = useRef(null)

  const { alerts, meta, isLoading, isError, error } = useExpiryAlerts({ enabled: expiryEligible })
  const {
    notifications,
    unreadCount,
    isLoading: notifLoading,
    markRead,
    markAllRead,
  } = useNotifications()

  useEffect(() => {
    function onClickOutside(e) {
      const insideAnchor = anchorRef.current?.contains(e.target)
      const insidePanel = panelRef.current?.contains(e.target)
      if (!insideAnchor && !insidePanel) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', onClickOutside)
      document.addEventListener('keydown', onKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setPanelStyle(null)
      return undefined
    }

    function updatePosition() {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const margin = 12
      const gap = 8
      const width = Math.min(340, window.innerWidth - margin * 2)
      const desiredHeight = 430
      const left = Math.min(
        Math.max(margin, rect.right - width),
        window.innerWidth - width - margin,
      )
      let top = rect.bottom + gap
      if (top + desiredHeight > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - desiredHeight - gap)
      }
      setPanelStyle({
        left,
        top,
        width,
        maxHeight: Math.max(220, window.innerHeight - top - margin),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  // Expired first, then soonest-to-expire — mirrors the backend's own sort
  // (see inventory.Service.ExpiryAlerts), kept here too in case the list
  // shape ever changes upstream.
  const sorted = [...alerts].sort((a, b) => a.days_until_expiry - b.days_until_expiry)

  function openProduct(alert) {
    setOpen(false)
    const basePath = role === 'warehouse_manager' ? '/warehouse/inventory' : '/owner/warehouse'
    navigate(`${basePath}?q=${encodeURIComponent(alert.sku)}`)
  }

  function openNotification(n) {
    setOpen(false)
    if (!n.read) markRead(n.id)
    const dest = ROLE_ORDERS_ROUTE[role]
    if (dest) navigate(dest)
  }

  const badgeCount = meta.total + unreadCount

  return (
    <div className="relative" ref={anchorRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          variant === 'light'
            ? 'relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] border border-[#E7EAF0] bg-white text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,.05)]'
            : 'relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-800 hover:text-white'
        }
        aria-label="Уведомления"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Уведомления"
      >
        <Bell size={variant === 'light' ? 18 : 17} />
        {badgeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </button>

      {open && panelStyle && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Уведомления"
          className="fixed z-[100] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          style={panelStyle}
        >
          <div className="flex-shrink-0 flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold text-slate-950">Уведомления</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllRead()}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Прочитать всё
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-3">
            {notifications.length === 0 && !notifLoading && sorted.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-slate-400">Уведомлений нет</p>
            )}

            {notifications.length > 0 && (
              <ul className="space-y-1">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={`w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50 ${!n.read ? 'bg-blue-50/60' : ''}`}
                    >
                      <div className="flex items-start gap-2">
                        {!n.read && <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                          <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{n.body}</p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {expiryEligible && sorted.length > 0 && (
              <div className="border-t border-slate-100 pt-2">
                <p className="px-2 pb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Сроки годности</p>
                <ExpiryAlertsList alerts={sorted} loading={isLoading} error={isError ? error : null} onOpenProduct={openProduct} compact />
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
