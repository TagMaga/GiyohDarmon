/**
 * CompanySettlementTab — Dispatcher Касса → "Компания" tab.
 *
 * Same merged ledger, KPI boxes, and filters as the owner logistics cash
 * tab (see features/logistics/components/CashLedgerPanel), plus the
 * "Сдать компании" button, which submits the dispatcher's current
 * outstanding balance for owner review. Handover rows (courier→dispatcher)
 * are confirm/reject-able here by the dispatcher, via the same
 * internal/dispatch endpoints as the "Сдачи" tab (CashHandovers.jsx) —
 * any dispatcher can act on any courier's handover, see useCashLedger.
 * Settlement rows (dispatcher→company) stay read-only: only the owner can
 * approve a dispatcher's own submission to the company.
 */
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Wallet, Coins, Landmark, AlertTriangle, Camera, X, Send, CheckCircle2, XCircle } from 'lucide-react'
import KpiCard from '../../../../shared/components/KpiCard'
import Badge from '../../../../shared/components/Badge'
import Button from '../../../../shared/components/Button'
import Modal from '../../../../shared/components/Modal'
import Alert from '../../../../shared/components/Alert'
import Skeleton from '../../../../shared/components/Skeleton'
import EmptyState from '../../../../shared/components/EmptyState'
import CashLedgerFilterBar from '../../../../shared/components/CashLedgerFilterBar'
import {
  fmt, fmtDate, STATUS_CFG, PersonCell, DiffCell, DebtCell, ReceiptThumb, LEDGER_TABLE_HEADERS,
} from '../../../../shared/components/cashLedgerCells'
import { useToast } from '../../../../shared/components/ToastProvider'
import { uploadToMedia } from '../../../../shared/api/mediaUpload'
import { translateMediaError } from '../../../../shared/api/mediaErrors'
import { KEYS } from '../../../../shared/queryKeys'
import { confirmHandover, rejectHandover } from '../../api'
import { useMySettlementsSummary, useSubmitSettlement } from '../../hooks/useCompanySettlement'
import { useCashLedger } from '../../hooks/useCashLedger'

// ── Confirm handover modal — mirrors CashHandovers.jsx's ConfirmHandoverModal,
// adapted to the merged ledger's normalized row shape (row.raw is the
// underlying cash_handovers record). ─────────────────────────────────────
function ConfirmHandoverModal({ open, onClose, row }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [actual, setActual] = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => confirmHandover(row.raw.id, { actual_returned: parseFloat(actual) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistics', 'handovers'] })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.handovers })
      toast.success('Сдача принята')
      handleClose()
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
  })

  function handleClose() { reset(); setActual(''); onClose() }
  const errMsg = error?.response?.data?.error?.message ?? error?.message

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Принять сдачу наличных"
      description={row ? `Ожидается: ${fmt(row.expected)} c` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button variant="primary" onClick={() => actual && mutate()} loading={isPending} disabled={!actual}>
            Подтвердить
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}
      <div>
        <label className="input-label">Фактически сдано (c) *</label>
        <input
          type="number" step="0.01" value={actual} onChange={(e) => setActual(e.target.value)}
          className="input" placeholder="0.00" autoFocus
        />
      </div>
    </Modal>
  )
}

// ── Reject handover modal ──────────────────────────────────────────────────
function RejectHandoverModal({ open, onClose, row }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => rejectHandover(row.raw.id, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistics', 'handovers'] })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.handovers })
      toast.success('Сдача отклонена')
      handleClose()
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
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
          <Button variant="danger" onClick={() => reason.trim() && mutate()} loading={isPending} disabled={!reason.trim()}>
            Отклонить
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}
      <div>
        <label className="input-label">Причина отклонения *</label>
        <textarea
          value={reason} onChange={(e) => setReason(e.target.value)}
          className="input resize-none" rows={3} placeholder="Объясните причину…" autoFocus
        />
      </div>
    </Modal>
  )
}

export default function CompanySettlementTab() {
  const toast = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [proofFile, setProofFile] = useState(null)
  const [proofPreview, setProofPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)
  const [confirmHandoverRow, setConfirmHandoverRow] = useState(null)
  const [rejectHandoverRow, setRejectHandoverRow] = useState(null)

  const [range, setRange] = useState({ from: '', to: '' })
  const [sender, setSender] = useState('')
  const [receiver, setReceiver] = useState('')
  const [status, setStatus] = useState('')
  const [amount, setAmount] = useState({ min: '', max: '' })

  const { data: summary, isLoading: summaryLoading } = useMySettlementsSummary({
    from: range.from || undefined, to: range.to || undefined,
  })
  const { rows, isLoading } = useCashLedger({
    from: range.from || undefined,
    to: range.to || undefined,
    status: status || undefined,
    senderQuery: sender,
    receiverQuery: receiver,
    amountMin: amount.min,
    amountMax: amount.max,
  })

  const submitMutation = useSubmitSettlement()
  const canPay = (summary?.dispatcher_debt ?? 0) > 0.009

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setProofFile(file)
    setProofPreview(URL.createObjectURL(file))
  }

  function clearProof() {
    setProofFile(null)
    setProofPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async () => {
    try {
      let proofAssetId
      if (proofFile) {
        setUploading(true)
        // 'cash_handover_proof' — same category as courier/dispatcher cash
        // handover receipts, dispatchers are already an allowed uploader
        // role for it (see internal/media/rbac.go).
        const asset = await uploadToMedia(proofFile, 'cash_handover_proof')
        proofAssetId = asset.id
      }
      submitMutation.mutate({ proofAssetId }, {
        onSuccess: () => {
          toast.success('Заявка отправлена владельцу на подтверждение')
          setConfirmOpen(false)
          clearProof()
        },
        onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
      })
    } catch (err) {
      toast.error(translateMediaError(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4 w-full h-full">
      {/* KPI boxes — same size/style as the owner logistics cash tab (CashLedgerPanel) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Долг курьеров" value={`${fmt(summary?.courier_debt)} с.`} icon={<AlertTriangle size={20} />} color="rose" loading={summaryLoading} />
        <KpiCard label="Я получил" value={`${fmt(summary?.received)} с.`} icon={<Coins size={20} />} color="sky" loading={summaryLoading} />
        <KpiCard label="Я сдал компании" value={`${fmt(summary?.paid)} с.`} icon={<Landmark size={20} />} color="emerald" loading={summaryLoading} />
        <KpiCard label="Мой долг компании" value={`${fmt(summary?.dispatcher_debt)} с.`} icon={<Wallet size={20} />} color="amber" loading={summaryLoading} />
      </div>

      <CashLedgerFilterBar
        from={range.from} to={range.to} onDateChange={setRange}
        sender={sender} onSenderChange={setSender}
        receiver={receiver} onReceiverChange={setReceiver}
        status={status} onStatusChange={setStatus}
        amountMin={amount.min} amountMax={amount.max} onAmountChange={setAmount}
        trailing={(
          // The one real difference from the owner view: this button, inline with the filter row.
          <Button
            variant="primary" size="sm" icon={<Send size={14} />}
            disabled={!canPay} onClick={() => setConfirmOpen(true)}
            className="flex-shrink-0 whitespace-nowrap"
          >
            Сдать {fmt(summary?.dispatcher_debt)} с. компании
          </Button>
        )}
      />

      {/* Ledger — read-only here; only the owner can confirm/reject/edit. */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Нет передач" description="Передачи наличных появятся здесь" />
      ) : (
        <>
          <div className="hidden lg:block overflow-hidden rounded-2xl border border-slate-100 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-slate-100">
                    {LEDGER_TABLE_HEADERS.map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const st = STATUS_CFG[row.status] ?? STATUS_CFG.pending
                    return (
                      <tr key={`${row.source}-${row.id}`} className="border-b border-slate-50">
                        <td className="px-4 py-3 text-[11px] text-slate-400 whitespace-nowrap">{fmtDate(row.date)}</td>
                        <td className="px-4 py-3"><PersonCell name={row.senderName} role={row.senderRole} /></td>
                        <td className="px-4 py-3"><PersonCell name={row.receiverName} role={row.receiverRole} /></td>
                        <td className="px-4 py-3 text-xs font-semibold tabular-nums">{fmt(row.expected)}</td>
                        <td className={`px-4 py-3 text-xs font-semibold tabular-nums ${row.sent != null ? 'text-indigo-700' : 'text-slate-300'}`}>
                          {row.sent != null ? fmt(row.sent) : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs"><DiffCell expected={row.expected} actual={row.sent} /></td>
                        <td className="px-4 py-3"><DebtCell amount={row.currentDebt} /></td>
                        <td className="px-4 py-3"><ReceiptThumb mediaAssets={row.mediaAssets} /></td>
                        <td className="px-4 py-3"><Badge variant={st.badge} dot>{st.label}</Badge></td>
                        <td className="px-4 py-3">
                          {row.status === 'pending' && row.source === 'handover' ? (
                            <div className="flex gap-1">
                              <Button size="sm" variant="primary" icon={<CheckCircle2 size={14} />} onClick={() => setConfirmHandoverRow(row)}>Принять</Button>
                              <Button size="sm" variant="danger" icon={<XCircle size={14} />} onClick={() => setRejectHandoverRow(row)}>Откл.</Button>
                            </div>
                          ) : row.status === 'pending' ? (
                            <span className="text-[11px] font-semibold italic text-amber-600">⏳ Ждём владельца</span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:hidden space-y-3">
            {rows.map((row) => {
              const st = STATUS_CFG[row.status] ?? STATUS_CFG.pending
              return (
                <div key={`${row.source}-${row.id}`} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{row.senderName} → {row.receiverName ?? '—'}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{fmtDate(row.date)}</p>
                    </div>
                    <Badge variant={st.badge} dot>{st.label}</Badge>
                  </div>
                  <div className="flex items-center gap-4 flex-wrap text-xs">
                    <span className="text-slate-500">Ожидалось: <strong className="text-slate-800">{fmt(row.expected)} c</strong></span>
                    {row.sent != null && <span className="text-indigo-700">Отправил: <strong>{fmt(row.sent)} c</strong></span>}
                    <DebtCell amount={row.currentDebt} />
                  </div>
                  {row.status === 'rejected' && row.rejectionReason && (
                    <p className="text-xs text-rose-600">{row.rejectionReason}</p>
                  )}
                  {row.status === 'pending' && row.source === 'handover' && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="primary" fullWidth onClick={() => setConfirmHandoverRow(row)}>Принять</Button>
                      <Button size="sm" variant="danger" fullWidth onClick={() => setRejectHandoverRow(row)}>Отклонить</Button>
                    </div>
                  )}
                  {row.status === 'pending' && row.source !== 'handover' && (
                    <span className="text-[11px] font-semibold italic text-amber-600">⏳ Ждём владельца</span>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <ConfirmHandoverModal row={confirmHandoverRow} open={!!confirmHandoverRow} onClose={() => setConfirmHandoverRow(null)} />
      <RejectHandoverModal row={rejectHandoverRow} open={!!rejectHandoverRow} onClose={() => setRejectHandoverRow(null)} />

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

            <div>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" id="settlement-proof-input" />
              {proofPreview ? (
                <div className="relative w-full h-32 rounded-xl overflow-hidden border border-slate-200">
                  <img src={proofPreview} alt="Квитанция" className="w-full h-full object-cover" />
                  <button
                    type="button" onClick={clearProof}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <label htmlFor="settlement-proof-input" className="flex items-center justify-center gap-2 w-full h-16 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 text-sm cursor-pointer hover:border-indigo-300 hover:text-indigo-500 transition-colors">
                  <Camera size={16} /> Прикрепить фото (необязательно)
                </label>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="secondary" fullWidth onClick={() => { setConfirmOpen(false); clearProof() }}>Отмена</Button>
              <Button variant="primary" fullWidth onClick={handleSubmit} loading={submitMutation.isPending || uploading}>
                Отправить
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
