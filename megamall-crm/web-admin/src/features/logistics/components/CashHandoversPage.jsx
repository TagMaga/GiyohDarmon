/**
 * CashHandoversPage — Owner Logistics → "Передачи" tab
 *
 * Features:
 *  • Date-filtered table with receipt thumbnails
 *  • Verification modal: full image + all details + confirm/reject actions
 *  • Reject requires admin_note (mandatory)
 *  • Post-decision "Изменить": corrects a confirmed/rejected handover, with
 *    the full edit history (who/when/what changed) shown in the modal
 */
import { useState, useEffect } from 'react'
import {
  CheckCircle2, XCircle, Trash2, Pencil, History,
  Image as ImageIcon, FileText, AlertTriangle, Eye,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useHandovers, useUpdateHandover, useDeleteHandover, useEditHandover, useHandoverHistory } from '../hooks/useHandovers'
import useLogisticsCouriers from '../hooks/useLogisticsCouriers'
import Badge   from '../../../shared/components/Badge'
import Modal   from '../../../shared/components/Modal'
import PeriodRangeFilter from '../../../shared/components/PeriodRangeFilter'

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtMoney = (n) =>
  n == null ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })

const fmtDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

const fmtDateShort = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

const STATUS_CFG = {
  pending:   { label: 'Ожидает',   badge: 'amber'   },
  confirmed: { label: 'Подтверждено', badge: 'emerald' },
  rejected:  { label: 'Отклонено', badge: 'rose'    },
  disputed:  { label: 'Спор',      badge: 'violet'  },
}

const ACTION_LABEL = {
  confirm: 'Подтверждение',
  reject:  'Отклонение',
  update:  'Обновление',
  edit:    'Изменение',
}

const statusLabel = (s) => STATUS_CFG[s]?.label ?? s ?? '—'

// Parse proof_url + attachments_json (legacy) + media_assets (centralized
// media pipeline — internal/courier.Service.ToHandoverResponse resolves
// these fresh, signed, on every read; see internal/courier/dto.go's
// HandoverResponse.MediaAssets doc comment) into one flat array of URL
// strings for display.
function parseAttachments(proofUrl, attachmentsJson, mediaAssets) {
  const out = []
  if (proofUrl) out.push(proofUrl)
  if (attachmentsJson) {
    try {
      const arr = JSON.parse(attachmentsJson)
      if (Array.isArray(arr)) {
        arr.forEach(u => { if (u && !out.includes(u)) out.push(u) })
      }
    } catch { /* ignore malformed */ }
  }
  if (Array.isArray(mediaAssets)) {
    mediaAssets.forEach(a => { if (a?.url && !out.includes(a.url)) out.push(a.url) })
  }
  return out
}

// Same shape/order as parseAttachments, but prefers each media asset's small
// thumb_url over its full-resolution url — legacy proof_url/attachments_json
// entries have no thumb variant, so they fall back to themselves. Table-row
// thumbnails should always use this, never the full url: a "Передачи кассы"
// page with 50 rows was front-loading 50 full-resolution receipt images just
// to paint 40x40 dots (see the 2026-07 slow-load report).
function parseThumbAttachments(proofUrl, attachmentsJson, mediaAssets) {
  const out = []
  if (proofUrl) out.push(proofUrl)
  if (attachmentsJson) {
    try {
      const arr = JSON.parse(attachmentsJson)
      if (Array.isArray(arr)) {
        arr.forEach(u => { if (u) out.push(u) })
      }
    } catch { /* ignore malformed */ }
  }
  if (Array.isArray(mediaAssets)) {
    mediaAssets.forEach(a => { if (a?.url) out.push(a.thumb_url || a.url) })
  }
  return out
}

function isImageUrl(url) {
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url)
}

// For confirmed handovers the owner always accepted the transfer, so fall back to
// total_to_return when the courier didn't explicitly set actual_returned.
const displayActual = (row) =>
  row.status === 'confirmed' ? (row.actual_returned ?? row.total_to_return) : row.actual_returned

// Difference amount rendering
function DiffCell({ expected, actual }) {
  if (actual == null) return <span className="text-slate-300">—</span>
  const diff = actual - expected
  const abs = Math.abs(diff)
  if (Math.abs(diff) < 0.01) {
    return <span className="text-emerald-600 font-semibold tabular-nums">= 0</span>
  }
  if (diff < 0) {
    return <span className="text-rose-600 font-semibold tabular-nums">−{fmtMoney(abs)}</span>
  }
  return <span className="text-amber-600 font-semibold tabular-nums">+{fmtMoney(abs)}</span>
}

// Courier's running all-time balance as of this handover (see backend
// ListHandovers' courier_debt_after doc comment) — carries forward
// regardless of whether this particular row had any new orders, so a
// zero-order settlement never reads as "debt reset to 0".
function DebtAfterCell({ amount }) {
  const owes = (amount ?? 0) > 0.01
  return (
    <span className={`inline-flex ${owes ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'} font-semibold tabular-nums px-2 py-0.5 rounded-full text-xs`}>
      {owes ? fmtMoney(amount) : '0'} c
    </span>
  )
}

// A handover with nothing new expected (no eligible orders that day) but a
// real amount sent is a debt repayment, not a delivery settlement — see
// internal/courier Service.SubmitHandover's zero-line-settlement doc
// comment. Flag it so "Ожидалось: 0 c" doesn't read as an anomaly.
function isDebtSettlement(row) {
  const actual = displayActual(row)
  return Math.abs(row.total_to_return) < 0.01 && actual != null && actual > 0.01
}

// Receipt thumbnail
function ReceiptThumb({ proofUrl, attachmentsJson, mediaAssets, onClick }) {
  const urls = parseAttachments(proofUrl, attachmentsJson, mediaAssets)
  if (urls.length === 0) {
    return <span className="text-slate-300 text-xs">—</span>
  }
  const first = urls[0]
  const firstThumb = parseThumbAttachments(proofUrl, attachmentsJson, mediaAssets)[0] ?? first
  if (isImageUrl(first)) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick?.() }}
        className="group relative w-10 h-10 rounded-lg overflow-hidden border border-slate-200 hover:border-indigo-400 transition-all flex-shrink-0"
        title="Просмотр квитанции"
      >
        <img src={firstThumb} alt="квитанция" loading="lazy" className="w-full h-full object-cover" />
        {urls.length > 1 && (
          <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[9px] px-1 rounded-tl">
            +{urls.length - 1}
          </span>
        )}
        <div className="absolute inset-0 bg-indigo-600/0 group-hover:bg-indigo-600/20 transition-all flex items-center justify-center">
          <Eye size={12} className="text-white opacity-0 group-hover:opacity-100 transition-all" />
        </div>
      </button>
    )
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 transition-all text-xs"
      title="Просмотр файлов"
    >
      <FileText size={12} />
      <span>{urls.length}</span>
    </button>
  )
}

// ── Verification modal ────────────────────────────────────────────────────────

function VerifyModal({ row, open, initialView = 'detail', onClose, onConfirm, onReject, onDelete, onEdit, updating, deleting, editing }) {
  const [actualInput, setActualInput] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [view, setView] = useState('detail') // 'detail' | 'confirm' | 'reject' | 'edit'
  const [imgIdx, setImgIdx] = useState(0)

  // Edit form (post-decision correction)
  const [editStatus, setEditStatus]       = useState('confirmed')
  const [editActual, setEditActual]       = useState('')
  const [editAdminNote, setEditAdminNote] = useState('')
  const [editReason, setEditReason]       = useState('')

  // Re-seed the modal every time it opens for a (possibly different) row —
  // including the requested starting view (row click → detail, pencil → edit).
  useEffect(() => {
    if (!open || !row) return
    setView(initialView)
    setImgIdx(0)
    setActualInput('')
    setRejectReason('')
    setEditStatus(row.status === 'rejected' ? 'rejected' : 'confirmed')
    const a = displayActual(row)
    setEditActual(a != null ? String(a) : '')
    setEditAdminNote(row.admin_note ?? '')
    setEditReason('')
  }, [open, row?.id, initialView]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: history = [] } = useHandoverHistory(row?.id, open)

  if (!row) return null

  const urls      = parseAttachments(row.proof_url, row.attachments_json, row.media_assets)
  const sc        = STATUS_CFG[row.status] ?? STATUS_CFG.pending
  const actualAmt = displayActual(row)
  const diff      = actualAmt != null ? actualAmt - row.total_to_return : null
  const isPending = row.status === 'pending' || row.status === 'disputed'
  const isFinal   = row.status === 'confirmed' || row.status === 'rejected'

  function handleConfirm() {
    const amt = parseFloat(actualInput) || row.actual_returned || row.total_to_return
    onConfirm({ id: row.id, status: 'confirmed', actual_returned: amt })
  }

  function handleReject() {
    if (!rejectReason.trim()) return
    onReject({ id: row.id, status: 'rejected', admin_note: rejectReason })
  }

  const editRejectNoteMissing = editStatus === 'rejected' && !editAdminNote.trim()

  function handleEditSave() {
    if (editRejectNoteMissing) return
    const body = { id: row.id, status: editStatus }
    const amt = parseFloat(editActual)
    if (!isNaN(amt)) body.actual_returned = amt
    if (editAdminNote.trim()) body.admin_note = editAdminNote.trim()
    if (editReason.trim()) body.reason = editReason.trim()
    onEdit(body)
  }

  function resetAndClose() {
    setView('detail')
    setActualInput('')
    setRejectReason('')
    onClose()
  }

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
              {isPending && (
                <button
                  onClick={() => setView('reject')}
                  className="btn btn-md bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200"
                >
                  <XCircle size={14} /> Отклонить
                </button>
              )}
              {isPending && row.status === 'pending' && (
                <button
                  onClick={() => onDelete(row.id)}
                  disabled={deleting}
                  className="btn btn-md bg-slate-100 text-slate-600 hover:bg-slate-200"
                >
                  <Trash2 size={14} /> Удалить
                </button>
              )}
              {isFinal && (
                <button
                  onClick={() => setView('edit')}
                  className="btn btn-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
                >
                  <Pencil size={14} /> Изменить
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={resetAndClose} className="btn btn-md btn-secondary">Закрыть</button>
              {isPending && (
                <button
                  onClick={() => setView('confirm')}
                  className="btn btn-md btn-primary"
                >
                  <CheckCircle2 size={14} /> Подтвердить
                </button>
              )}
            </div>
          </div>
        ) : view === 'confirm' ? (
          <>
            <button onClick={() => setView('detail')} className="btn btn-md btn-secondary">Назад</button>
            <button onClick={handleConfirm} disabled={updating} className="btn btn-md btn-primary">
              {updating ? 'Сохранение…' : '✓ Подтвердить получение'}
            </button>
          </>
        ) : view === 'edit' ? (
          <>
            <button onClick={() => setView('detail')} className="btn btn-md btn-secondary">Назад</button>
            <button
              onClick={handleEditSave}
              disabled={editRejectNoteMissing || editing}
              className="btn btn-md btn-primary disabled:opacity-40"
            >
              {editing ? 'Сохранение…' : 'Сохранить изменения'}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setView('detail')} className="btn btn-md btn-secondary">Назад</button>
            <button
              onClick={handleReject}
              disabled={!rejectReason.trim() || updating}
              className="btn btn-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40"
            >
              {updating ? 'Сохранение…' : 'Отклонить'}
            </button>
          </>
        )
      }
    >
      {/* ── Detail view ──────────────────────────────────────────────────── */}
      {view === 'detail' && (
        <div className="space-y-5">
          {/* Courier */}
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 font-black flex-shrink-0">
              {row.courier_name?.charAt(0) ?? '?'}
            </div>
            <div>
              <p className="font-bold text-slate-900">{row.courier_name}</p>
              {row.courier_phone && <p className="text-xs text-slate-500">{row.courier_phone}</p>}
            </div>
            <Badge variant={sc.badge} className="ml-auto">{sc.label}</Badge>
          </div>

          {/* Amounts */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-slate-50 rounded-xl">
              <p className="text-[11px] text-slate-400 mb-1">Ожидалось</p>
              <p className="text-lg font-black text-slate-700 tabular-nums">{fmtMoney(row.total_to_return)}</p>
              <p className="text-[10px] text-slate-400">c</p>
            </div>
            <div className="text-center p-3 bg-slate-50 rounded-xl">
              <p className="text-[11px] text-slate-400 mb-1">Отправил</p>
              <p className={`text-lg font-black tabular-nums ${actualAmt != null ? 'text-indigo-700' : 'text-slate-300'}`}>
                {actualAmt != null ? fmtMoney(actualAmt) : '—'}
              </p>
              <p className="text-[10px] text-slate-400">c</p>
            </div>
            <div className="text-center p-3 bg-slate-50 rounded-xl">
              <p className="text-[11px] text-slate-400 mb-1">Разница</p>
              <p className="text-lg font-black tabular-nums">
                {diff == null ? <span className="text-slate-300">—</span> : <DiffCell expected={row.total_to_return} actual={actualAmt} />}
              </p>
              <p className="text-[10px] text-slate-400">c</p>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex gap-2">
              <span className="text-slate-400 w-28 flex-shrink-0">Дата создания:</span>
              <span className="text-slate-700 font-medium">{fmtDate(row.created_at)}</span>
            </div>
            {row.confirmed_at && (
              <div className="flex gap-2">
                <span className="text-slate-400 w-28 flex-shrink-0">Подтверждено:</span>
                <span className="text-emerald-700 font-medium">{fmtDate(row.confirmed_at)}</span>
              </div>
            )}
          </div>

          {/* Notes */}
          {row.comment && (
            <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
              <p className="text-[11px] font-semibold text-indigo-600 mb-1">ПРИМЕЧАНИЕ КУРЬЕРА</p>
              <p className="text-sm text-indigo-900">{row.comment}</p>
            </div>
          )}
          {row.admin_note && (
            <div className="p-3 bg-rose-50 rounded-xl border border-rose-100">
              <p className="text-[11px] font-semibold text-rose-600 mb-1">ПРИЧИНА ОТКЛОНЕНИЯ</p>
              <p className="text-sm text-rose-900">{row.admin_note}</p>
            </div>
          )}

          {/* Attachments */}
          {urls.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Подтверждения ({urls.length})
              </p>
              {/* Image gallery */}
              {urls.filter(isImageUrl).length > 0 && (
                <div>
                  {/* Main image */}
                  <div className="relative rounded-2xl overflow-hidden bg-slate-100 mb-2" style={{ maxHeight: 320 }}>
                    <img
                      src={urls.filter(isImageUrl)[imgIdx] ?? urls.filter(isImageUrl)[0]}
                      alt={`Квитанция ${imgIdx + 1}`}
                      className="w-full object-contain"
                      style={{ maxHeight: 320 }}
                    />
                    <a
                      href={urls.filter(isImageUrl)[imgIdx] ?? urls.filter(isImageUrl)[0]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white text-xs px-2 py-1 rounded-lg transition-all"
                    >
                      Открыть ↗
                    </a>
                    {urls.filter(isImageUrl).length > 1 && (
                      <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                        {urls.filter(isImageUrl).map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setImgIdx(i)}
                            className={`w-2 h-2 rounded-full transition-all ${i === imgIdx ? 'bg-white scale-125' : 'bg-white/50'}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* File attachments */}
              {urls.filter(u => !isImageUrl(u)).map((u, i) => (
                <a
                  key={i}
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2 bg-slate-50 hover:bg-slate-100 rounded-xl transition-all text-sm text-slate-700 mb-1"
                >
                  <FileText size={14} className="text-slate-400 flex-shrink-0" />
                  <span className="truncate">{u.split('/').pop()}</span>
                  <span className="ml-auto text-xs text-indigo-600">Открыть →</span>
                </a>
              ))}
            </div>
          )}

          {urls.length === 0 && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl border border-amber-100">
              <AlertTriangle size={14} className="text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-800">Квитанция не приложена</p>
            </div>
          )}

          {/* Edit history — every confirm/reject decision and later correction */}
          {history.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <History size={12} /> История изменений ({history.length})
              </p>
              <div className="space-y-2">
                {history.map(e => (
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
                    {(e.old_actual_returned ?? null) !== (e.new_actual_returned ?? null) && (
                      <p className="text-slate-500">
                        Отправил: {e.old_actual_returned != null ? `${fmtMoney(e.old_actual_returned)} c` : '—'} →{' '}
                        <span className="font-medium text-slate-700">
                          {e.new_actual_returned != null ? `${fmtMoney(e.new_actual_returned)} c` : '—'}
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
          )}
        </div>
      )}

      {/* ── Edit view (post-decision correction) ─────────────────────────── */}
      {view === 'edit' && (
        <div className="space-y-4">
          <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-sm text-indigo-800">
            Исправление уже принятого решения по передаче от <strong>{row.courier_name}</strong>.
            Все изменения сохраняются в истории.
          </div>

          <div>
            <label className="input-label">Статус</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditStatus('confirmed')}
                className={`btn btn-md flex-1 border ${editStatus === 'confirmed'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                <CheckCircle2 size={14} /> Подтверждено
              </button>
              <button
                type="button"
                onClick={() => setEditStatus('rejected')}
                className={`btn btn-md flex-1 border ${editStatus === 'rejected'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                <XCircle size={14} /> Отклонено
              </button>
            </div>
          </div>

          <div>
            <label className="input-label">Фактически получено (c)</label>
            <input
              type="number"
              step="0.01"
              placeholder={String(row.total_to_return)}
              value={editActual}
              onChange={e => setEditActual(e.target.value)}
              className="input"
              autoFocus
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Ожидалось: {fmtMoney(row.total_to_return)} c
            </p>
          </div>

          <div>
            <label className="input-label">
              Примечание {editStatus === 'rejected' ? '(причина отклонения) *' : ''}
            </label>
            <textarea
              rows={2}
              className="input resize-none"
              placeholder="Примечание для курьера…"
              value={editAdminNote}
              onChange={e => setEditAdminNote(e.target.value)}
            />
            {editRejectNoteMissing && (
              <p className="text-xs text-rose-500 mt-1.5">Укажите причину отклонения</p>
            )}
          </div>

          <div>
            <label className="input-label">Причина изменения</label>
            <textarea
              rows={2}
              className="input resize-none"
              placeholder="Например: ошиблись в сумме при подтверждении…"
              value={editReason}
              onChange={e => setEditReason(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1.5">Будет сохранена в истории изменений</p>
          </div>
        </div>
      )}

      {/* ── Confirm view ─────────────────────────────────────────────────── */}
      {view === 'confirm' && (
        <div className="space-y-4">
          <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-800">
            Курьер <strong>{row.courier_name}</strong> утверждает, что перевёл&nbsp;
            <strong>{fmtMoney(row.actual_returned ?? row.total_to_return)} c</strong>.
            Проверьте свой кошелёк/банк и введите фактически полученную сумму.
          </div>
          <div>
            <label className="input-label">Фактически получено (c)</label>
            <input
              type="number"
              step="0.01"
              placeholder={String(row.actual_returned ?? row.total_to_return)}
              value={actualInput}
              onChange={e => setActualInput(e.target.value)}
              className="input"
              autoFocus
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Оставьте пустым чтобы принять сумму курьера ({fmtMoney(row.actual_returned ?? row.total_to_return)} c)
            </p>
          </div>
        </div>
      )}

      {/* ── Reject view ──────────────────────────────────────────────────── */}
      {view === 'reject' && (
        <div className="space-y-4">
          <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-sm text-rose-800">
            Укажите причину отклонения. Курьер получит это сообщение.
          </div>
          <div>
            <label className="input-label">Причина отклонения *</label>
            <textarea
              rows={3}
              className="input resize-none"
              placeholder="Например: сумма не поступила, скриншот не читаем..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              autoFocus
            />
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CashHandoversPage({ courierId } = {}) {
  // ── Filters ──
  const [fromDate, setFromDate]         = useState('')
  const [toDate, setToDate]             = useState('')
  const [page, setPage]                 = useState(1)

  const params = {
    limit: 50,
    page,
    ...(courierId ? { courier_id: courierId } : {}),
    ...(fromDate ? { from: fromDate } : {}),
    ...(toDate   ? { to:   toDate   } : {}),
  }

  const { data, isLoading } = useHandovers(params)
  const items = data?.items ?? []

  const { mutate: updateHandover, isPending: updating } = useUpdateHandover()
  const { mutate: deleteHandover, isPending: deleting } = useDeleteHandover()
  const { mutate: editHandover,   isPending: editingHandover } = useEditHandover()

  // ── Modals ──
  const [verifyRow, setVerifyRow]     = useState(null)
  const [verifyView, setVerifyView]   = useState('detail') // starting view: 'detail' | 'edit'
  const [deleteTarget, setDeleteTarget] = useState(null)

  function openVerify(row, view = 'detail') {
    setVerifyView(view)
    setVerifyRow(row)
  }

  function handleVerifyConfirm({ id, status, actual_returned }) {
    updateHandover({ id, status, actual_returned }, {
      onSuccess: () => setVerifyRow(null),
    })
  }

  function handleVerifyReject({ id, status, admin_note }) {
    updateHandover({ id, status, admin_note }, {
      onSuccess: () => setVerifyRow(null),
    })
  }

  function handleVerifyEdit(body) {
    editHandover(body, {
      onSuccess: () => setVerifyRow(null),
    })
  }

  function handleVerifyDelete(id) {
    deleteHandover(id, { onSuccess: () => setVerifyRow(null) })
  }

  function handleQuickReject(row) {
    const reason = prompt('Укажите причину отклонения:')
    if (!reason?.trim()) return
    updateHandover({ id: row.id, status: 'rejected', admin_note: reason })
  }

  function handleQuickConfirm(row) {
    const input = prompt('Сумма, которую передал курьер:', String(row.total_to_return))
    if (input == null) return
    const amt = parseFloat(input)
    if (isNaN(amt)) return
    updateHandover({ id: row.id, status: 'confirmed', actual_returned: amt })
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    deleteHandover(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
  }

  const meta = data?.meta

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Date range */}
        <PeriodRangeFilter
          from={fromDate}
          to={toDate}
          onChange={(range) => { setFromDate(range.from); setToDate(range.to); setPage(1) }}
          align="right"
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1,2,3,4].map(i => <div key={i} className="skeleton w-full h-14 rounded-xl" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <ImageIcon size={32} className="mx-auto text-slate-200 mb-3" />
            <p className="text-sm text-slate-400">Передач не найдено</p>
          </div>
        ) : (
          <>
            {/* ── Desktop table ── */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Курьер', 'Дата', 'Ожидалось', 'Отправил', 'Разница', 'Текущий долг', 'Тариф', 'Квитанция', 'Статус', 'Действия'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {items.map(row => {
                    const sc = STATUS_CFG[row.status] ?? STATUS_CFG.pending
                    const isPending = row.status === 'pending' || row.status === 'disputed'
                    return (
                      <tr
                        key={row.id}
                        onClick={() => openVerify(row)}
                        className={[
                          'hover:bg-slate-50/50 transition-colors cursor-pointer',
                          isPending ? 'border-l-2 border-l-amber-400' : '',
                        ].join(' ')}
                      >
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900 text-sm">{row.courier_name}</p>
                          {row.courier_phone && <p className="text-[11px] text-slate-400">{row.courier_phone}</p>}
                          {isDebtSettlement(row) && (
                            <span className="inline-flex mt-1 text-[10px] font-semibold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
                              Погашение долга
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                          {fmtDateShort(row.created_at)}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-700 font-medium text-xs">
                          {fmtMoney(row.total_to_return)} c
                        </td>
                        <td className="px-4 py-3 tabular-nums text-xs">
                          {(() => { const a = displayActual(row); return a != null
                            ? <span className="text-indigo-700 font-medium">{fmtMoney(a)} c</span>
                            : <span className="text-slate-300">—</span>
                          })()}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <DiffCell expected={row.total_to_return} actual={displayActual(row)} />
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <DebtAfterCell amount={row.courier_debt_after} />
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400 tabular-nums">
                          {fmtMoney(row.total_delivery_fees)} c
                        </td>
                        <td className="px-4 py-3">
                          <ReceiptThumb
                            proofUrl={row.proof_url}
                            attachmentsJson={row.attachments_json}
                            mediaAssets={row.media_assets}
                            onClick={() => openVerify(row)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={sc.badge}>{sc.label}</Badge>
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          {isPending && (
                            <div className="flex items-center gap-1">
                              <button
                                title="Подтвердить"
                                onClick={() => handleQuickConfirm(row)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-50 transition-colors"
                              >
                                <CheckCircle2 size={15} />
                              </button>
                              <button
                                title="Отклонить"
                                onClick={() => handleQuickReject(row)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-rose-500 hover:bg-rose-50 transition-colors"
                              >
                                <XCircle size={15} />
                              </button>
                            </div>
                          )}
                          {(row.status === 'confirmed' || row.status === 'rejected') && (
                            <button
                              title="Изменить (с историей)"
                              onClick={() => openVerify(row, 'edit')}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-indigo-500 hover:bg-indigo-50 transition-colors"
                            >
                              <Pencil size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Mobile cards ── */}
            <div className="md:hidden divide-y divide-slate-50">
              {items.map(row => {
                const sc = STATUS_CFG[row.status] ?? STATUS_CFG.pending
                const isPending = row.status === 'pending' || row.status === 'disputed'
                const urls = parseAttachments(row.proof_url, row.attachments_json, row.media_assets)
                return (
                  <div
                    key={row.id}
                    onClick={() => openVerify(row)}
                    className={`px-4 py-3 space-y-2 ${isPending ? 'border-l-2 border-l-amber-400' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">{row.courier_name}</p>
                        <p className="text-xs text-slate-400">{fmtDate(row.created_at)}</p>
                        {isDebtSettlement(row) && (
                          <span className="inline-flex mt-1 text-[10px] font-semibold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
                            Погашение долга
                          </span>
                        )}
                      </div>
                      <Badge variant={sc.badge} size="sm">{sc.label}</Badge>
                    </div>
                    <div className="flex gap-4 text-xs flex-wrap items-center">
                      <span className="text-slate-500">Ожидалось: <strong>{fmtMoney(row.total_to_return)} c</strong></span>
                      {(() => { const a = displayActual(row); return a != null && (
                        <span className="text-indigo-700">Отправил: <strong>{fmtMoney(a)} c</strong></span>
                      )})()}
                      <span className="text-slate-500 flex items-center gap-1">
                        Долг: <DebtAfterCell amount={row.courier_debt_after} />
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      {urls.length > 0 && (
                        <ReceiptThumb proofUrl={row.proof_url} attachmentsJson={row.attachments_json} mediaAssets={row.media_assets} />
                      )}
                      {isPending && (
                        <div className="flex gap-2 ml-auto">
                          <button onClick={e => { e.stopPropagation(); handleQuickConfirm(row) }}
                            className="btn btn-sm bg-emerald-50 text-emerald-700">
                            <CheckCircle2 size={13} /> Принять
                          </button>
                          <button onClick={e => { e.stopPropagation(); handleQuickReject(row) }}
                            className="btn btn-sm bg-rose-50 text-rose-600">
                            <XCircle size={13} /> Отклонить
                          </button>
                        </div>
                      )}
                      {(row.status === 'confirmed' || row.status === 'rejected') && (
                        <button onClick={e => { e.stopPropagation(); openVerify(row, 'edit') }}
                          className="btn btn-sm bg-indigo-50 text-indigo-600 ml-auto">
                          <Pencil size={13} /> Изменить
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Pagination */}
            {meta && meta.total_pages > 1 && (
              <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400">Стр. {page} из {meta.total_pages}</span>
                <div className="flex gap-1">
                  <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 transition-colors">
                    <ChevronLeft size={14} />
                  </button>
                  <button onClick={() => setPage(p => p + 1)} disabled={page >= meta.total_pages}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 transition-colors">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Verify modal */}
      <VerifyModal
        row={verifyRow}
        open={!!verifyRow}
        initialView={verifyView}
        onClose={() => setVerifyRow(null)}
        onConfirm={handleVerifyConfirm}
        onReject={handleVerifyReject}
        onDelete={handleVerifyDelete}
        onEdit={handleVerifyEdit}
        updating={updating}
        deleting={deleting}
        editing={editingHandover}
      />

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Удалить запись?"
        description="Это действие необратимо."
        size="sm"
        footer={
          <>
            <button onClick={() => setDeleteTarget(null)} className="btn btn-md btn-secondary">Отмена</button>
            <button onClick={handleDeleteConfirm} disabled={deleting} className="btn btn-md btn-danger">
              {deleting ? 'Удаление…' : 'Удалить'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Передача от <strong>{deleteTarget?.courier_name}</strong> ({fmtMoney(deleteTarget?.total_to_return)} c)
          от {fmtDate(deleteTarget?.created_at)} будет удалена.
        </p>
      </Modal>
    </div>
  )
}
