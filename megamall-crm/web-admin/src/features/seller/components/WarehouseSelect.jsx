import { Warehouse } from 'lucide-react'

/**
 * WarehouseSelect — dropdown for warehouse selection.
 *
 * Props:
 *   warehouses  {Array}
 *   loading     {bool}
 *   value       {string}
 *   onChange    {fn}   — (id) => void
 */
export default function WarehouseSelect({ warehouses = [], loading = false, value, onChange }) {
  return (
    <div className="space-y-2">
      <label className="input-label">
        <span className="flex items-center gap-1.5">
          <Warehouse size={13} className="text-slate-400" />
          Склад *
        </span>
      </label>

      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="input"
        disabled={loading || warehouses.length === 0}
      >
        <option value="">
          {loading ? 'Загрузка складов…' : 'Выберите склад'}
        </option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}{w.city ? ` — ${w.city}` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
