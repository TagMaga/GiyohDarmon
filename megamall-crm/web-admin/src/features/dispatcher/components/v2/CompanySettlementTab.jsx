/**
 * CompanySettlementTab — Dispatcher Касса → "Компания" tab.
 *
 * Same four KPI boxes as the owner logistics cash tab, scoped to the current
 * dispatcher only (no dispatcher filter — there's nothing to filter, it's
 * always "me"). "Передать всё компании" submits the current outstanding
 * balance (received - already-confirmed-paid) for owner review; only the
 * owner can confirm/reject it (see DispatcherSettlementsPanel on the owner
 * side) — here it's read-only history.
 */
import { useState } from 'react'
import { Wallet, Coins, Landmark, AlertTriangle } from 'lucide-react'
import KpiCard from '../../../../shared/components/KpiCard'
import Badge from '../../../../shared/components/Badge'
import Button from '../../../../shared/components/Button'
import Skeleton from '../../../../shared/components/Skeleton'
import EmptyState from '../../../../shared/components/EmptyState'
import { useToast } from '../../../../shared/components/ToastProvider'
import { useMySettlementsSummary, useMySettlements, useSubmitSettlement } from '../../hooks/useCompanySettlement'

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

export default function CompanySettlementTab() {
  const toast = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const { data: summary, isLoading: summaryLoading } = useMySettlementsSummary()
  const { data: listData, isLoading: listLoading } = useMySettlements()
  const rows = listData?.data ?? []

  const submitMutation = useSubmitSettlement()

  const canPay = (summary?.dispatcher_debt ?? 0) > 0.009

  const handleSubmit = () => {
    submitMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success('Заявка отправлена владельцу на подтверждение')
        setConfirmOpen(false)
      },
      onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
    })
  }

  return (
    <div className="space-y-4">
      {/* KPI boxes */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard
          label="Долг курьеров"
          value={`${fmt(summary?.courier_debt)} с.`}
          icon={<AlertTriangle size={20} />}
          color="rose"
          loading={summaryLoading}
        />
        <KpiCard
          label="Я получил"
          value={`${fmt(summary?.received)} с.`}
          icon={<Coins size={20} />}
          color="sky"
          loading={summaryLoading}
        />
        <KpiCard
          label="Я сдал компании"
          value={`${fmt(summary?.paid)} с.`}
          icon={<Landmark size={20} />}
          color="emerald"
          loading={summaryLoading}
        />
        <KpiCard
          label="Мой долг компании"
          value={`${fmt(summary?.dispatcher_debt)} с.`}
          icon={<Wallet size={20} />}
          color="amber"
          loading={summaryLoading}
        />
      </div>

      <Button
        variant="primary"
        fullWidth
        disabled={!canPay}
        onClick={() => setConfirmOpen(true)}
      >
        Передать всё компании
      </Button>

      {/* Own history */}
      {listLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Нет заявок" description="Заявки на передачу денег компании появятся здесь" />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const st = STATUS_CFG[row.status] ?? STATUS_CFG.pending
            return (
              <div key={row.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] text-slate-400">{fmtDate(row.created_at)}</p>
                  <Badge variant={st.variant} dot>{st.label}</Badge>
                </div>
                <p className="text-base font-bold text-slate-800">{fmt(row.amount)} с.</p>
                {row.status === 'rejected' && row.rejection_reason && (
                  <p className="text-xs text-rose-600">{row.rejection_reason}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Confirm submit sheet */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-slate-800">Передать деньги компании</h3>
            <p className="text-sm text-slate-500">
              Будет отправлена заявка на сумму{' '}
              <span className="font-semibold text-slate-800">{fmt(summary?.dispatcher_debt)} с.</span>{' '}
              — владелец подтвердит или отклонит её.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" fullWidth onClick={() => setConfirmOpen(false)}>Отмена</Button>
              <Button variant="primary" fullWidth onClick={handleSubmit} loading={submitMutation.isPending}>
                Отправить
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
