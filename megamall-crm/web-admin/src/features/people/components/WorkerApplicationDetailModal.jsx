import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import Modal   from '../../../shared/components/Modal'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { approveWorkerApplication, rejectWorkerApplication, fetchWorkerApplication } from '../api'
import { CREATABLE_ROLES, ROLE_LABEL, DOCUMENT_TYPE_LABEL, fmtDate } from '../utils/peopleHelpers'

/**
 * WorkerApplicationDetailModal — review a single pending application.
 * The owner assigns the real system role here (never taken from the
 * applicant) before approving. Rejecting deletes the application outright —
 * there is no "rejected" archive, so it asks for a second confirmation.
 *
 * Props:
 *   application {object|null}  — ApplicationResponse, or null to stay closed
 *   onClose     {fn}
 */
export default function WorkerApplicationDetailModal({ application, onClose }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [role,          setRole]          = useState('seller')
  const [confirmReject, setConfirmReject] = useState(false)

  // Fetches the full detail (including documents with freshly-minted signed
  // URLs — see internal/onboarding.Service.GetDetail) — the list row alone
  // doesn't carry documents. staleTime 0: signed URLs expire quickly
  // (MediaConfig.SignedURLTTL), so every open should re-fetch, never reuse
  // a cached one.
  const { data: detail } = useQuery({
    queryKey: ['people', 'applications', application?.id],
    queryFn: () => fetchWorkerApplication(application.id),
    enabled: !!application,
    staleTime: 0,
  })

  // Invalidating the shared ['people'] prefix covers every employee-list
  // query key in use across the app — TeamsHub's useEmployees
  // (['people','employees',...]) and TeamDirectoryPage's useDirectory
  // (['people']) use different keys for the same data, so a narrower
  // invalidate would silently miss one of them.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['people'] })
  }

  const approve = useMutation({
    mutationFn: () => approveWorkerApplication(application.id, role),
    onSuccess: () => {
      toast.success('Заявка одобрена, сотрудник создан')
      invalidate()
      onClose()
    },
  })

  const reject = useMutation({
    mutationFn: () => rejectWorkerApplication(application.id),
    onSuccess: () => {
      toast.success('Заявка отклонена и удалена')
      invalidate()
      onClose()
    },
  })

  const busy  = approve.isPending || reject.isPending
  const error = approve.error ?? reject.error

  if (!application) return null
  const a = detail ?? application

  return (
    <Modal
      open={!!application}
      onClose={onClose}
      title="Заявка соискателя"
      description="Обязательные поля отмечены звёздочкой"
      size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Закрыть</Button>
        {confirmReject
          ? <Button variant="danger" onClick={() => reject.mutate()} loading={reject.isPending} disabled={approve.isPending}>Подтвердить удаление</Button>
          : <Button variant="danger" onClick={() => setConfirmReject(true)} disabled={busy}>Отклонить</Button>}
        <Button variant="primary" onClick={() => approve.mutate()} loading={approve.isPending} disabled={reject.isPending}>Одобрить</Button>
      </>}
    >
      {error && (
        <Alert variant="error">
          {error.response?.data?.error?.message ?? error.message}
        </Alert>
      )}
      {confirmReject && (
        <Alert variant="warning">
          Отклонённая заявка будет удалена без возможности восстановления.
        </Alert>
      )}

      <div className="space-y-3 text-sm mt-4">
        <Row label="Имя">{a.full_name}</Row>
        <Row label="Телефон">{a.phone}</Row>
        {a.email && <Row label="Email">{a.email}</Row>}
        {a.desired_position && <Row label="Желаемая должность">{a.desired_position}</Row>}
        {a.date_of_birth && <Row label="Дата рождения">{fmtDate(a.date_of_birth)}</Row>}
        {a.address && <Row label="Адрес">{a.address}</Row>}
        <Row label="Подано">{fmtDate(a.created_at)}</Row>

        {a.documents?.length > 0 && (
          <div className="pt-1">
            <p className="input-label mb-1.5">Документы</p>
            <div className="space-y-1.5">
              {a.documents.map(doc => (
                <a
                  key={doc.id}
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
                >
                  <FileText size={14} className="text-slate-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-medium text-slate-700 truncate">{doc.original_filename}</p>
                    <p className="text-[11px] text-slate-400">{DOCUMENT_TYPE_LABEL[doc.document_type] ?? 'Другое'}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2">
          <label className="input-label">Назначить роль *</label>
          <select value={role} onChange={e => setRole(e.target.value)} className="input mt-1" disabled={busy}>
            {CREATABLE_ROLES.map(r => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-900 font-medium text-right">{children}</span>
    </div>
  )
}
