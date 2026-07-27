/**
 * DispatcherSettlementsPanel — Owner Logistics → Cash tab.
 *
 * Four KPI boxes (courier debt / dispatcher received / dispatcher paid /
 * dispatcher debt to company) plus the review history of dispatcher "pay all
 * received to company" submissions — same verification shape as the courier
 * cash-handovers table (Отправитель/Получатель/Ожидалось/Отправил/Разница/
 * Текущий долг/Квитанция/Статус/Действия): the owner enters what was
 * actually counted on confirm, can attach/view a receipt photo, and can
 * later correct a finalized decision with a full edit history. Only the
 * owner can confirm/reject/edit here — the dispatcher-side equivalent
 * (CompanySettlementTab) only lets a dispatcher submit and view their own
 * history.
 */
import { useEffect, useState } from 'react'
import {
  Wallet, Coins, Landmark, AlertTriangle, CheckCircle2, XCircle,
  Pencil, History, Eye, Image as ImageIcon,
} from 'lucide-react'
import KpiCard from '../../../shared/components/KpiCard'
import Badge from '../../../shared/components/Badge'
import Button from '../../../shared/components/Button'
import Modal from '../../../shared/components/Modal'
import Skeleton from '../../../shared/components/Skeleton'
import EmptyState from '../../../shared/components/EmptyState'
import PeriodRangeFilter from '../../../shared/components/PeriodRangeFilter'
import { useToast } from '../../../shared/components/ToastProvider'
import {
  useSettlementsSummary, useSettlements, useDispatchers,
  useConfirmSettlement, useRejectSettlement, useEditSettlement, useSettlementHistory,
} from '../hooks/useDispatcherSettlements'

const fmt = (n) => Number(n ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })

const STATUS_CFG = {
  pending:   { label: 'Ожидает',   badge: 'amber'   },
  confirmed: { label: 'Принято',   badge: 'emerald' },
  rejected:  { label: 'Отклонено', badge: 'rose'    },
}
const statusLabel = (s) => STATUS_CFG[s]?.label ?? s ?? '—'

const ACTION_LABEL = { confirm: 'Подтверждение', reject: 'Отклонение', edit: 'Изменение' }

const fmtDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// For confirmed rows, the owner always accepted the remittance, so fall
// back to the declared amount when actual_received wasn't set explicitly —
// mirrors CashHandoversPage's displayActual.
const displayActual = (row) =>
  row.status === 'confirmed' ? (row.actual_received ?? row.amount) : row.actual_received

function DiffCell({ expected, actual }) {
  if (actual == null) return <span className="text-slate-300">—</span>
  const diff = actual - expected
  if (Math.abs(diff) < 0.01) return <span className="text-emerald-600 font-semibold tabular-nums">= 0</span>
  if (diff < 0) return <span className="text-rose-600 font-semibold tabular-nums">−{fmt(Math.abs(diff))}</span>
  return <span className="text-amber-600 font-semibold tabular-nums">+{fmt(diff)}</span>
}

function DebtCell({ amount }) {
  const owes = (amount ?? 0) > 0.01
  return (
    <span className={`inline-flex ${owes ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'} font-semibold tabular-nums px-2 py-0.5 rounded-full text-xs`}>
      {owes ? fmt(amount) : '0'} c
    </span>
  )
}

function ReceiptThumb({ mediaAssets, onClick }) {
  const assets = Array.isArray(mediaAssets) ? mediaAssets : []
  if (assets.length === 0) return <span className="text-slate-300 text-xs">—</span>
  const first = assets[0]
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      className="group relative w-10 h-10 rounded-lg overflow-hidden border border-slate-200 hover:border-indigo-400 transition-all flex-shrink-0"
      title="Просмотр квитанции"
    >
      <img src={first.thumb_url || first.url} alt="квитанция" loading="lazy" className="w-full h-full object-cover" />
      {assets.length > 1 && (
        <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[9px] px-1 rounded-tl">+{assets.length - 1}</span>
      )}
      <div className="absolute inset-0 bg-indigo-600/0 group-hover:bg-indigo-600/20 transition-all flex items-center justify-center">
        <Eye size={12} className="text-white opacity-0 group-hover:opacity-100 transition-all" />
      </div>
    </button>
  )
}

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
            {(e.old_actual_received ?? null) !== (e.new_actual_received ?? null) && (
              <p className="text-slate-500">
                Отправил: {e.old_actual_received != null ? `${fmt(e.old_actual_received)} c` : '—'} →{' '}
                <span className="font-medium text-slate-700">
                  {e.new_actual_received != null ? `${fmt(e.new_actual_received)} c` : '—'}
                </span>
              </p>
            )}
            {e.new_admin_note && e.new_admin_note !== e.old_admin_note && (
              <p className="text-slate-500">Примечание: <span className="text-rose-700">{e.new_admin_note}</span></p>
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

function VerifyModal({ row, open, initialView = 'detail', onClose, onConfirm, onReject, onEdit, confirming, rejecting, editing }) {
  const [view, setView] = useState('detail')
  const [actualInput, setActualInput] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [editStatus, setEditStatus] = useState('confirmed')
  const [editActual, setEditActual] = useState('')
  const [editAdminNote, setEditAdminNote] = useState('')
  const [editReason, setEditReason] = useState('')

  useEffect(() => {
    if (!open || !row) return
    setView(initialView)
    setActualInput(String(row.amount ?? ''))
    setRejectReason('')
    setEditStatus(row.status === 'rejected' ? 'rejected' : 'confirmed')
    const a = displayActual(row)
    setEditActual(a != null ? String(a) : '')
    setEditAdminNote(row.admin_note ?? '')
    setEditReason('')
  }, [open, row?.id, initialView]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: history = [] } = useSettlementHistory(row?.id, open)

  if (!row) return null

  const sc = STATUS_CFG[row.status] ?? STATUS_CFG.pending
  const actualAmt = displayActual(row)
  const isPending = row.status === 'pending'
  const isFinal = row.status === 'confirmed' || row.status === 'rejected'

  function handleConfirm() {
    const amt = parseFloat(actualInput)
    onConfirm({ id: row.id, actualReceived: isNaN(amt) ? row.amount : amt })
  }
  function handleReject() {
    if (!rejectReason.trim()) return
    onReject({ id: row.id, reason: rejectReason })
  }
  const editRejectNoteMissing = editStatus === 'rejected' && !editAdminNote.trim() && !row.rejection_reason
  function handleEditSave() {
    if (editRejectNoteMissing) return
    const body = { id: row.id, status: editStatus }
    const amt = parseFloat(editActual)
    if (!isNaN(amt)) body.actual_received = amt
    if (editAdminNote.trim()) body.admin_note = editAdminNote.trim()
    if (editReason.trim()) body.reason = editReason.trim()
    onEdit(body, { onSaved: () => setView('detail') })
  }
  function resetAndClose() { setView('detail'); onClose() }

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title="Проверка передачи компании"
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
              {row.dispatcher_name?.charAt(0) ?? '?'}
            </div>
            <div>
              <p className="font-bold text-slate-900">{row.dispatcher_name}</p>
              <p className="text-xs text-slate-500">Получатель: Компания</p>
            </div>
            <Badge variant={sc.badge} className="ml-auto">{sc.label}</Badge>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-slate-50 rounded-xl">
              <p className="text-[11px] text-slate-400 mb-1">Ожидалось</p>
              <p className="text-lg font-black text-slate-700 tabular-nums">{fmt(row.amount)}</p>
              <p className="text-[10px] text-slate-400">c</p>
            </div>
            <div className="text-center p-3 bg-slate-50 rounded-xl">
              <p className="text-[11px] text-slate-400 mb-1">Отправил</p>
              <p className={`text-lg font-black tabular-nums ${actualAmt != null ? 'text-indigo-700' : 'text-slate-300'}`}>
                {actualAmt != null ? fmt(actualAmt) : '—'}
              </p>
              <p className="text-[10px] text-slate-400">c</p>
            </div>
            <div className="text-center p-3 bg-slate-50 rounded-xl">
              <p className="text-[11px] text-slate-400 mb-1">Разница</p>
              <p className="text-lg font-black tabular-nums"><DiffCell expected={row.amount} actual={actualAmt} /></p>
            </div>
          </div>

          {row.comment && (
            <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">Комментарий диспетчера: {row.comment}</p>
          )}
          {row.status === 'rejected' && row.rejection_reason && (
            <p className="text-sm text-rose-700 bg-rose-50 rounded-xl p-3">Причина отклонения: {row.rejection_reason}</p>
          )}

          {Array.isArray(row.media_assets) && row.media_assets.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <ImageIcon size={12} /> Квитанция
              </p>
              <div className="flex gap-2 flex-wrap">
                {row.media_assets.map((a) => (
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
          <p className="text-sm text-slate-500">Сколько фактически получено от {row.dispatcher_name}?</p>
          <input
            type="number" min="0" step="0.01" autoFocus
            value={actualInput} onChange={(e) => setActualInput(e.target.value)}
            className="input text-lg font-bold tabular-nums"
          />
        </div>
      )}

      {view === 'reject' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Причина отклонения заявки {row.dispatcher_name} на {fmt(row.amount)} c.</p>
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

export default function DispatcherSettlementsPanel() {
  const toast = useToast()
  const [range, setRange] = useState({ from: '', to: '' })
  const [dispatcherId, setDispatcherId] = useState('')
  const [modalRow, setModalRow] = useState(null)
  const [modalView, setModalView] = useState('detail')

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
  const editMutation = useEditSettlement()

  function openRow(row, view = 'detail') { setModalRow(row); setModalView(view) }

  return (
    <div className="space-y-4">
      {/* KPI boxes */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Долг курьеров" value={`${fmt(summary?.courier_debt)} с.`} icon={<AlertTriangle size={20} />} color="rose" loading={summaryLoading} />
        <KpiCard label="Диспетчер получил" value={`${fmt(summary?.received)} с.`} icon={<Coins size={20} />} color="sky" loading={summaryLoading} />
        <KpiCard label="Диспетчер сдал" value={`${fmt(summary?.paid)} с.`} icon={<Landmark size={20} />} color="emerald" loading={summaryLoading} />
        <KpiCard label="Долг диспетчера компании" value={`${fmt(summary?.dispatcher_debt)} с.`} icon={<Wallet size={20} />} color="amber" loading={summaryLoading} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <PeriodRangeFilter from={range.from} to={range.to} onChange={setRange} />
        <select className="input w-auto min-w-[200px]" value={dispatcherId} onChange={(e) => setDispatcherId(e.target.value)}>
          <option value="">Все диспетчеры</option>
          {(dispatchers ?? []).map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-slate-100">
                    {['Отправитель', 'Получатель', 'Дата', 'Ожидалось', 'Отправил', 'Разница', 'Текущий долг', 'Квитанция', 'Статус', 'Действия'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const st = STATUS_CFG[row.status] ?? STATUS_CFG.pending
                    const actualAmt = displayActual(row)
                    const isFinal = row.status === 'confirmed' || row.status === 'rejected'
                    return (
                      <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors cursor-pointer" onClick={() => openRow(row)}>
                        <td className="px-4 py-3 text-xs font-medium text-slate-800">{row.dispatcher_name}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">Компания</td>
                        <td className="px-4 py-3 text-[11px] text-slate-400 whitespace-nowrap">{fmtDate(row.created_at)}</td>
                        <td className="px-4 py-3 text-xs font-semibold tabular-nums">{fmt(row.amount)}</td>
                        <td className={`px-4 py-3 text-xs font-semibold tabular-nums ${actualAmt != null ? 'text-indigo-700' : 'text-slate-300'}`}>
                          {actualAmt != null ? fmt(actualAmt) : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs"><DiffCell expected={row.amount} actual={actualAmt} /></td>
                        <td className="px-4 py-3"><DebtCell amount={row.current_debt} /></td>
                        <td className="px-4 py-3">
                          <ReceiptThumb mediaAssets={row.media_assets} onClick={() => openRow(row)} />
                        </td>
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

          {/* Mobile cards */}
          <div className="lg:hidden space-y-3">
            {rows.map((row) => {
              const st = STATUS_CFG[row.status] ?? STATUS_CFG.pending
              const actualAmt = displayActual(row)
              const isFinal = row.status === 'confirmed' || row.status === 'rejected'
              return (
                <div key={row.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-2" onClick={() => openRow(row)}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{row.dispatcher_name} → Компания</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{fmtDate(row.created_at)}</p>
                    </div>
                    <Badge variant={st.badge} dot>{st.label}</Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-base font-bold text-slate-800">{fmt(row.amount)} с.</p>
                    <DiffCell expected={row.amount} actual={actualAmt} />
                    <DebtCell amount={row.current_debt} />
                  </div>
                  {row.status === 'rejected' && row.rejection_reason && (
                    <p className="text-xs text-rose-600">{row.rejection_reason}</p>
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
        confirming={confirmMutation.isPending}
        rejecting={rejectMutation.isPending}
        editing={editMutation.isPending}
        onConfirm={({ id, actualReceived }) => {
          confirmMutation.mutate({ id, actualReceived }, {
            onSuccess: () => { toast.success('Заявка принята'); setModalRow(null) },
            onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
          })
        }}
        onReject={({ id, reason }) => {
          rejectMutation.mutate({ id, reason }, {
            onSuccess: () => { toast.success('Заявка отклонена'); setModalRow(null) },
            onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
          })
        }}
        onEdit={(body, { onSaved }) => {
          editMutation.mutate(body, {
            onSuccess: () => { toast.success('Изменения сохранены'); onSaved?.() },
            onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
          })
        }}
      />
    </div>
  )
}
