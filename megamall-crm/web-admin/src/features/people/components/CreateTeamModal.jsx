import { useState }                    from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import Modal   from '../../../shared/components/Modal'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS }     from '../../../shared/queryKeys'
import { createTeam } from '../api'

/**
 * CreateTeamModal — POST /teams
 *
 * Props:
 *   open    {bool}
 *   onClose {function}
 *   users   {Array}   all employees (to pick lead / manager from)
 */
export default function CreateTeamModal({ open, onClose, users = [] }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [name,       setName]       = useState('')
  const [teamLeadId, setTeamLeadId] = useState('')
  const [managerId,  setManagerId]  = useState('')

  const leads    = users.filter(u => ['sales_team_lead'].includes(u.role ?? u.Role ?? ''))
  const managers = users.filter(u => ['manager'].includes(u.role ?? u.Role ?? ''))

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error('Название команды обязательно')
      return createTeam({
        name:         name.trim(),
        team_lead_id: teamLeadId || undefined,
        manager_id:   managerId  || undefined,
      })
    },
    onSuccess: () => {
      // Invalidate both the teams list and the KPI counts
      qc.invalidateQueries({ queryKey: ['people', 'teams'] })
      qc.invalidateQueries({ queryKey: ['people'] })
      toast.success('Команда создана')
      reset()
      setName(''); setTeamLeadId(''); setManagerId('')
      onClose()
    },
  })

  const handleClose = () => {
    reset()
    setName(''); setTeamLeadId(''); setManagerId('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Создать команду"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            Отмена
          </Button>
          <Button variant="primary" onClick={() => mutate()} loading={isPending}>
            Создать
          </Button>
        </>
      }
    >
      {error && (
        <Alert variant="error" className="mb-4">
          {error.response?.data?.error?.message ?? error.message}
        </Alert>
      )}

      <div className="space-y-4">
        <div>
          <label className="input-label">Название команды *</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="input mt-1"
            placeholder="Команда A"
            autoFocus
          />
        </div>

        <div>
          <label className="input-label">Руководитель группы</label>
          <select
            value={teamLeadId}
            onChange={e => setTeamLeadId(e.target.value)}
            className="input mt-1"
          >
            <option value="">Без руководителя</option>
            {leads.map(u => (
              <option key={u.id} value={u.id}>{u.full_name ?? u.FullName}</option>
            ))}
          </select>
          {leads.length === 0 && (
            <p className="text-xs text-slate-400 mt-1">
              Нет пользователей с ролью «Руководитель группы»
            </p>
          )}
        </div>

        <div>
          <label className="input-label">Менеджер</label>
          <select
            value={managerId}
            onChange={e => setManagerId(e.target.value)}
            className="input mt-1"
          >
            <option value="">Без менеджера</option>
            {managers.map(u => (
              <option key={u.id} value={u.id}>{u.full_name ?? u.FullName}</option>
            ))}
          </select>
          {managers.length === 0 && (
            <p className="text-xs text-slate-400 mt-1">
              Нет пользователей с ролью «Менеджер»
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
