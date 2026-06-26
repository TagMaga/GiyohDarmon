import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '../../../../shared/queryKeys'
import { fetchCashTransactions, confirmCashTransaction, rejectCashTransaction } from '../../api'
import { fmt, fmtDate } from '../../statusConfig'
import Badge from '../../../../shared/components/Badge'
import Button from '../../../../shared/components/Button'
import Skeleton from '../../../../shared/components/Skeleton'
import EmptyState from '../../../../shared/components/EmptyState'
import { useToast } from '../../../../shared/components/ToastProvider'

const TX_STATUS = {
  pending:   { label: 'Ожидает',   variant: 'amber'   },
  confirmed: { label: 'Принято',   variant: 'emerald' },
  rejected:  { label: 'Отклонено', variant: 'rose'    },
}

export default function CashTransactionsTab() {
  const qc    = useQueryClient()
  const toast = useToast()
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const { data: raw, isLoading } = useQuery({
    queryKey: KEYS.dispatcher.cashTransactions({}),
    queryFn:  () => fetchCashTransactions(),
    staleTime: 30_000,
  })

  const transactions = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : []

  const { mutate: doConfirm, isPending: confirmPending } = useMutation({
    mutationFn: (id) => confirmCashTransaction(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.cashTransactions({}) })
      toast.success('Транзакция подтверждена')
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
  })

  const { mutate: doReject, isPending: rejectPending } = useMutation({
    mutationFn: ({ id, reason }) => rejectCashTransaction(id, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.cashTransactions({}) })
      toast.success('Транзакция отклонена')
      setRejectTarget(null)
      setRejectReason('')
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
      </div>
    )
  }
  if (transactions.length === 0) {
    return <EmptyState title="Нет транзакций" subtitle="Транзакции появятся здесь" />
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden lg:block overflow-hidden rounded-2xl border border-slate-100 shadow-sm">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="bg-slate-50/70 border-b border-slate-100">
              {['Курьер', 'Сумма', 'Статус', 'Заметка', 'Дата', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.map(tx => {
              const st     = TX_STATUS[tx.status] ?? TX_STATUS.pending
              const canAct = tx.status === 'pending'
              return (
                <tr key={tx.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3 text-xs font-medium text-slate-800">{tx.courier_name ?? '—'}</td>
                  <td className="px-4 py-3 text-xs font-semibold">{fmt(tx.amount)} с.</td>
                  <td className="px-4 py-3"><Badge variant={st.variant} dot>{st.label}</Badge></td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[180px] truncate">{tx.note ?? '—'}</td>
                  <td className="px-4 py-3 text-[11px] text-slate-400 whitespace-nowrap">{fmtDate(tx.created_at)}</td>
                  <td className="px-4 py-3">
                    {canAct && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="primary" onClick={() => doConfirm(tx.id)} loading={confirmPending}>
                          Принять
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => { setRejectTarget(tx); setRejectReason('') }}>
                          Откл.
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden space-y-3">
        {transactions.map(tx => {
          const st     = TX_STATUS[tx.status] ?? TX_STATUS.pending
          const canAct = tx.status === 'pending'
          return (
            <div key={tx.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{tx.courier_name ?? '—'}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{fmtDate(tx.created_at)}</p>
                </div>
                <Badge variant={st.variant} dot>{st.label}</Badge>
              </div>
              <p className="text-base font-bold text-slate-800">{fmt(tx.amount)} с.</p>
              {tx.note && <p className="text-xs text-slate-500">{tx.note}</p>}
              {canAct && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="primary" fullWidth onClick={() => doConfirm(tx.id)} loading={confirmPending}>
                    Принять
                  </Button>
                  <Button size="sm" variant="danger" fullWidth onClick={() => { setRejectTarget(tx); setRejectReason('') }}>
                    Отклонить
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Reject inline drawer */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-slate-800">Отклонить транзакцию</h3>
            <p className="text-sm text-slate-500">
              {rejectTarget.courier_name} · <span className="font-semibold">{fmt(rejectTarget.amount)} с.</span>
            </p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              className="input resize-none"
              rows={3}
              placeholder="Причина отклонения…"
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="secondary" fullWidth onClick={() => setRejectTarget(null)}>Отмена</Button>
              <Button
                variant="danger"
                fullWidth
                onClick={() => doReject({ id: rejectTarget.id, reason: rejectReason })}
                loading={rejectPending}
                disabled={!rejectReason.trim()}
              >
                Отклонить
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
