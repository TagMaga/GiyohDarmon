import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, ArrowLeft } from 'lucide-react'
import { KEYS } from '../../../shared/queryKeys'
import CashHandovers       from '../components/CashHandovers'
import CashSettlementTab   from '../components/v2/CashSettlementTab'
import CashTransactionsTab from '../components/v2/CashTransactionsTab'

const TABS = [
  { key: 'settlement',   label: 'Расчёты'    },
  { key: 'handovers',    label: 'Сдачи'      },
  { key: 'transactions', label: 'Транзакции' },
]

export default function DispatcherCashPage() {
  const [tab, setTab] = useState('settlement')
  const qc = useQueryClient()

  function refresh() {
    qc.invalidateQueries({ queryKey: KEYS.dispatcher.handovers })
    qc.invalidateQueries({ queryKey: KEYS.dispatcher.cashSettlement({}) })
    qc.invalidateQueries({ queryKey: KEYS.dispatcher.cashTransactions({}) })
  }

  return (
    <div className="flex flex-col bg-white" style={{ height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-slate-100 flex items-center gap-3">
        <Link
          to="/dispatcher"
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
          title="Назад к заказам"
        >
          <ArrowLeft size={14} />
        </Link>
        <h1 className="text-sm font-bold text-slate-800 flex-1">Касса</h1>
        <button
          onClick={refresh}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
          title="Обновить"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-100 flex-shrink-0 px-4">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
              tab === t.key
                ? 'border-indigo-500 text-indigo-700'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-5 max-w-5xl mx-auto w-full">
          {tab === 'settlement'   && <CashSettlementTab />}
          {tab === 'handovers'    && <CashHandovers />}
          {tab === 'transactions' && <CashTransactionsTab />}
        </div>
      </div>
    </div>
  )
}
