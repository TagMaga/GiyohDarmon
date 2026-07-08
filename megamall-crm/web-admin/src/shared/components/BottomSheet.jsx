/**
 * BottomSheet — generic bottom-sheet shell used by FinanceFilterBar (and any
 * other filter/picker that wants the "chip -> sheet -> Готово" pattern).
 *
 * Fixed to the viewport (like a native bottom sheet) so it works regardless
 * of where the triggering chip lives in the page.
 *
 * Props:
 *   open      {bool}
 *   onClose   {() => void}
 *   title     {string}
 *   footer    {ReactNode}   optional — CTA row, sticky at the bottom
 *   width     {string}      Tailwind max-w-* class for the panel (default 560px)
 *   children  {ReactNode}
 */
import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function BottomSheet({ open, onClose, title, footer, width = 'max-w-[560px]', children }) {
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] animate-[sheetFadeIn_.2s_ease]"
        onClick={onClose}
      />
      <div
        className={`absolute bottom-0 left-1/2 w-full ${width} -translate-x-1/2 flex max-h-[88vh] flex-col rounded-t-[20px] bg-white shadow-[0_-16px_48px_rgba(15,23,42,.25)] animate-[sheetSlideUp_.28s_cubic-bezier(.32,.72,.33,1)]`}
      >
        <div className="mx-auto mt-2.5 h-1 w-11 flex-shrink-0 rounded-full bg-slate-200" />

        <div className="flex flex-shrink-0 items-center justify-between px-6 pb-2.5 pt-3.5">
          <h4 className="text-[17px] font-bold text-slate-900">{title}</h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
          >
            <X size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-3">{children}</div>

        {footer && (
          <div className="flex-shrink-0 border-t border-slate-100 px-6 pb-[18px] pt-3">{footer}</div>
        )}
      </div>
    </div>
  )
}
