import { useEffect, useState } from 'react'

/**
 * useIsMobile — matches the same `lg` (1024px) breakpoint the rest of the app
 * already uses to switch between sidebar/desktop and bottom-nav/mobile layouts
 * (see BottomNav.jsx's `lg:hidden`, Layout.jsx's `hasMobileNav`).
 */
export default function useIsMobile(breakpoint = 1024) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint,
  )

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = (e) => setIsMobile(e.matches)
    setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [breakpoint])

  return isMobile
}
