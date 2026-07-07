import { useState }                    from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import Modal   from '../../../shared/components/Modal'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS }     from '../../../shared/queryKeys'
import { createEmployee } from '../api'
import { ALL_ROLES, ROLE_LABEL } from '../utils/peopleHelpers'

export default function CreateEmployeeModal({ open, onClose }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [phone,       setPhone]       = useState('')
  const [fullName,    setFullName]    = useState('')
  const [email,       setEmail]       = useState('')
  const [role,        setRole]        = useState('seller')
  const [password,    setPassword]    = useState('')
  const [hireDate,    setHireDate]    = useState('')
  const [dob,         setDob]         = useState('')
  const [address,     setAddress]     = useState('')

  function resetForm() {
    setPhone(''); setFullName(''); setEmail(''); setPassword(''); setRole('seller')
    setHireDate(''); setDob(''); setAddress('')
  }

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!phone.trim())    throw new Error('Телефон обязателен')
      if (!fullName.trim()) throw new Error('Имя обязательно')
      if (password.length < 8) throw new Error('Пароль минимум 8 символов')
      return createEmployee({
        phone:         phone.trim(),
        full_name:     fullName.trim(),
        email:         email.trim() || undefined,
        role,
        password,
        hire_date:     hireDate ? hireDate + 'T00:00:00Z' : undefined,
        date_of_birth: dob      ? dob      + 'T00:00:00Z' : undefined,
        address:       address.trim() || undefined,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['people', 'employees'] })
      qc.invalidateQueries({ queryKey: ['people'] })
      toast.success('Сотрудник создан')
      reset(); resetForm(); onClose()
    },
  })

  function handleClose() {
    reset(); resetForm(); onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Новый сотрудник" size="md"
      footer={<>
        <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
        <Button variant="primary" onClick={() => mutate()} loading={isPending}>Создать</Button>
      </>}
    >
      {error && <Alert variant="error" className="mb-4">{error.response?.data?.error?.message ?? error.message}</Alert>}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><label className="input-label">Телефон *</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} className="input mt-1" placeholder="+996 700 000000" />
          </div>
          <div><label className="input-label">Полное имя *</label>
            <input value={fullName} onChange={e => setFullName(e.target.value)} className="input mt-1" placeholder="Иван Иванов" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="input-label">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input mt-1" placeholder="ivan@mail.ru" />
          </div>
          <div><label className="input-label">Роль *</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="input mt-1">
              {ALL_ROLES.filter(r => r !== 'owner').map(r => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>
        </div>
        <div><label className="input-label">Пароль *</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input mt-1" placeholder="Минимум 8 символов" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="input-label">Дата найма</label>
            <input type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} className="input mt-1" />
          </div>
          <div><label className="input-label">Дата рождения</label>
            <input type="date" value={dob} onChange={e => setDob(e.target.value)} className="input mt-1" />
          </div>
        </div>
        <div><label className="input-label">Адрес</label>
          <input value={address} onChange={e => setAddress(e.target.value)} className="input mt-1" placeholder="г. Душанбе, ул. ..." />
        </div>
      </div>
    </Modal>
  )
}
