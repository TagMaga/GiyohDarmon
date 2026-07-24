import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal   from '../../../shared/components/Modal'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { approveWorkerApplication, rejectWorkerApplication } from '../api'
import { CREATABLE_ROLES, ROLE_LABEL, fmtDate } from '../utils/peopleHelpers'

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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['people', 'applications'] })
    qc.invalidateQueries({ queryKey: ['people', 'employees'] })
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
  const a = application

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
