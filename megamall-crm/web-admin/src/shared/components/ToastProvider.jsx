import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, XCircle, X, AlertTriangle } from 'lucide-react'

// ── Context ───────────────────────────────────────────────────────────────────
const ToastContext = createContext(null)

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

// ── Toast item ────────────────────────────────────────────────────────────────
const VARIANTS = {
  success: {
    bg:   'bg-emerald-50 border-emerald-200',
    icon: <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />,
    text: 'text-emerald-800',
  },
  error: {
    bg:   'bg-red-50 border-red-200',
    icon: <XCircle size={18} className="text-red-500 flex-shrink-0" />,
    text: 'text-red-800',
  },
  warning: {
    bg:   'bg-amber-50 border-amber-200',
    icon: <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />,
    text: 'text-amber-800',
  },
}

function ToastItem({ id, message, variant = 'success', onDismiss }) {
  const v = VARIANTS[variant] ?? VARIANTS.success
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-2xl border shadow-card-md
                  max-w-sm w-full animate-fade-in ${v.bg}`}
      role="alert"
    >
      {v.icon}
      <p className={`text-sm font-medium flex-1 leading-snug ${v.text}`}>{message}</p>
      <button
        onClick={() => onDismiss(id)}
        className="flex-shrink-0 p-0.5 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Закрыть"
      >
        <X size={14} className={v.text} />
      </button>
    </div>
  )
}

// ── Provider ──────────────────────────────────────────────────────────────────
let _nextId = 0

export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((message, variant = 'success', duration = 4000) => {
    const id = ++_nextId
    setToasts((prev) => [...prev, { id, message, variant }])
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
    return id
  }, [dismiss])

  const toast = {
    success: (msg, dur)  => push(msg, 'success', dur),
    error:   (msg, dur)  => push(msg, 'error',   dur ?? 6000),
    warning: (msg, dur)  => push(msg, 'warning', dur),
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Toast stack — bottom-right on desktop, bottom-center on mobile */}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0
                   sm:right-4 sm:bottom-6 z-[9999] flex flex-col gap-2 items-center
                   pointer-events-none w-full px-4 sm:w-auto sm:px-0"
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto w-full sm:w-auto">
            <ToastItem {...t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
