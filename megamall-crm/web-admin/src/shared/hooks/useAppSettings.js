import { useState, useCallback } from 'react'

const KEY = 'megamall-settings'

const DEFAULTS = {
  language: 'ru',
  density: 'comfortable',
  notifications: {
    orderAssigned:  true,
    orderDelivered: true,
    cashSubmitted:  true,
    cashConfirmed:  true,
    systemAlerts:   true,
  },
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULTS,
      ...parsed,
      notifications: { ...DEFAULTS.notifications, ...parsed.notifications },
    }
  } catch { return DEFAULTS }
}

function persist(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch {}
}

export default function useAppSettings() {
  const [settings, setSettings] = useState(load)

  const update = useCallback((patch) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      persist(next)
      return next
    })
  }, [])

  const updateNotification = useCallback((key, val) => {
    setSettings(prev => {
      const next = {
        ...prev,
        notifications: { ...prev.notifications, [key]: val },
      }
      persist(next)
      return next
    })
  }, [])

  return { settings, update, updateNotification }
}
