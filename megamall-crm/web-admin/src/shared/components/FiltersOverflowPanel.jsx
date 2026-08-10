/**
 * FiltersOverflowPanel — the "Ещё фильтры" panel from the Filter System
 * Spec. Lists every filter on the page (including ones already shown as
 * chips) with its current value, plus a "Сбросить всё" action.
 *
 * Each row navigates to that filter's own existing sheet/popover on click
 * (closing this panel first) rather than re-implementing the filter's
 * controls inline — the per-filter sheets already own their draft state,
 * validation and apply behavior; duplicating that here would be a second,
 * divergent implementation of the same logic.
 *
 * Props:
 *   open, onClose   {bool, fn}
 *   sections        {Array<{
 *     key         {string}
 *     label       {string}        row label, e.g. "Тип операции"
 *     valueLabel  {string|null}   current value shown on the right
 *     active      {bool}          counts toward the header's active count
 *     onSelect    {fn}            called (after the panel closes) to open
 *                                 this filter's own sheet
 *   }>}
 *   onResetAll      {fn}
 */
import { ChevronRight } from 'lucide-react'
import BottomSheet from './BottomSheet'

export default function FiltersOverflowPanel({ open, onClose, sections, onResetAll }) {
  const activeCount = sections.filter((s) => s.active).length

  function select(section) {
    onClose()
    section.onSelect()
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Фильтры"
      width="max-w-[420px]"
      footer={
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">{activeCount > 0 ? `${activeCount} активных` : 'Нет активных фильтров'}</span>
          {activeCount > 0 && (
            <button type="button" onClick={onResetAll} className="font-semibold text-indigo-600 hover:text-indigo-700">
              Сбросить всё
            </button>
          )}
        </div>
      }
    >
      <div className="divide-y divide-slate-100">
        {sections.map((section) => (
          <button
            key={section.key}
            type="button"
            onClick={() => select(section)}
            className="flex h-11 w-full items-center justify-between gap-3 text-left text-[13.5px]"
          >
            <span className="font-semibold text-slate-700">{section.label}</span>
            <span className="flex items-center gap-1.5 text-slate-400">
              {section.valueLabel && (
                <span className="max-w-[160px] truncate text-slate-600">{section.valueLabel}</span>
              )}
              <ChevronRight size={14} />
            </span>
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}
