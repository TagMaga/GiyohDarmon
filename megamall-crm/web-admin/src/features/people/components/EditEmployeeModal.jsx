import { useState, useEffect }          from 'react'
import { useMutation, useQueryClient }  from '@tanstack/react-query'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import Modal   from '../../../shared/components/Modal'
import { useToast } from '../../../shared/components/ToastProvider'
import { updateEmployee } from '../api'
import { ALL_ROLES, ROLE_LABEL, STATUS_OPTIONS } from '../utils/peopleHelpers'

const MIN_PASSWORD_LENGTH = 8

/**
 * EditEmployeeModal — the live "edit employee" flow, opened from
 * TeamDirectoryPage's DetailPanel. Edits core profile fields (name, phone,
 * role, status, active flag, hire/birth dates, address) and optionally
 * resets the employee's password — new_password rides along in the same
 * PATCH /users/:id request as an owner-only override, so the save is one
 * atomic request with no partial-failure state to reconcile.
 *
 * Avatar, documents, compensation, and history stay outside this modal —
 * they're managed by their own widgets on the detail page.
 */
export default function EditEmployeeModal({ open, onClose, person, onSaved }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [fullName,        setFullName]        = useState('')
  const [phone,           setPhone]           = useState('')
  const [role,            setRole]            = useState('seller')
  const [isActive,        setIsActive]        = useState(true)
  const [status,          setStatus]          = useState('offline')
  const [hireDate,        setHireDate]        = useState('')
  const [dob,             setDob]             = useState('')
  const [address,         setAddress]         = useState('')
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    if (!person || !open) return
    setFullName(person.full_name ?? '')
    setPhone(person.phone ?? '')
    setRole(person.role ?? 'seller')
    setIsActive(person.is_active !== false)
    setStatus(person.status ?? 'offline')
    setHireDate(person.hire_date ? person.hire_date.slice(0, 10) : '')
    setDob(person.date_of_birth ? person.date_of_birth.slice(0, 10) : '')
    setAddress(person.address ?? '')
    setNewPassword('')
    setConfirmPassword('')
  }, [person, open])

  const wantsPasswordChange = newPassword !== '' || confirmPassword !== ''
  const passwordInvalid = wantsPasswordChange && (
    !newPassword.trim() ||
    !confirmPassword.trim() ||
    newPassword.length < MIN_PASSWORD_LENGTH ||
    newPassword !== confirmPassword
  )
  const canSave = fullName.trim() !== '' && !passwordInvalid

  function patchCache(updated) {
    qc.setQueryData(['people'], (old) =>
      Array.isArray(old) ? old.map(u => u.id === updated.id ? updated : u) : old
    )
    qc.invalidateQueries({ queryKey: ['people'] })
    qc.invalidateQueries({ queryKey: ['user-history', person.id] })
    qc.invalidateQueries({ queryKey: ['users-history'] })
  }

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async () => {
      if (!fullName.trim()) throw new Error('Имя обязательно')
      if (wantsPasswordChange) {
        if (!newPassword.trim() || !confirmPassword.trim()) throw new Error('Заполните оба поля пароля')
        if (newPassword.length < MIN_PASSWORD_LENGTH) throw new Error(`Пароль минимум ${MIN_PASSWORD_LENGTH} символов`)
        if (newPassword !== confirmPassword) throw new Error('Пароли не совпадают')
      }

      return updateEmployee(person.id, {
        full_name:     fullName.trim(),
        phone:         phone.trim()   || undefined,
        role,
        is_active:     isActive,
        status,
        hire_date:     hireDate ? hireDate + 'T00:00:00Z' : undefined,
        date_of_birth: dob     ? dob + 'T00:00:00Z'     : undefined,
        address:       address.trim() || undefined,
        new_password:  wantsPasswordChange ? newPassword : undefined,
      })
    },
    onSuccess: (updated) => {
      patchCache(updated)
      toast.success(wantsPasswordChange ? 'Данные обновлены, пароль сброшен' : 'Данные обновлены')
      reset()
      setNewPassword(''); setConfirmPassword('')
      onSaved?.()
      onClose()
    },
  })

  if (!open || !person) return null

  const close = () => { reset(); onClose() }
  const roleLabel = ROLE_LABEL[person.role] ?? person.role

  return (
    <Modal
      open={open}
      onClose={close}
      title="Редактировать сотрудника"
      description={`${person.full_name} · ${roleLabel}`}
      size="xl"
      footer={<>
        <Button variant="secondary" onClick={close} disabled={isPending}>Отмена</Button>
        <Button variant="primary" onClick={() => mutate()} loading={isPending} disabled={!canSave}>Сохранить</Button>
      </>}
    >
      {error && <Alert variant="error" className="mb-4">{error.response?.data?.error?.message ?? error.message}</Alert>}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="input-label">Полное имя *</label>
            <input value={fullName} onChange={e => setFullName(e.target.value)} className="input" placeholder="Имя Фамилия" />
          </div>
          <div>
            <label className="input-label">Телефон</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} className="input" placeholder="+992 93 000 00 00" />
          </div>
        </div>

        <div>
          <label className="input-label">Должность *</label>
          <select value={role} onChange={e => setRole(e.target.value)} className="input">
            {ALL_ROLES.map(r => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="input-label">Дата найма</label>
            <input type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="input-label">Дата рождения</label>
            <input type="date" value={dob} onChange={e => setDob(e.target.value)} className="input" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <div>
            <label className="input-label">Статус</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className="input">
              {STATUS_OPTIONS.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 rounded accent-indigo-600" />
            <span className="text-sm text-slate-700">Активный сотрудник</span>
          </label>
        </div>

        <div>
          <label className="input-label">Адрес</label>
          <input value={address} onChange={e => setAddress(e.target.value)} className="input" placeholder="г. Душанбе, ул. ..." />
        </div>

        <div className="border-t border-slate-100 pt-4">
          <p className="input-label mb-2">Сброс пароля</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="input-label">Новый пароль</label>
              <input
                type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                className="input" placeholder="Оставьте пустым, чтобы не менять"
              />
            </div>
            <div>
              <label className="input-label">Повторите пароль</label>
              <input
                type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                className="input" placeholder="Оставьте пустым, чтобы не менять"
              />
            </div>
          </div>
          {wantsPasswordChange && passwordInvalid && (
            <p className="mt-2 text-xs text-red-600">
              {!newPassword.trim() || !confirmPassword.trim()
                ? 'Заполните оба поля пароля'
                : newPassword.length < MIN_PASSWORD_LENGTH
                  ? `Пароль минимум ${MIN_PASSWORD_LENGTH} символов`
                  : 'Пароли не совпадают'}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
