import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const isDispatcherBoard = location.pathname === '/dispatcher'

  if (isDispatcherBoard) {
    return <Outlet />
  }

  return (
    <div className="min-h-screen" style={{ background: '#F2F4F7' }}>
      {/* Sidebar */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main column */}
      <div className="flex flex-col min-h-screen lg:pl-[260px]">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 p-5 lg:p-7">
          <Outlet />
        </main>

        <footer className="px-7 py-3 border-t border-slate-200/60 bg-white/60">
          <p className="text-[11px] text-slate-400">
            MegaMall CRM &mdash; {new Date().getFullYear()}
          </p>
        </footer>
      </div>
    </div>
  )
}
