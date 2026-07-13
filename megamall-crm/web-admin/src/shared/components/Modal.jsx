import { useEffect, useRef } from 'react'
import { createPortal }     from 'react-dom'
import { X }                from 'lucide-react'

/**
 * Modal — portal-based dialog.
 *
 * On mobile it slides up as a bottom-sheet.
 * On sm+ it centres as a standard modal.
 *
 * Props:
 *   open        {bool}      — controlled visibility
 *   onClose     {fn}        — called when backdrop / X clicked
 *   title       {string}    — header title
 *   description {string}    — optional subtitle
 *   children    {ReactNode} — body content
 *   footer      {ReactNode} — action buttons row
 *   size        {string}    — 'sm'|'md'|'lg'|'xl' (default 'md')
 */
const sizeClass = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-[560px]',
}

export default function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const panelRef = useRef(null)

  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel — bottom-sheet mobile, centred desktop */}
      <div
        ref={panelRef}
        className={[
          'relative z-10 w-full bg-white flex flex-col',
          'rounded-t-[20px] sm:rounded-[20px]',
          'max-h-[92vh] overflow-hidden',
          'animate-fade-in',
          sizeClass[size] ?? sizeClass.md,
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <div>
            <h2 id="modal-title" className="text-base font-semibold text-slate-900">
              {title}
            </h2>
            {description && (
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-4 flex-shrink-0 p-1.5 min-h-[36px] min-w-[36px] rounded-xl
                       text-slate-400 hover:bg-slate-100 hover:text-slate-700
                       transition-colors flex items-center justify-center"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-5 pb-5 pt-3 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
