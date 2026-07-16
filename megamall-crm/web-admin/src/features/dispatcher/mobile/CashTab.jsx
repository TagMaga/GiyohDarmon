import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { C, avatarStyle, initialsOf, chipStyle } from './theme'
import { fmt, fmtDate } from '../statusConfig'
import { KEYS } from '../../../shared/queryKeys'
import { useToast } from '../../../shared/components/ToastProvider'
import {
  fetchHandovers, confirmHandover, rejectHandover,
  fetchCashTransactions, confirmCashTransaction, rejectCashTransaction,
} from '../api'

const arr = (d) => Array.isArray(d) ? d : (d?.data ?? [])

const STATUS_FILTERS = [
  { value: '', label: 'Все' },
  { value: 'pending', label: 'Ожидает' },
  { value: 'confirmed', label: 'Принято' },
  { value: 'rejected', label: 'Отклонено' },
]

export default function CashTab({ couriers, cashOwed }) {
  const [statusFilter, setStatusFilter] = useState('')
  const qc = useQueryClient()
  const toast = useToast()

  const courierMap = useMemo(() => {
    const m = {}
    for (const c of couriers) m[c.courier_id ?? c.id] = c
    return m
  }, [couriers])
  const courierName = (id) => courierMap[id]?.full_name ?? courierMap[id]?.courier?.full_name ?? 'Курьер'

  const handoversQ = useQuery({ queryKey: KEYS.dispatcher.handovers, queryFn: fetchHandovers, staleTime: 30_000 })
  const pendingHandovers = arr(handoversQ.data).filter((h) => h.status === 'pending')

  const txParams = useMemo(() => ({ page: 1, limit: 30, ...(statusFilter ? { status: statusFilter } : {}) }), [statusFilter])
  const txQ = useQuery({ queryKey: KEYS.dispatcher.cashTransactions(txParams), queryFn: () => fetchCashTransactions(txParams), staleTime: 20_000 })
  const txRows = arr(txQ.data?.data ?? txQ.data)

  const cashCollected = useMemo(() => couriers.reduce((s, c) => s + Number(c.total_collected ?? 0), 0), [couriers])

  const { mutate: doConfirmHandover } = useMutation({
    mutationFn: ({ id, amount }) => confirmHandover(id, { actual_returned: amount }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.handovers })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers })
      toast.success('Инкассация принята')
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })
  const { mutate: doRejectHandover } = useMutation({
    mutationFn: ({ id, reason }) => rejectHandover(id, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.handovers })
      toast.success('Инкассация отклонена')
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })
  const { mutate: doConfirmTx, isPending: confirmingTx } = useMutation({
    mutationFn: (id) => confirmCashTransaction(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dispatcher'] }); toast.success('Транзакция подтверждена') },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })
  const { mutate: doRejectTx, isPending: rejectingTx } = useMutation({
    mutationFn: ({ id, reason }) => rejectCashTransaction(id, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dispatcher'] }); toast.success('Транзакция отклонена') },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  return (
    <div>
      {/* Settlement summary */}
      <div style={{ margin: '0 18px 14px', borderRadius: 18, padding: '16px 17px', background: C.gradient, color: '#fff', boxShadow: '0 12px 26px rgba(67,56,202,.28)' }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', opacity: .8 }}>К сдаче сегодня</div>
        <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1.1, margin: '4px 0 12px' }}>
          {fmt(cashOwed)} <span style={{ fontSize: 15, fontWeight: 700, opacity: .75 }}>сом</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, background: 'rgba(255,255,255,.14)', borderRadius: 12, padding: '9px 11px' }}>
            <div style={{ fontSize: 10, opacity: .8 }}>Собрано</div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{fmt(cashCollected)}</div>
          </div>
          <div style={{ flex: 1, background: 'rgba(255,255,255,.14)', borderRadius: 12, padding: '9px 11px' }}>
            <div style={{ fontSize: 10, opacity: .8 }}>Курьеров</div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{couriers.length}</div>
          </div>
        </div>
      </div>

      {/* Handovers */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px 10px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: C.text3 }}>Инкассации</div>
        <span style={{ fontSize: 11, fontWeight: 800, color: C.amber }}>{pendingHandovers.length} на проверке</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 18px 16px' }}>
        {handoversQ.isPending ? (
          <div style={{ height: 90, borderRadius: 16, background: C.border2 }} />
        ) : pendingHandovers.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.text3, padding: '4px 4px 0' }}>Нет инкассаций на проверке</div>
        ) : (
          pendingHandovers.map((h) => {
            const name = courierName(h.courier_id)
            return (
              <div key={h.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, flexShrink: 0, ...avatarStyle(name) }}>{initialsOf(name)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>{name}</div>
                    <div style={{ fontSize: 11.5, color: C.text3 }}>{fmtDate(h.created_at)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 17, fontWeight: 900, color: C.green }}>{fmt(h.total_to_return)}</div>
                    <div style={{ fontSize: 10, color: C.text3 }}>сом</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => doConfirmHandover({ id: h.id, amount: h.total_to_return })}
                    style={{ flex: 1, padding: 10, border: 'none', borderRadius: 11, background: C.green, color: '#fff', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Принять {fmt(h.total_to_return)}
                  </button>
                  <button
                    onClick={() => doRejectHandover({ id: h.id, reason: 'Сумма не сходится' })}
                    style={{ padding: '10px 16px', border: `1px solid ${C.redSoft}`, borderRadius: 11, background: '#fff', color: C.red, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Спор
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Transactions */}
      <div style={{ padding: '0 20px 10px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: C.text3 }}>Операции</div>
      <div className="dm-scroll" style={{ display: 'flex', gap: 8, padding: '0 18px 12px', overflowX: 'auto' }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            style={{ flexShrink: 0, height: 34, padding: '0 14px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, border: 'none', whiteSpace: 'nowrap', ...chipStyle(statusFilter === f.value) }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 18px' }}>
        {txQ.isPending ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} style={{ height: 90, borderRadius: 16, background: C.border2 }} />)
        ) : txRows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 16px', color: C.text3, fontSize: 13 }}>Нет операций</div>
        ) : (
          txRows.map((t) => (
            <TxCard key={t.id} row={t} courierName={courierName(t.courier_id)} busy={confirmingTx || rejectingTx} onConfirm={doConfirmTx} onReject={doRejectTx} />
          ))
        )}
      </div>
    </div>
  )
}

const TX_STATUS_LABEL = { pending: 'Ожидает', confirmed: 'Принято', rejected: 'Отклонено' }
const TX_STATUS_COLOR = { pending: C.amber, confirmed: C.green, rejected: C.red }
const TX_STATUS_BG = { pending: C.amberBg, confirmed: C.greenBg, rejected: C.redBg }

function TxCard({ row, courierName, busy, onConfirm, onReject }) {
  const [rejecting, setRejecting] = useState(false)
  const isPending = row.status === 'pending'
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 10 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, flexShrink: 0, ...avatarStyle(courierName) }}>{initialsOf(courierName)}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{courierName}</div>
          <div style={{ fontSize: 11.5, color: C.text3 }}>{fmtDate(row.created_at)}</div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: TX_STATUS_BG[row.status] ?? C.border2, color: TX_STATUS_COLOR[row.status] ?? C.text2 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: TX_STATUS_COLOR[row.status] ?? C.text3 }} />
          {TX_STATUS_LABEL[row.status] ?? row.status}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 12, color: C.text2, flex: 1 }}>{row.note ?? row.reason ?? '—'}</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.green }}>{fmt(row.amount)} сом</div>
      </div>
      {isPending && (
        rejecting ? (
          <RejectBox busy={busy} onCancel={() => setRejecting(false)} onSubmit={(reason) => { onReject({ id: row.id, reason }); setRejecting(false) }} />
        ) : (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button disabled={busy} onClick={() => onConfirm(row.id)} style={{ flex: 1, padding: 9, border: 'none', borderRadius: 10, background: C.greenBg, color: C.green, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Принять</button>
            <button disabled={busy} onClick={() => setRejecting(true)} style={{ flex: 1, padding: 9, border: 'none', borderRadius: 10, background: C.redBg, color: C.red, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Отклонить</button>
          </div>
        )
      )}
    </div>
  )
}

function RejectBox({ busy, onCancel, onSubmit }) {
  const [reason, setReason] = useState('')
  return (
    <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Причина отказа"
        style={{ flex: 1, border: `1px solid ${C.border}`, background: C.cardAlt, borderRadius: 10, padding: '8px 10px', fontFamily: 'inherit', fontSize: 12, outline: 'none' }}
      />
      <button disabled={!reason.trim() || busy} onClick={() => onSubmit(reason.trim())} style={{ padding: '8px 12px', border: 'none', borderRadius: 10, background: C.red, color: '#fff', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !reason.trim() || busy ? 0.5 : 1 }}>OK</button>
      <button onClick={onCancel} style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 10, background: '#fff', color: C.text2, fontFamily: 'inherit', fontSize: 12, cursor: 'pointer' }}>×</button>
    </div>
  )
}
