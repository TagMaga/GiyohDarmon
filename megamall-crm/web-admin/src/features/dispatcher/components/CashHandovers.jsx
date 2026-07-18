import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wallet, ChevronDown, ChevronUp, FileText, Eye } from 'lucide-react'
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

// Merge legacy proof_url + attachments_json with the centralized media
// pipeline's resolved media_assets (see internal/courier.Service.
// ToHandoverResponse) into one flat list of proof-image URLs — mirrors
// features/logistics/components/CashHandoversPage.jsx's parseAttachments.
function parseHandoverProofUrls(h) {
  const out = []
  if (h.proof_url) out.push(h.proof_url)
  if (h.attachments_json) {
    try {
      const arr = JSON.parse(h.attachments_json)
      if (Array.isArray(arr)) arr.forEach(u => { if (u && !out.includes(u)) out.push(u) })
    } catch { /* ignore malformed */ }
  }
  if (Array.isArray(h.media_assets)) {
    h.media_assets.forEach(a => { if (a?.url && !out.includes(a.url)) out.push(a.url) })
  }
  return out
}

// (\?|$) — not just $ — since a media-pipeline signed URL has a query
// string after the extension (/media/private/<key>.webp?sig=...).
function isImageUrl(url) {
  return /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(url ?? '')
}

// ── Proof viewer modal ──────────────────────────────────────────────────────
function ProofViewerModal({ open, onClose, urls }) {
  const [idx, setIdx] = useState(0)
  const images = urls.filter(isImageUrl)
  const files  = urls.filter(u => !isImageUrl(u))

  function handleClose() { setIdx(0); onClose() }

  return (
    <Modal open={open} onClose={handleClose} title="Подтверждение сдачи" size="lg">
      {images.length > 0 && (
        <div className="relative rounded-2xl overflow-hidden bg-slate-100 mb-3" style={{ maxHeight: 360 }}>
          <img
            src={images[idx] ?? images[0]}
            alt={`Квитанция ${idx + 1}`}
            className="w-full object-contain"
            style={{ maxHeight: 360 }}
          />
          <a
            href={images[idx] ?? images[0]}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white text-xs px-2 py-1 rounded-lg transition-all"
          >
            Открыть ↗
          </a>
          {images.length > 1 && (
            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
              {images.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  className={`w-2 h-2 rounded-full transition-all ${i === idx ? 'bg-white scale-125' : 'bg-white/50'}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {files.map((u, i) => (
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
      {urls.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-6">Подтверждение не приложено</p>
      )}
    </Modal>
  )
}

// Receipt thumbnail button
function ReceiptThumb({ urls, onClick }) {
  if (urls.length === 0) return <span className="text-slate-300 text-xs">—</span>
  const first = urls[0]
  if (isImageUrl(first)) {
    return (
      <button
        onClick={onClick}
        className="group relative w-10 h-10 rounded-lg overflow-hidden border border-slate-200 hover:border-indigo-400 transition-all flex-shrink-0"
        title="Просмотр подтверждения"
      >
        <img src={first} alt="подтверждение" className="w-full h-full object-cover" />
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
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 transition-all text-xs"
      title="Просмотр файлов"
    >
      <FileText size={12} />
      <span>{urls.length}</span>
    </button>
  )
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
  const [proofTarget,   setProofTarget]   = useState(null)

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
                {['Курьер', 'Собрано', 'К сдаче', 'Сдано факт.', 'Квитанция', 'Статус', 'Создан', 'Действия'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isPending && Array.from({ length: 3 }).map((_, i) => (
                <TableRowSkeleton key={i} cols={8} />
              ))}
              {!isPending && handovers.length === 0 && (
                <tr>
                  <td colSpan={8}>
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
                const proofUrls = parseHandoverProofUrls(h)
                return (
                  <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 text-xs font-medium text-slate-800">{courier}</td>
                    <td className="px-4 py-3 text-xs">{fmt(h.total_collected)}</td>
                    <td className="px-4 py-3 text-xs font-semibold">{fmt(h.total_to_return)}</td>
                    <td className="px-4 py-3 text-xs">{h.actual_returned != null ? fmt(h.actual_returned) : '—'}</td>
                    <td className="px-4 py-3">
                      <ReceiptThumb urls={proofUrls} onClick={() => setProofTarget(h)} />
                    </td>
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
          const proofUrls = parseHandoverProofUrls(h)

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
                <div className="pt-1 border-t border-slate-100 text-xs space-y-2 text-slate-600">
                  <p>Собрано: <span className="font-medium">{fmt(h.total_collected)}</span></p>
                  <p>Доставок: <span className="font-medium">{fmt(h.total_delivery_fees)}</span></p>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Квитанция:</span>
                    <ReceiptThumb urls={proofUrls} onClick={() => setProofTarget(h)} />
                  </div>
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
      <ProofViewerModal
        open={!!proofTarget}
        onClose={() => setProofTarget(null)}
        urls={proofTarget ? parseHandoverProofUrls(proofTarget) : []}
      />
    </>
  )
}
