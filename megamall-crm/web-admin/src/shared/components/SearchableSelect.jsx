import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, ChevronDown, X } from 'lucide-react'

export default function SearchableSelect({ options, value, onChange, placeholder = 'Выберите значение', required, className = '' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)

  const selected = useMemo(() => options.find(option => String(option.value) === String(value)), [options, value])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(option => option.label.toLowerCase().includes(q))
  }, [options, query])

  useEffect(() => {
    function onClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function select(option) {
    onChange(option.value)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className="flex w-full min-h-[44px] items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      >
        <span className={selected ? 'text-slate-900' : 'text-slate-400'}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className="flex-shrink-0 text-slate-400" />
      </button>
      {required && <input tabIndex={-1} autoComplete="off" className="pointer-events-none absolute inset-x-0 bottom-0 h-0 w-0 opacity-0" value={value || ''} onChange={() => {}} required />}
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg">
          <label className="relative block border-b border-slate-100 p-2">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-7 text-sm outline-none focus:border-indigo-500"
              placeholder="Поиск..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
          </label>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0
              ? <p className="px-3 py-2 text-sm text-slate-400">Ничего не найдено</p>
              : filtered.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => select(option)}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${String(option.value) === String(value) ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-700'}`}
                >
                  {option.label}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
