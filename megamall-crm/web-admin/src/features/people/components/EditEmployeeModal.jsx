import { useState, useEffect }          from 'react'
import { useMutation, useQueryClient }  from '@tanstack/react-query'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import Modal   from '../../../shared/components/Modal'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS }     from '../../../shared/queryKeys'
import { updateEmployee } from '../api'
import { ALL_ROLES, ROLE_LABEL } from '../utils/peopleHelpers'

export default function EditEmployeeModal({ open, onClose, user }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [fullName, setFullName] = useState('')
  const [role,     setRole]     = useState('seller')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    if (user) {
      setFullName(user.full_name ?? user.FullName ?? '')
      setRole(user.role ?? user.Role ?? 'seller')
      setIsActive(user.is_active !== false)
    }
  }, [user])

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!fullName.trim()) throw new Error('Имя обязательно')
      return updateEmployee(user.id, {
        full_name: fullName.trim(),
        role,
        is_active: isActive,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.people.employee(user.id) })
      qc.invalidateQueries({ queryKey: ['people', 'employees'] })
      toast.success('Данные обновлены')
      reset(); onClose()
    },
  })

  if (!user) return null

  return (
    <Modal open={open} onClose={onClose} title="Редактировать сотрудника" size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={isPending}>Отмена</Button>
        <Button variant="primary" onClick={() => mutate()} loading={isPending}>Сохранить</Button>
      </>}
    >
      {error && <Alert variant="error" className="mb-4">{error.response?.data?.error?.message ?? error.message}</Alert>}
      <div className="space-y-4">
        <div><label className="input-label">Полное имя *</label>
          <input value={fullName} onChange={e => setFullName(e.target.value)} className="input mt-1" />
        </div>
        <div><label className="input-label">Роль *</label>
          <select value={role} onChange={e => setRole(e.target.value)} className="input mt-1">
            {ALL_ROLES.map(r => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 rounded accent-indigo-600" />
          <span className="text-sm text-slate-700">Активен</span>
        </label>
      </div>
    </Modal>
  )
}
