import { useState, useEffect, useCallback } from 'react'

const KEY = 'megamall-theme'

function read() {
  try { return localStorage.getItem(KEY) ?? 'light' } catch { return 'light' }
}

export default function useTheme() {
  const [theme, setTheme] = useState(read)

  useEffect(() => {
    try { localStorage.setItem(KEY, theme) } catch {}
  }, [theme])

  const toggle = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), [])

  return { theme, toggle, isDark: theme === 'dark' }
}
