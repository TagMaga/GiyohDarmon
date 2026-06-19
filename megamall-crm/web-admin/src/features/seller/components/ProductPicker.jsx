import { useState, useMemo } from 'react'
import { Search, Package, CheckCircle2, X } from 'lucide-react'

/**
 * ProductPicker — searchable product grid.
 *
 * Props:
 *   products    {Array}
 *   loading     {bool}
 *   selectedId  {string|null}
 *   onSelect    {fn}  — (product) => void
 */
export default function ProductPicker({ products = [], loading = false, selectedId, onSelect }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products.slice(0, 20)
    return products
      .filter((p) =>
        p.name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.article?.toLowerCase().includes(q)
      )
      .slice(0, 20)
  }, [query, products])

  const selected = selectedId ? products.find((p) => p.id === selectedId) : null

  return (
    <div className="space-y-2">
      <label className="input-label">
        <span className="flex items-center gap-1.5">
          <Package size={13} className="text-slate-400" />
          Товар *
        </span>
      </label>

      {/* Selected product badge */}
      {selected && (
        <div className="flex items-center justify-between px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-xl">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-indigo-600 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-indigo-800">{selected.name}</p>
              {selected.sku && <p className="text-[10px] text-indigo-500">SKU: {selected.sku}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="p-1 rounded-lg text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Search box */}
      {!selected && (
        <>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по названию или артикулу…"
              className="input pl-9"
            />
          </div>

          {loading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4">Товары не найдены</p>
          )}

          {!loading && filtered.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto scrollbar-none">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelect(p)}
                  className="text-left p-3 rounded-xl border border-slate-200 hover:border-indigo-300
                             hover:bg-indigo-50 transition-colors group"
                >
                  <div className="w-7 h-7 rounded-lg bg-slate-100 group-hover:bg-indigo-100
                                  flex items-center justify-center mb-2 transition-colors">
                    <Package size={13} className="text-slate-400 group-hover:text-indigo-500" />
                  </div>
                  <p className="text-xs font-semibold text-slate-800 leading-tight line-clamp-2">
                    {p.name}
                  </p>
                  {p.sku && (
                    <p className="text-[10px] text-slate-400 mt-0.5">{p.sku}</p>
                  )}
                  {p.base_price != null && (
                    <p className="text-[11px] font-medium text-indigo-600 mt-1">
                      {Number(p.base_price).toLocaleString('ru-RU')} с
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
