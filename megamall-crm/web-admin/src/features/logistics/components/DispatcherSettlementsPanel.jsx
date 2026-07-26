/**
 * DispatcherSettlementsPanel — Owner Logistics → Cash tab.
 *
 * Four KPI boxes (courier debt / dispatcher received / dispatcher paid /
 * dispatcher debt to company) plus the review history of dispatcher "pay all
 * received to company" submissions. Only the owner can confirm/reject a
 * submission here — the dispatcher-side equivalent (CompanySettlementTab)
 * only lets a dispatcher submit and view their own history.
 */
import { useState } from 'react'
import { Wallet, Coins, Landmark, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import KpiCard from '../../../shared/components/KpiCard'
import Badge from '../../../shared/components/Badge'
import Button from '../../../shared/components/Button'
import Skeleton from '../../../shared/components/Skeleton'
import EmptyState from '../../../shared/components/EmptyState'
import PeriodRangeFilter from '../../../shared/components/PeriodRangeFilter'
import { useToast } from '../../../shared/components/ToastProvider'
import {
  useSettlementsSummary, useSettlements, useDispatchers,
  useConfirmSettlement, useRejectSettlement,
} from '../hooks/useDispatcherSettlements'

const fmt = (n) => Number(n ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })

const STATUS_CFG = {
  pending:   { label: 'Ожидает',   variant: 'amber'   },
  confirmed: { label: 'Принято',   variant: 'emerald' },
  rejected:  { label: 'Отклонено', variant: 'rose'    },
}

const fmtDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function DispatcherSettlementsPanel() {
  const toast = useToast()
  const [range, setRange] = useState({ from: '', to: '' })
  const [dispatcherId, setDispatcherId] = useState('')
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const filterParams = {
    from: range.from || undefined,
    to: range.to || undefined,
    dispatcher_id: dispatcherId || undefined,
  }

  const { data: dispatchers } = useDispatchers()
  const { data: summary, isLoading: summaryLoading } = useSettlementsSummary(filterParams)
  const { data: listData, isLoading: listLoading } = useSettlements(filterParams)
  const rows = listData?.items ?? []

  const confirmMutation = useConfirmSettlement()
  const rejectMutation = useRejectSettlement()

  const handleConfirm = (id) => {
    confirmMutation.mutate(id, {
      onSuccess: () => toast.success('Заявка подтверждена'),
      onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
    })
  }

  const handleReject = () => {
    rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason }, {
      onSuccess: () => {
        toast.success('Заявка отклонена')
        setRejectTarget(null)
        setRejectReason('')
      },
      onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
    })
  }

  return (
    <div className="space-y-4">
      {/* KPI boxes */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Долг курьеров"
          value={`${fmt(summary?.courier_debt)} с.`}
          icon={<AlertTriangle size={20} />}
          color="rose"
          loading={summaryLoading}
        />
        <KpiCard
          label="Диспетчер получил"
          value={`${fmt(summary?.received)} с.`}
          icon={<Coins size={20} />}
          color="sky"
          loading={summaryLoading}
        />
        <KpiCard
          label="Диспетчер сдал"
          value={`${fmt(summary?.paid)} с.`}
          icon={<Landmark size={20} />}
          color="emerald"
          loading={summaryLoading}
        />
        <KpiCard
          label="Долг диспетчера компании"
          value={`${fmt(summary?.dispatcher_debt)} с.`}
          icon={<Wallet size={20} />}
          color="amber"
          loading={summaryLoading}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <PeriodRangeFilter
          from={range.from}
          to={range.to}
          onChange={setRange}
        />
        <select
          className="input w-auto min-w-[200px]"
          value={dispatcherId}
          onChange={(e) => setDispatcherId(e.target.value)}
        >
          <option value="">Все диспетчеры</option>
          {(dispatchers ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.full_name}</option>
          ))}
        </select>
      </div>

      {/* History */}
      {listLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Нет заявок" description="Заявки на передачу денег компании появятся здесь" />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block overflow-hidden rounded-2xl border border-slate-100 shadow-sm">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-100">
                  {['Диспетчер', 'Сумма', 'Статус', 'Комментарий', 'Дата', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const st = STATUS_CFG[row.status] ?? STATUS_CFG.pending
                  const canAct = row.status === 'pending'
                  return (
                    <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 text-xs font-medium text-slate-800">{row.dispatcher_name}</td>
                      <td className="px-4 py-3 text-xs font-semibold tabular-nums">{fmt(row.amount)} с.</td>
                      <td className="px-4 py-3"><Badge variant={st.variant} dot>{st.label}</Badge></td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-[180px] truncate">
                        {row.status === 'rejected' ? (row.rejection_reason ?? '—') : (row.comment ?? '—')}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-400 whitespace-nowrap">{fmtDate(row.created_at)}</td>
                      <td className="px-4 py-3">
                        {canAct && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="primary" icon={<CheckCircle2 size={14} />}
                              onClick={() => handleConfirm(row.id)} loading={confirmMutation.isPending}>
                              Принять
                            </Button>
                            <Button size="sm" variant="danger" icon={<XCircle size={14} />}
                              onClick={() => { setRejectTarget(row); setRejectReason('') }}>
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
            {rows.map((row) => {
              const st = STATUS_CFG[row.status] ?? STATUS_CFG.pending
              const canAct = row.status === 'pending'
              return (
                <div key={row.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{row.dispatcher_name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{fmtDate(row.created_at)}</p>
                    </div>
                    <Badge variant={st.variant} dot>{st.label}</Badge>
                  </div>
                  <p className="text-base font-bold text-slate-800">{fmt(row.amount)} с.</p>
                  {row.status === 'rejected' && row.rejection_reason && (
                    <p className="text-xs text-rose-600">{row.rejection_reason}</p>
                  )}
                  {row.status !== 'rejected' && row.comment && (
                    <p className="text-xs text-slate-500">{row.comment}</p>
                  )}
                  {canAct && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="primary" fullWidth onClick={() => handleConfirm(row.id)} loading={confirmMutation.isPending}>
                        Принять
                      </Button>
                      <Button size="sm" variant="danger" fullWidth onClick={() => { setRejectTarget(row); setRejectReason('') }}>
                        Отклонить
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Reject drawer */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-slate-800">Отклонить заявку</h3>
            <p className="text-sm text-slate-500">
              {rejectTarget.dispatcher_name} · <span className="font-semibold">{fmt(rejectTarget.amount)} с.</span>
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
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
                onClick={handleReject}
                loading={rejectMutation.isPending}
                disabled={!rejectReason.trim()}
              >
                Отклонить
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
