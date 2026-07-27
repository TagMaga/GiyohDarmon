/**
 * CashLedgerPanel — Owner Logistics → Cash tab.
 *
 * Единый список: courier→dispatcher cash handovers and dispatcher→company
 * settlements merged into one date-sorted table (see useCashLedger), with
 * four KPI boxes (courier debt / dispatcher received / dispatcher paid /
 * dispatcher debt to company — driven only by the date filter, per the
 * approved design) and 5 filters (Дата/Отправитель/Получатель/Статус/Сумма).
 * Columns: Дата | Отправитель | Получатель | Ожидалось | Отправил |
 * Разница | Текущий долг | Квитанция | Статус | Действия. Confirm/reject
 * only while pending; "Изменить" (with full history) only after a
 * decision — owner-only for both row types.
 */
import { useEffect, useState } from 'react'
import {
  Wallet, Coins, Landmark, AlertTriangle, CheckCircle2, XCircle,
  Pencil, History, Image as ImageIcon,
} from 'lucide-react'
import KpiCard from '../../../shared/components/KpiCard'
import Badge from '../../../shared/components/Badge'
import Button from '../../../shared/components/Button'
import Modal from '../../../shared/components/Modal'
import Skeleton from '../../../shared/components/Skeleton'
import EmptyState from '../../../shared/components/EmptyState'
import { useToast } from '../../../shared/components/ToastProvider'
import CashLedgerFilterBar from '../../../shared/components/CashLedgerFilterBar'
import {
  fmt, fmtDate, STATUS_CFG, statusLabel, ACTION_LABEL, ROLE_LABEL, ROLE_CLASS,
  PersonCell, DiffCell, DebtCell, ReceiptThumb, LEDGER_TABLE_HEADERS,
} from '../../../shared/components/cashLedgerCells'
import { useCashLedger } from '../hooks/useCashLedger'
import { useSettlementsSummary, useConfirmSettlement, useRejectSettlement, useEditSettlement, useSettlementHistory } from '../hooks/useDispatcherSettlements'
import { useUpdateHandover, useEditHandover, useHandoverHistory } from '../hooks/useHandovers'

function HistoryList({ history }) {
  if (!history || history.length === 0) return null
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <History size={12} /> История изменений ({history.length})
      </p>
      <div className="space-y-2">
        {history.map((e) => (
          <div key={e.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-700">{ACTION_LABEL[e.action] ?? e.action}</span>
              <span className="text-slate-400 whitespace-nowrap">{fmtDate(e.created_at)}</span>
            </div>
            {e.editor_name && (
              <p className="text-slate-500">Кем: <span className="font-medium text-slate-700">{e.editor_name}</span></p>
            )}
            {e.old_status !== e.new_status && (
              <p className="text-slate-500">
                Статус: {statusLabel(e.old_status)} → <span className="font-medium text-slate-700">{statusLabel(e.new_status)}</span>
              </p>
            )}
            {e.reason && (
              <p className="text-slate-500">Причина изменения: <span className="text-slate-700 italic">{e.reason}</span></p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Verify/edit modal — dispatches to the right mutation depending on
// row.source (handover vs settlement), same UX for both. ─────────────────
function VerifyModal({ row, open, initialView = 'detail', onClose, onDone }) {
  const [view, setView] = useState('detail')
  const [actualInput, setActualInput] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [editStatus, setEditStatus] = useState('confirmed')
  const [editActual, setEditActual] = useState('')
  const [editAdminNote, setEditAdminNote] = useState('')
  const [editReason, setEditReason] = useState('')

  const toast = useToast()
  const isHandover = row?.source === 'handover'

  const { mutate: updateHandover, isPending: handoverConfirming } = useUpdateHandover()
  const { mutate: editHandover, isPending: handoverEditing } = useEditHandover()
  const { data: handoverHistory = [] } = useHandoverHistory(isHandover ? row?.raw?.id : null, open && isHandover)

  const { mutate: confirmSettlement, isPending: settlementConfirming } = useConfirmSettlement()
  const { mutate: rejectSettlement, isPending: settlementRejecting } = useRejectSettlement()
  const { mutate: editSettlement, isPending: settlementEditing } = useEditSettlement()
  const { data: settlementHistory = [] } = useSettlementHistory(!isHandover ? row?.raw?.id : null, open && !isHandover)

  const history = isHandover ? handoverHistory : settlementHistory
  const confirming = isHandover ? handoverConfirming : settlementConfirming
  const rejecting = isHandover ? handoverConfirming : settlementRejecting
  const editing = isHandover ? handoverEditing : settlementEditing

  useEffect(() => {
    if (!open || !row) return
    setView(initialView)
    setActualInput(String(row.expected ?? ''))
    setRejectReason('')
    setEditStatus(row.status === 'rejected' ? 'rejected' : 'confirmed')
    setEditActual(row.sent != null ? String(row.sent) : '')
    setEditAdminNote(row.adminNote ?? '')
    setEditReason('')
  }, [open, row?.id, initialView]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) return null

  const sc = STATUS_CFG[row.status] ?? STATUS_CFG.pending
  const isPending = row.status === 'pending'
  const isFinal = row.status === 'confirmed' || row.status === 'rejected'

  function handleConfirm() {
    const amt = parseFloat(actualInput)
    const value = isNaN(amt) ? row.expected : amt
    if (isHandover) {
      updateHandover({ id: row.raw.id, status: 'confirmed', actual_returned: value }, {
        onSuccess: () => { toast.success('Передача подтверждена'); onDone() },
        onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
      })
    } else {
      confirmSettlement({ id: row.raw.id, actualReceived: value }, {
        onSuccess: () => { toast.success('Заявка принята'); onDone() },
        onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
      })
    }
  }

  function handleReject() {
    if (!rejectReason.trim()) return
    if (isHandover) {
      updateHandover({ id: row.raw.id, status: 'rejected', admin_note: rejectReason }, {
        onSuccess: () => { toast.success('Передача отклонена'); onDone() },
        onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
      })
    } else {
      rejectSettlement({ id: row.raw.id, reason: rejectReason }, {
        onSuccess: () => { toast.success('Заявка отклонена'); onDone() },
        onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
      })
    }
  }

  const editRejectNoteMissing = editStatus === 'rejected' && !editAdminNote.trim() && !row.rejectionReason
  function handleEditSave() {
    if (editRejectNoteMissing) return
    const amt = parseFloat(editActual)
    const body = { id: row.raw.id, status: editStatus }
    if (isHandover) {
      if (!isNaN(amt)) body.actual_returned = amt
      if (editAdminNote.trim()) body.admin_note = editAdminNote.trim()
      if (editReason.trim()) body.comment = editReason.trim()
      editHandover(body, {
        onSuccess: () => { toast.success('Изменения сохранены'); setView('detail') },
        onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
      })
    } else {
      if (!isNaN(amt)) body.actual_received = amt
      if (editAdminNote.trim()) body.admin_note = editAdminNote.trim()
      if (editReason.trim()) body.reason = editReason.trim()
      editSettlement(body, {
        onSuccess: () => { toast.success('Изменения сохранены'); setView('detail') },
        onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
      })
    }
  }

  function resetAndClose() { setView('detail'); onClose() }

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title="Проверка передачи"
      size="lg"
      footer={
        view === 'detail' ? (
          <div className="flex items-center justify-between gap-2 w-full flex-wrap">
            <div className="flex gap-2">
              {isFinal && (
                <button onClick={() => setView('edit')} className="btn btn-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200">
                  <Pencil size={14} /> Изменить
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={resetAndClose} className="btn btn-md btn-secondary">Закрыть</button>
              {isPending && (
                <>
                  <button onClick={() => setView('reject')} className="btn btn-md bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200">
                    <XCircle size={14} /> Отклонить
                  </button>
                  <button onClick={() => setView('confirm')} className="btn btn-md btn-primary">
                    <CheckCircle2 size={14} /> Принять
                  </button>
                </>
              )}
            </div>
          </div>
        ) : view === 'confirm' ? (
          <>
            <button onClick={() => setView('detail')} className="btn btn-md btn-secondary">Назад</button>
            <button onClick={handleConfirm} disabled={confirming} className="btn btn-md btn-primary">
              {confirming ? 'Сохранение…' : '✓ Принять'}
            </button>
          </>
        ) : view === 'edit' ? (
          <>
            <button onClick={() => setView('detail')} className="btn btn-md btn-secondary">Назад</button>
            <button onClick={handleEditSave} disabled={editRejectNoteMissing || editing} className="btn btn-md btn-primary disabled:opacity-40">
              {editing ? 'Сохранение…' : 'Сохранить изменения'}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setView('detail')} className="btn btn-md btn-secondary">Назад</button>
            <button onClick={handleReject} disabled={!rejectReason.trim() || rejecting} className="btn btn-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40">
              {rejecting ? 'Сохранение…' : 'Отклонить'}
            </button>
          </>
        )
      }
    >
      {view === 'detail' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 font-black flex-shrink-0">
              {row.senderName?.charAt(0) ?? '?'}
            </div>
            <div>
              <p className="font-bold text-slate-900">{row.senderName} → {row.receiverName ?? '—'}</p>
              <p className="text-xs text-slate-500">{fmtDate(row.date)}</p>
            </div>
            <Badge variant={sc.badge} className="ml-auto">{sc.label}</Badge>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-slate-50 rounded-xl">
              <p className="text-[11px] text-slate-400 mb-1">Ожидалось</p>
              <p className="text-lg font-black text-slate-700 tabular-nums">{fmt(row.expected)}</p>
              <p className="text-[10px] text-slate-400">c</p>
            </div>
            <div className="text-center p-3 bg-slate-50 rounded-xl">
              <p className="text-[11px] text-slate-400 mb-1">Отправил</p>
              <p className={`text-lg font-black tabular-nums ${row.sent != null ? 'text-indigo-700' : 'text-slate-300'}`}>
                {row.sent != null ? fmt(row.sent) : '—'}
              </p>
              <p className="text-[10px] text-slate-400">c</p>
            </div>
            <div className="text-center p-3 bg-slate-50 rounded-xl">
              <p className="text-[11px] text-slate-400 mb-1">Разница</p>
              <p className="text-lg font-black tabular-nums"><DiffCell expected={row.expected} actual={row.sent} /></p>
            </div>
          </div>

          {row.comment && (
            <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">Комментарий: {row.comment}</p>
          )}
          {row.status === 'rejected' && row.rejectionReason && (
            <p className="text-sm text-rose-700 bg-rose-50 rounded-xl p-3">Причина отклонения: {row.rejectionReason}</p>
          )}

          {Array.isArray(row.mediaAssets) && row.mediaAssets.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <ImageIcon size={12} /> Квитанция
              </p>
              <div className="flex gap-2 flex-wrap">
                {row.mediaAssets.map((a) => (
                  <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block w-20 h-20 rounded-lg overflow-hidden border border-slate-200">
                    <img src={a.thumb_url || a.url} alt="квитанция" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <HistoryList history={history} />
        </div>
      )}

      {view === 'confirm' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Сколько фактически получено от {row.senderName}?</p>
          <input
            type="number" min="0" step="0.01" autoFocus
            value={actualInput} onChange={(e) => setActualInput(e.target.value)}
            className="input text-lg font-bold tabular-nums"
          />
        </div>
      )}

      {view === 'reject' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Причина отклонения — {row.senderName}, {fmt(row.expected)} c.</p>
          <textarea
            value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
            className="input resize-none" rows={3} placeholder="Причина отклонения…" autoFocus
          />
        </div>
      )}

      {view === 'edit' && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">Статус</p>
            <select className="input" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
              <option value="confirmed">Принято</option>
              <option value="rejected">Отклонено</option>
            </select>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">Отправил (фактически)</p>
            <input type="number" min="0" step="0.01" value={editActual} onChange={(e) => setEditActual(e.target.value)} className="input tabular-nums" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">
              Примечание{editStatus === 'rejected' ? ' (причина отклонения)' : ''}
            </p>
            <textarea value={editAdminNote} onChange={(e) => setEditAdminNote(e.target.value)} className="input resize-none" rows={2} />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">Причина изменения</p>
            <textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} className="input resize-none" rows={2} placeholder="Например: ошиблись в сумме" />
          </div>
          <HistoryList history={history} />
        </div>
      )}
    </Modal>
  )
}

export default function CashLedgerPanel() {
  const [range, setRange] = useState({ from: '', to: '' })
  const [sender, setSender] = useState('')
  const [receiver, setReceiver] = useState('')
  const [status, setStatus] = useState('')
  const [amount, setAmount] = useState({ min: '', max: '' })
  const [modalRow, setModalRow] = useState(null)
  const [modalView, setModalView] = useState('detail')

  const { data: summary, isLoading: summaryLoading } = useSettlementsSummary({
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

  function openRow(row, view = 'detail') { setModalRow(row); setModalView(view) }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Долг курьеров" value={`${fmt(summary?.courier_debt)} с.`} icon={<AlertTriangle size={20} />} color="rose" loading={summaryLoading} />
        <KpiCard label="Диспетчер получил" value={`${fmt(summary?.received)} с.`} icon={<Coins size={20} />} color="sky" loading={summaryLoading} />
        <KpiCard label="Диспетчер сдал" value={`${fmt(summary?.paid)} с.`} icon={<Landmark size={20} />} color="emerald" loading={summaryLoading} />
        <KpiCard label="Долг диспетчера компании" value={`${fmt(summary?.dispatcher_debt)} с.`} icon={<Wallet size={20} />} color="amber" loading={summaryLoading} />
      </div>

      <CashLedgerFilterBar
        from={range.from} to={range.to} onDateChange={setRange}
        sender={sender} onSenderChange={setSender}
        receiver={receiver} onReceiverChange={setReceiver}
        status={status} onStatusChange={setStatus}
        amountMin={amount.min} amountMax={amount.max} onAmountChange={setAmount}
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Нет передач" description="Передачи наличных появятся здесь" />
      ) : (
        <>
          <div className="hidden lg:block overflow-hidden rounded-2xl border border-slate-100 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[960px]">
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
                    const isFinal = row.status === 'confirmed' || row.status === 'rejected'
                    return (
                      <tr key={`${row.source}-${row.id}`} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors cursor-pointer" onClick={() => openRow(row)}>
                        <td className="px-4 py-3 text-[11px] text-slate-400 whitespace-nowrap">{fmtDate(row.date)}</td>
                        <td className="px-4 py-3"><PersonCell name={row.senderName} role={row.senderRole} /></td>
                        <td className="px-4 py-3"><PersonCell name={row.receiverName} role={row.receiverRole} /></td>
                        <td className="px-4 py-3 text-xs font-semibold tabular-nums">{fmt(row.expected)}</td>
                        <td className={`px-4 py-3 text-xs font-semibold tabular-nums ${row.sent != null ? 'text-indigo-700' : 'text-slate-300'}`}>
                          {row.sent != null ? fmt(row.sent) : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs"><DiffCell expected={row.expected} actual={row.sent} /></td>
                        <td className="px-4 py-3"><DebtCell amount={row.currentDebt} /></td>
                        <td className="px-4 py-3"><ReceiptThumb mediaAssets={row.mediaAssets} onClick={() => openRow(row)} /></td>
                        <td className="px-4 py-3"><Badge variant={st.badge} dot>{st.label}</Badge></td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {row.status === 'pending' ? (
                            <div className="flex gap-1">
                              <Button size="sm" variant="primary" icon={<CheckCircle2 size={14} />} onClick={() => openRow(row, 'confirm')}>Принять</Button>
                              <Button size="sm" variant="danger" icon={<XCircle size={14} />} onClick={() => openRow(row, 'reject')}>Откл.</Button>
                            </div>
                          ) : isFinal ? (
                            <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => openRow(row, 'edit')}>Изменить</Button>
                          ) : null}
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
              const isFinal = row.status === 'confirmed' || row.status === 'rejected'
              return (
                <div key={`${row.source}-${row.id}`} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-2" onClick={() => openRow(row)}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {row.senderName} <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${ROLE_CLASS[row.senderRole]}`}>{ROLE_LABEL[row.senderRole]}</span>
                        {' → '}
                        {row.receiverName ?? '—'} {row.receiverRole && <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${ROLE_CLASS[row.receiverRole]}`}>{ROLE_LABEL[row.receiverRole]}</span>}
                      </p>
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
                  {row.status === 'pending' && (
                    <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="primary" fullWidth onClick={() => openRow(row, 'confirm')}>Принять</Button>
                      <Button size="sm" variant="danger" fullWidth onClick={() => openRow(row, 'reject')}>Отклонить</Button>
                    </div>
                  )}
                  {isFinal && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => openRow(row, 'edit')}>Изменить</Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <VerifyModal
        row={modalRow}
        open={!!modalRow}
        initialView={modalView}
        onClose={() => setModalRow(null)}
        onDone={() => setModalRow(null)}
      />
    </div>
  )
}
