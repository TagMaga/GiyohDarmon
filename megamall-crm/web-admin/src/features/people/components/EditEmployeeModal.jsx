import { useState, useEffect }          from 'react'
import { useMutation, useQueryClient }  from '@tanstack/react-query'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import Modal   from '../../../shared/components/Modal'
import DateInput     from '../../../shared/components/DateInput'
import PasswordInput from '../../../shared/components/PasswordInput'
import PhoneInput    from '../../../shared/components/PhoneInput'
import { useToast } from '../../../shared/components/ToastProvider'
import { updateEmployee } from '../api'
import { CREATABLE_ROLES, ROLE_LABEL, STATUS_OPTIONS, composeAddress, parseAddress } from '../utils/peopleHelpers'

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

  const [firstName,       setFirstName]       = useState('')
  const [lastName,        setLastName]        = useState('')
  const [phone,           setPhone]           = useState('')
  const [role,            setRole]            = useState('seller')
  const [position,        setPosition]        = useState('')
  const [isActive,        setIsActive]        = useState(true)
  const [status,          setStatus]          = useState('offline')
  const [hireDate,        setHireDate]        = useState('')
  const [dob,             setDob]             = useState('')
  const [city,            setCity]            = useState('')
  const [region,          setRegion]          = useState('')
  const [street,          setStreet]          = useState('')
  const [house,           setHouse]           = useState('')
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [hireDateValid,   setHireDateValid]   = useState(true)
  const [dobValid,        setDobValid]        = useState(true)

  useEffect(() => {
    if (!person || !open) return
    // full_name is the combined display name ("Иван Иванов"); surname is
    // the real, separately-editable value. Strip surname's exact suffix
    // off full_name to recover the given name. Older records saved before
    // surname existed have no surname yet — fall back to splitting
    // full_name on the first space for those.
    const fullName = (person.full_name ?? '').trim()
    const surname  = (person.surname ?? '').trim()
    if (surname && fullName.endsWith(surname)) {
      setFirstName(fullName.slice(0, fullName.length - surname.length).trim())
      setLastName(surname)
    } else if (surname) {
      setFirstName(fullName)
      setLastName(surname)
    } else {
      const [first, ...rest] = fullName.split(/\s+/)
      setFirstName(first ?? '')
      setLastName(rest.join(' '))
    }
    setPhone(person.phone ?? '')
    setRole(person.role ?? 'seller')
    setPosition(person.position ?? '')
    setIsActive(person.is_active !== false)
    setStatus(person.status ?? 'offline')
    setHireDate(person.hire_date ? person.hire_date.slice(0, 10) : '')
    setDob(person.date_of_birth ? person.date_of_birth.slice(0, 10) : '')
    const addr = parseAddress(person.address)
    setCity(addr.city); setRegion(addr.region); setStreet(addr.street); setHouse(addr.house)
    setNewPassword('')
    setConfirmPassword('')
    setHireDateValid(true)
    setDobValid(true)
  }, [person, open])

  const wantsPasswordChange = newPassword !== '' || confirmPassword !== ''
  const passwordInvalid = wantsPasswordChange && (
    !newPassword.trim() ||
    !confirmPassword.trim() ||
    newPassword.length < MIN_PASSWORD_LENGTH ||
    newPassword !== confirmPassword
  )
  const canSave = firstName.trim() !== '' && lastName.trim() !== '' && !passwordInvalid && hireDateValid && dobValid

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
      if (!firstName.trim()) throw new Error('Имя обязательно')
      if (!lastName.trim())  throw new Error('Фамилия обязательна')
      if (wantsPasswordChange) {
        if (!newPassword.trim() || !confirmPassword.trim()) throw new Error('Заполните оба поля пароля')
        if (newPassword.length < MIN_PASSWORD_LENGTH) throw new Error(`Пароль минимум ${MIN_PASSWORD_LENGTH} символов`)
        if (newPassword !== confirmPassword) throw new Error('Пароли не совпадают')
      }

      return updateEmployee(person.id, {
        full_name:     `${firstName.trim()} ${lastName.trim()}`.trim(),
        surname:       lastName.trim(),
        position:      position.trim() || null,
        phone:         phone.trim()   || undefined,
        role,
        is_active:     isActive,
        status,
        hire_date:     hireDate ? hireDate + 'T00:00:00Z' : undefined,
        date_of_birth: dob     ? dob + 'T00:00:00Z'     : undefined,
        address:       composeAddress({ city, region, street, house }) || undefined,
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
  // Owner accounts aren't reassignable through this form — the dropdown
  // only ever offers the roles it can actually set someone TO.
  const isOwner = person.role === 'owner'

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
            <label className="input-label">Имя *</label>
            <input value={firstName} onChange={e => setFirstName(e.target.value)} className="input" placeholder="Иван" />
          </div>
          <div>
            <label className="input-label">Фамилия *</label>
            <input value={lastName} onChange={e => setLastName(e.target.value)} className="input" placeholder="Иванов" />
          </div>
        </div>

        <div>
          <label className="input-label">Телефон</label>
          <PhoneInput value={phone} onChange={setPhone} />
        </div>

        <div>
          <label className="input-label">Роль *</label>
          <select value={role} onChange={e => setRole(e.target.value)} className="input" disabled={isOwner}>
            {isOwner
              ? <option value="owner">{ROLE_LABEL.owner}</option>
              : CREATABLE_ROLES.map(r => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
          </select>
          {isOwner && <p className="mt-1 text-xs text-slate-500">Роль владельца нельзя изменить через эту форму</p>}
        </div>

        <div>
          <label className="input-label">Должность</label>
          <input value={position} onChange={e => setPosition(e.target.value)} className="input" placeholder="Например, Менеджер по продажам" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DateInput label="Дата найма" value={hireDate} onChange={setHireDate} onValidityChange={setHireDateValid} />
          <DateInput label="Дата рождения" value={dob} onChange={setDob} onValidityChange={setDobValid} />
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="input-label">Город</label>
            <input value={city} onChange={e => setCity(e.target.value)} className="input" placeholder="Душанбе" />
          </div>
          <div>
            <label className="input-label">Район</label>
            <input value={region} onChange={e => setRegion(e.target.value)} className="input" placeholder="Сино" />
          </div>
        </div>
        <div className="grid grid-cols-[1fr_96px] gap-4">
          <div>
            <label className="input-label">Улица</label>
            <input value={street} onChange={e => setStreet(e.target.value)} className="input" placeholder="Рудаки" />
          </div>
          <div>
            <label className="input-label">Дом</label>
            <input value={house} onChange={e => setHouse(e.target.value)} className="input" placeholder="12" />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <p className="input-label mb-2">Сброс пароля</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="input-label">Новый пароль</label>
              <PasswordInput
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
                className="input" placeholder="Оставьте пустым, чтобы не менять" autoComplete="new-password"
              />
            </div>
            <div>
              <label className="input-label">Повторите пароль</label>
              <PasswordInput
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                className="input" placeholder="Оставьте пустым, чтобы не менять" autoComplete="new-password"
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
