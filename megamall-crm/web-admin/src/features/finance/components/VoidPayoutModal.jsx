/**
 * VoidPayoutModal — reverse a payout (Team-Lead/Manager/Owner payout row in
 * the Finance ledger). Status flag + reason, never a hard delete — the
 * ledger stays append-only and auditable. Once voided the row disappears
 * from this ledger view (ListFinancialEvents excludes voided payouts) and
 * the payee's "remaining" goes back up automatically.
 *
 * Props:
 *   payout    {object|null}  the row (must have id, event_type, amount)
 *   onClose   {fn}
 */
import { useState, useEffect } from 'react'
import { X, Undo2 } from 'lucide-react'
import useVoidPayout from '../../../shared/hooks/useVoidPayout'
import { fmtMoney } from '../../hr/utils/hrHelpers'

export default function VoidPayoutModal({ payout, onClose }) {
  const [reason, setReason] = useState('')
  const [localErr, setLocalErr] = useState('')
  const mut = useVoidPayout()

  useEffect(() => {
    if (payout) {
      setReason('')
      setLocalErr('')
      mut.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payout])

  function handleClose() {
    mut.reset()
    setLocalErr('')
    onClose()
  }

  function handleSubmit() {
    if (reason.trim().length < 3) {
      setLocalErr('Укажите причину отмены (минимум 3 символа)')
      return
    }
    setLocalErr('')
    mut.mutate({ id: payout.id, reason: reason.trim() }, { onSuccess: handleClose })
  }

  if (!payout) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="w-full max-w-[420px] rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-[14px] font-bold text-slate-900">Отменить выплату</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Запись останется в истории с пометкой «Отменено»</p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
            <p className="text-sm font-black text-slate-900">{fmtMoney(payout.amount)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{payout.created_at ? new Date(payout.created_at).toLocaleDateString('ru-RU') : ''}</p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Причина отмены</label>
            <textarea
              value={reason}
              onChange={(e) => { setReason(e.target.value); setLocalErr('') }}
              placeholder="Например: неверная сумма, отправлено не тому человеку…"
              rows={3}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:bg-white transition-colors resize-none"
            />
          </div>

          {(localErr || mut.error) && (
            <p className="text-[11px] font-medium text-rose-600">
              {localErr || mut.error?.response?.data?.error?.message || mut.error?.message || 'Ошибка отмены'}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleClose}
              className="flex-1 py-2.5 rounded-full border border-slate-200 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Назад
            </button>
            <button
              onClick={handleSubmit}
              disabled={mut.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 rounded-full bg-rose-600 text-[12.5px] font-semibold text-white shadow-[0_4px_10px_rgba(225,29,72,.3)] hover:bg-rose-700 disabled:opacity-60 transition-colors"
            >
              <Undo2 size={13} /> Отменить выплату
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
