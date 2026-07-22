import { useState }                    from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import Modal   from '../../../shared/components/Modal'
import DateInput     from '../../../shared/components/DateInput'
import PasswordInput from '../../../shared/components/PasswordInput'
import PhoneInput    from '../../../shared/components/PhoneInput'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS }     from '../../../shared/queryKeys'
import { createEmployee } from '../api'
import { ALL_ROLES, ROLE_LABEL } from '../utils/peopleHelpers'

export default function CreateEmployeeModal({ open, onClose }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [phone,           setPhone]           = useState('')
  const [firstName,       setFirstName]       = useState('')
  const [lastName,        setLastName]        = useState('')
  const [role,            setRole]            = useState('seller')
  const [password,        setPassword]        = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [hireDate,        setHireDate]        = useState('')
  const [dob,             setDob]             = useState('')
  const [address,         setAddress]         = useState('')
  const [hireDateValid, setHireDateValid] = useState(true)
  const [dobValid,      setDobValid]      = useState(true)
  const [detailsOpen,   setDetailsOpen]   = useState(true)

  const passwordMismatch = passwordConfirm.length > 0 && password !== passwordConfirm

  function resetForm() {
    setPhone(''); setFirstName(''); setLastName(''); setPassword(''); setPasswordConfirm(''); setRole('seller')
    setHireDate(''); setDob(''); setAddress('')
    setHireDateValid(true); setDobValid(true); setDetailsOpen(true)
  }

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!phone.trim())     throw new Error('Телефон обязателен')
      if (!firstName.trim()) throw new Error('Имя обязательно')
      if (!lastName.trim())  throw new Error('Фамилия обязательна')
      if (password.length < 8) throw new Error('Пароль минимум 8 символов')
      if (password !== passwordConfirm) throw new Error('Пароли не совпадают')
      if (!hireDate)        throw new Error('Дата найма обязательна')
      if (!dob)             throw new Error('Дата рождения обязательна')
      if (!address.trim())  throw new Error('Адрес обязателен')
      return createEmployee({
        phone:         phone.trim(),
        full_name:     firstName.trim(),
        surname:       lastName.trim(),
        role,
        password,
        hire_date:     hireDate + 'T00:00:00Z',
        date_of_birth: dob      + 'T00:00:00Z',
        address:       address.trim(),
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

  const canSubmit = hireDateValid && dobValid && !passwordMismatch

  return (
    <Modal open={open} onClose={handleClose} title="Новый сотрудник" size="md"
      description="Обязательные поля отмечены звёздочкой"
      footer={<>
        <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
        <Button variant="primary" onClick={() => mutate()} loading={isPending} disabled={!canSubmit}>Создать</Button>
      </>}
    >
      {error && <Alert variant="error" className="mb-4">{error.response?.data?.error?.message ?? error.message}</Alert>}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="input-label">Имя *</label>
            <input value={firstName} onChange={e => setFirstName(e.target.value)} className="input mt-1" placeholder="Иван" />
          </div>
          <div><label className="input-label">Фамилия *</label>
            <input value={lastName} onChange={e => setLastName(e.target.value)} className="input mt-1" placeholder="Иванов" />
          </div>
        </div>
        <div><label className="input-label">Телефон *</label>
          <PhoneInput value={phone} onChange={setPhone} className="mt-1" />
        </div>
        <div><label className="input-label">Роль *</label>
          <select value={role} onChange={e => setRole(e.target.value)} className="input mt-1">
            {ALL_ROLES.map(r => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <div><label className="input-label">Пароль *</label>
          <PasswordInput value={password} onChange={e => setPassword(e.target.value)} className="input mt-1" placeholder="Минимум 8 символов" autoComplete="new-password" />
        </div>
        <div><label className="input-label">Повторите пароль *</label>
          <PasswordInput
            value={passwordConfirm}
            onChange={e => setPasswordConfirm(e.target.value)}
            className={`input mt-1 ${passwordMismatch ? 'border-red-400 focus:border-red-400 focus:ring-red-500/25' : ''}`}
            placeholder="Повторите пароль"
            autoComplete="new-password"
          />
          {passwordMismatch && <p className="mt-1 text-xs text-red-600">Пароли не совпадают</p>}
        </div>

        <button
          type="button"
          onClick={() => setDetailsOpen(o => !o)}
          className="flex items-center justify-between w-full px-3.5 py-3 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer"
        >
          <span className="text-[13px] font-semibold text-slate-600">Дополнительно *</span>
          <ChevronDown size={16} className={`text-slate-500 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
        </button>

        {detailsOpen && (
          <div className="space-y-4 px-0.5">
            <div className="grid grid-cols-2 gap-3">
              <DateInput label="Дата найма *" value={hireDate} onChange={setHireDate} onValidityChange={setHireDateValid} />
              <DateInput label="Дата рождения *" value={dob} onChange={setDob} onValidityChange={setDobValid} />
            </div>
            <div><label className="input-label">Адрес *</label>
              <input value={address} onChange={e => setAddress(e.target.value)} className="input mt-1" placeholder="г. Душанбе, ул. ..." />
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
