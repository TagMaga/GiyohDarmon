import { useState, useRef, useEffect } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { STATUS_ACTIONS } from '../../statusConfig'

export default function DispatcherActionMenu({ order, onAction, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const actions = STATUS_ACTIONS[order?.status] ?? []

  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (actions.length === 0) return null

  return (
    <div
      ref={ref}
      className={`relative ${className}`}
      onClick={e => e.stopPropagation()}
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
        title="Действия"
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[168px] animate-slide-in-up"
          style={{ animationDuration: '0.12s' }}
        >
          {actions.map(a => (
            <button
              key={a.key}
              onClick={() => { onAction(a.key, order); setOpen(false) }}
              className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-slate-50 ${
                a.variant === 'danger' ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
