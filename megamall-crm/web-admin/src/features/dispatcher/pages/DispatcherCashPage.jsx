import { RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { KEYS }           from '../../../shared/queryKeys'
import CashHandovers      from '../components/CashHandovers'

export default function DispatcherCashPage() {
  const qc = useQueryClient()

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-end mb-3">
        <button
          onClick={() => qc.invalidateQueries({ queryKey: KEYS.dispatcher.handovers })}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all"
        >
          <RefreshCw size={13} />
          Обновить
        </button>
      </div>
      <CashHandovers />
    </div>
  )
}
