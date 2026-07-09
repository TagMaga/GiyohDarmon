/**
 * EditBudgetTransactionModal — edit a top-up or owner-withdrawal row's
 * amount/note with full edit history. No category — Company Budget rows never
 * had one.
 *
 * Props:
 *   transaction {object|null}  the row (must have id, amount, note, transaction_type)
 *   onClose     {fn}
 *   onSuccess   {fn}           called after a successful save
 */
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Check, Clock, Pencil } from 'lucide-react'
import { patchBudgetTransaction, fetchBudgetTransactionHistory } from '../api'

const fmt = (v) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function HistoryItem({ edit }) {
  const changed = []
  if (edit.old_amount !== edit.new_amount)
    changed.push({ key: 'amount', text: `сумма ${fmt(edit.old_amount)} → ${fmt(edit.new_amount)} с` })
  if (edit.old_note !== edit.new_note)
    changed.push({ key: 'note', text: `примечание «${edit.old_note || '—'}» → «${edit.new_note || '—'}»` })

  return (
    <div className="flex gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Pencil size={10} className="text-slate-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11.5px] font-semibold text-slate-700">
          {edit.editor_name || 'Неизвестно'}
        </p>
        <div className="mt-0.5 space-y-0.5">
          {changed.length > 0
            ? changed.map((item) => (
              <p key={item.key} className="text-[10.5px] leading-snug text-slate-400">
                {item.text}
              </p>
            ))
            : <p className="text-[10.5px] text-slate-400">изменено</p>
          }
        </div>
      </div>
      <p className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0 mt-0.5">
        {fmtDateTime(edit.edited_at)}
      </p>
    </div>
  )
}

export default function EditBudgetTransactionModal({ transaction, onClose, onSuccess }) {
  const qc = useQueryClient()

  const [amount,   setAmount]   = useState('')
  const [note,     setNote]     = useState('')
  const [localErr, setLocalErr] = useState('')

  useEffect(() => {
    if (transaction) {
      setAmount(String(transaction.amount ?? ''))
      setNote(transaction.note ?? '')
      setLocalErr('')
    }
  }, [transaction])

  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey: ['budget-transaction-history', transaction?.id],
    queryFn: () => fetchBudgetTransactionHistory(transaction.id),
    enabled: !!transaction?.id,
  })

  const mut = useMutation({
    mutationFn: patchBudgetTransaction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['budget-transaction-history', transaction?.id] })
      onSuccess?.()
      onClose()
    },
  })

  function handleSubmit() {
    const parsed = parseFloat(amount)
    if (isNaN(parsed) || parsed < 0) { setLocalErr('Введите корректную сумму'); return }
    setLocalErr('')
    mut.mutate({ id: transaction.id, amount: parsed, note: note.trim() })
  }

  function handleClose() {
    mut.reset()
    setLocalErr('')
    onClose()
  }

  if (!transaction) return null

  const isWithdrawal = transaction.transaction_type === 'owner_withdrawal'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="w-full max-w-[460px] rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-[14px] font-bold text-slate-900">
              {isWithdrawal ? 'Редактировать списание' : 'Редактировать пополнение'}
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Все изменения сохраняются в историю</p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Amount */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Сумма (с)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setLocalErr('') }}
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-300 focus:bg-white transition-colors"
            />
          </div>

          {/* Note */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Примечание</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:bg-white transition-colors"
            />
          </div>

          {(localErr || mut.error) && (
            <p className="text-[11px] font-medium text-rose-600">
              {localErr || mut.error?.response?.data?.error?.message || mut.error?.message || 'Ошибка сохранения'}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleClose}
              className="flex-1 py-2.5 rounded-full border border-slate-200 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              disabled={mut.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 rounded-full bg-indigo-600 text-[12.5px] font-semibold text-white shadow-[0_4px_10px_rgba(99,102,241,.3)] hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              <Check size={13} /> Сохранить
            </button>
          </div>
        </div>

        {/* Edit history */}
        <div className="border-t border-slate-100 px-6 py-4 bg-slate-50/60">
          <div className="flex items-center gap-1.5 mb-3">
            <Clock size={12} className="text-slate-400" />
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
              История изменений
            </p>
          </div>
          {histLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-8 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="text-[11px] text-slate-400">Изменений ещё не было</p>
          ) : (
            <div className="max-h-[160px] overflow-y-auto">
              {history.map((edit) => <HistoryItem key={edit.id} edit={edit} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
