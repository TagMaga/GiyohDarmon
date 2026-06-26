import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wallet, ChevronDown, ChevronUp } from 'lucide-react'
import { KEYS } from '../../../shared/queryKeys'
import { fetchHandovers, confirmHandover, rejectHandover, fetchCouriersOverview } from '../api'
import Badge      from '../../../shared/components/Badge'
import Button     from '../../../shared/components/Button'
import Alert      from '../../../shared/components/Alert'
import EmptyState from '../../../shared/components/EmptyState'
import Modal      from '../../../shared/components/Modal'
import { useToast }      from '../../../shared/components/ToastProvider'
import { TableRowSkeleton } from '../../../shared/components/Skeleton'
import { fmt, fmtDate } from '../statusConfig'

const HANDOVER_STATUS = {
  pending:   { label: 'Ожидает',  variant: 'amber'   },
  confirmed: { label: 'Принят',   variant: 'emerald' },
  disputed:  { label: 'Спор',     variant: 'rose'    },
  rejected:  { label: 'Отклонён', variant: 'slate'   },
}

// ── Confirm handover modal ─────────────────────────────────────────────────────
function ConfirmHandoverModal({ open, onClose, handover }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [actual, setActual] = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => confirmHandover(handover.id, {
      actual_returned: parseFloat(actual),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.handovers })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers })
      toast.success('Сдача принята')
      handleClose()
    },
  })

  function handleClose() { reset(); setActual(''); onClose() }
  const errMsg = error?.response?.data?.error?.message ?? error?.message

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Принять сдачу наличных"
      description={handover
        ? `Ожидается: ${fmt(handover.total_to_return)} сом`
        : ''}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button
            variant="primary"
            onClick={() => actual && mutate()}
            loading={isPending}
            disabled={!actual}
          >
            Подтвердить
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}
      <div className="space-y-4">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-1">
          <p className="text-xs text-amber-700 font-medium">Суммы к сверке</p>
          <p className="text-xs text-amber-700">Собрано: <span className="font-semibold">{fmt(handover?.total_collected)}</span></p>
          <p className="text-xs text-amber-700">К сдаче: <span className="font-semibold">{fmt(handover?.total_to_return)}</span></p>
          <p className="text-[10px] text-amber-600 mt-1">
            Разница ≤ 0.01 → Принят. Иначе → Спор.
          </p>
        </div>
        <div>
          <label className="input-label">Фактически сдано (сом) *</label>
          <input
            type="number"
            step="0.01"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            className="input"
            placeholder="0.00"
            autoFocus
          />
        </div>
      </div>
    </Modal>
  )
}

// ── Reject handover modal ──────────────────────────────────────────────────────
function RejectHandoverModal({ open, onClose, handover }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => rejectHandover(handover.id, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.handovers })
      toast.success('Сдача отклонена')
      handleClose()
    },
  })

  function handleClose() { reset(); setReason(''); onClose() }
  const errMsg = error?.response?.data?.error?.message ?? error?.message

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Отклонить сдачу"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button
            variant="danger"
            onClick={() => reason.trim() && mutate()}
            loading={isPending}
            disabled={!reason.trim()}
          >
            Отклонить
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}
      <div>
        <label className="input-label">Причина отклонения *</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="input resize-none"
          rows={3}
          placeholder="Объясните причину…"
          autoFocus
        />
      </div>
    </Modal>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function CashHandovers() {
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [rejectTarget,  setRejectTarget]  = useState(null)
  const [expanded,      setExpanded]      = useState({})

  const { data, isPending, isError, error } = useQuery({
    queryKey: KEYS.dispatcher.handovers,
    queryFn:  fetchHandovers,
    staleTime: 30_000,
  })

  const { data: couriersRaw = [] } = useQuery({
    queryKey: KEYS.dispatcher.couriers,
    queryFn:  fetchCouriersOverview,
    staleTime: 120_000,
  })
  const couriersArr = Array.isArray(couriersRaw) ? couriersRaw : (couriersRaw?.data ?? [])
  const courierNameMap = couriersArr.reduce((m, c) => {
    if (c.courier_id) m[c.courier_id] = c.full_name
    return m
  }, {})

  const handovers = Array.isArray(data) ? data : (data?.handovers ?? data?.data ?? [])

  function toggleExpand(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  if (isError) {
    return <Alert variant="error" title="Ошибка загрузки">
      {error?.response?.data?.error?.message ?? error?.message}
    </Alert>
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden lg:block card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-800">Сдачи наличных</span>
          <span className="text-xs text-slate-400">{handovers.length} записей</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70">
                {['Курьер', 'Собрано', 'К сдаче', 'Сдано факт.', 'Статус', 'Создан', 'Действия'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isPending && Array.from({ length: 3 }).map((_, i) => (
                <TableRowSkeleton key={i} cols={7} />
              ))}
              {!isPending && handovers.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={<Wallet size={24} />}
                      title="Нет сдач"
                      description="Курьеры ещё не подавали заявки на сдачу наличных."
                    />
                  </td>
                </tr>
              )}
              {!isPending && handovers.map((h) => {
                const st     = HANDOVER_STATUS[h.status] ?? HANDOVER_STATUS.pending
                const canAct = h.status === 'pending' || h.status === 'disputed'
                const courier = h.courier?.full_name ?? h.courier_name ?? courierNameMap[h.courier_id] ?? '—'
                return (
                  <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 text-xs font-medium text-slate-800">{courier}</td>
                    <td className="px-4 py-3 text-xs">{fmt(h.total_collected)}</td>
                    <td className="px-4 py-3 text-xs font-semibold">{fmt(h.total_to_return)}</td>
                    <td className="px-4 py-3 text-xs">{h.actual_returned != null ? fmt(h.actual_returned) : '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={st.variant} dot>{st.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-400">{fmtDate(h.created_at)}</td>
                    <td className="px-4 py-3">
                      {canAct ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="primary" onClick={() => setConfirmTarget(h)}>
                            Подтвердить
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setRejectTarget(h)}>
                            Отклонить
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden space-y-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold text-slate-800">Сдачи наличных</span>
          <span className="text-xs text-slate-400">{handovers.length}</span>
        </div>

        {isPending && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-3">
            <div className="skeleton h-4 w-32 rounded" />
            <div className="skeleton h-3 w-48 rounded" />
            <div className="flex gap-2">
              <div className="skeleton h-8 w-24 rounded-xl" />
              <div className="skeleton h-8 w-24 rounded-xl" />
            </div>
          </div>
        ))}

        {!isPending && handovers.length === 0 && (
          <div className="card">
            <EmptyState
              icon={<Wallet size={24} />}
              title="Нет сдач"
              description="Курьеры ещё не подавали заявки на сдачу наличных."
            />
          </div>
        )}

        {!isPending && handovers.map((h) => {
          const st      = HANDOVER_STATUS[h.status] ?? HANDOVER_STATUS.pending
          const canAct  = h.status === 'pending' || h.status === 'disputed'
          const courier = h.courier?.full_name ?? h.courier_name ?? '—'
          const open    = expanded[h.id]

          return (
            <div key={h.id} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{courier}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{fmtDate(h.created_at)}</p>
                </div>
                <Badge variant={st.variant} dot size="md">{st.label}</Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-slate-400">К сдаче</p>
                  <p className="font-semibold text-slate-800">{fmt(h.total_to_return)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Сдано факт.</p>
                  <p className="font-semibold text-slate-800">
                    {h.actual_returned != null ? fmt(h.actual_returned) : '—'}
                  </p>
                </div>
              </div>

              {/* Expand details */}
              <button
                onClick={() => toggleExpand(h.id)}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
              >
                {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {open ? 'Скрыть детали' : 'Подробнее'}
              </button>

              {open && (
                <div className="pt-1 border-t border-slate-100 text-xs space-y-1 text-slate-600">
                  <p>Собрано: <span className="font-medium">{fmt(h.total_collected)}</span></p>
                  <p>Доставок: <span className="font-medium">{fmt(h.total_delivery_fees)}</span></p>
                </div>
              )}

              {canAct && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="primary" fullWidth onClick={() => setConfirmTarget(h)}>
                    Подтвердить
                  </Button>
                  <Button size="sm" variant="danger" fullWidth onClick={() => setRejectTarget(h)}>
                    Отклонить
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Modals */}
      <ConfirmHandoverModal
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        handover={confirmTarget}
      />
      <RejectHandoverModal
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        handover={rejectTarget}
      />
    </>
  )
}
