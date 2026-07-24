import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { ShoppingBag, AlertCircle, CheckCircle2, Loader2, ChevronDown } from 'lucide-react'
import DateInput      from '../../../shared/components/DateInput'
import PasswordInput  from '../../../shared/components/PasswordInput'
import PhoneInput     from '../../../shared/components/PhoneInput'
import { composeAddress, CREATABLE_ROLES, ROLE_LABEL } from '../../people/utils/peopleHelpers'
import { submitWorkerApplication } from '../api'

/**
 * WorkerApplicationPage — public, unauthenticated onboarding form at /new
 * (giyohdarmon.tj/new). Mirrors the fields HR collects when creating an
 * employee (CreateEmployeeModal), minus the system role — that's assigned
 * by an owner at approval time, never self-selected here — plus the
 * password the applicant sets for their eventual login.
 */
export default function WorkerApplicationPage() {
  const [firstName,       setFirstName]       = useState('')
  const [lastName,        setLastName]        = useState('')
  const [phone,           setPhone]           = useState('')
  const [desiredPosition, setDesiredPosition] = useState(CREATABLE_ROLES[0])
  const [password,        setPassword]        = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [dob,             setDob]             = useState('')
  const [city,            setCity]            = useState('')
  const [region,          setRegion]          = useState('')
  const [street,          setStreet]          = useState('')
  const [house,           setHouse]           = useState('')
  const [dobValid,      setDobValid]      = useState(true)
  const [detailsOpen,   setDetailsOpen]   = useState(true)

  const passwordMismatch = passwordConfirm.length > 0 && password !== passwordConfirm

  const { mutate, isPending, isSuccess, error } = useMutation({
    mutationFn: () => {
      if (!firstName.trim()) throw new Error('Имя обязательно')
      if (!lastName.trim())  throw new Error('Фамилия обязательна')
      if (!phone.trim())     throw new Error('Телефон обязателен')
      if (password.length < 8) throw new Error('Пароль минимум 8 символов')
      if (password !== passwordConfirm) throw new Error('Пароли не совпадают')
      if (!dob)             throw new Error('Дата рождения обязательна')
      if (!city.trim())     throw new Error('Город обязателен')
      if (!street.trim())   throw new Error('Улица обязательна')
      return submitWorkerApplication({
        phone:            phone.trim(),
        password,
        full_name:        `${firstName.trim()} ${lastName.trim()}`,
        surname:          lastName.trim(),
        desired_position: ROLE_LABEL[desiredPosition] ?? null,
        date_of_birth:    dob + 'T00:00:00Z',
        address:          composeAddress({ city, region, street, house }),
      })
    },
  })

  const canSubmit = dobValid && !passwordMismatch

  if (isSuccess) {
    return (
      <PageShell>
        <div className="card p-7 text-center animate-fade-in">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={26} className="text-emerald-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Заявка отправлена</h2>
          <p className="text-sm text-slate-500 leading-relaxed mb-1">
            Спасибо! Мы рассмотрим вашу заявку в ближайшее время.
          </p>
          <p className="text-sm text-slate-500 leading-relaxed">
            После одобрения вы сможете войти по номеру телефона и паролю,
            указанным в этой форме, на странице{' '}
            <Link to="/login" className="text-indigo-600 font-semibold hover:underline">входа</Link>.
          </p>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="card p-7">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Анкета соискателя</h2>
        <p className="text-sm text-slate-500 mb-6">Заполните форму — мы свяжемся с вами после проверки</p>

        {error && (
          <div
            className="flex items-start gap-2.5 p-3.5 mb-5 animate-fade-in"
            style={{
              background: 'linear-gradient(135deg, #FFF1F2 0%, #FFE4E6 100%)',
              borderRadius: '14px',
              border: '1px solid rgba(252, 165, 165, 0.4)',
            }}
          >
            <AlertCircle size={15} className="text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-[13px] text-red-700 leading-snug">
              {error.response?.data?.error?.message ?? error.message}
            </p>
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); mutate() }} noValidate className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="input-label">Имя *</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} className="input mt-1" placeholder="Иван" />
            </div>
            <div><label className="input-label">Фамилия *</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} className="input mt-1" placeholder="Иванов" />
            </div>
          </div>

          <div><label className="input-label">Номер телефона *</label>
            <PhoneInput value={phone} onChange={setPhone} className="mt-1" />
          </div>

          <div><label className="input-label">Желаемая должность *</label>
            <select value={desiredPosition} onChange={e => setDesiredPosition(e.target.value)} className="input mt-1">
              {CREATABLE_ROLES.map(r => (
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
              <DateInput label="Дата рождения *" value={dob} onChange={setDob} onValidityChange={setDobValid} />
              <div className="grid grid-cols-2 gap-3">
                <div><label className="input-label">Город *</label>
                  <input value={city} onChange={e => setCity(e.target.value)} className="input mt-1" placeholder="Душанбе" />
                </div>
                <div><label className="input-label">Район</label>
                  <input value={region} onChange={e => setRegion(e.target.value)} className="input mt-1" placeholder="Сино" />
                </div>
              </div>
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <div><label className="input-label">Улица *</label>
                  <input value={street} onChange={e => setStreet(e.target.value)} className="input mt-1" placeholder="Рудаки" />
                </div>
                <div><label className="input-label">Дом</label>
                  <input value={house} onChange={e => setHouse(e.target.value)} className="input mt-1" placeholder="12" />
                </div>
              </div>
            </div>
          )}

          <button type="submit" disabled={isPending || !canSubmit} className="btn-lg btn-primary w-full">
            {isPending
              ? <><Loader2 size={16} className="animate-spin" /> Отправка…</>
              : 'Отправить заявку'}
          </button>
        </form>
      </div>

      <p className="text-center text-[13px] text-slate-500 mt-5">
        Уже одобрены? <Link to="/login" className="text-indigo-600 font-semibold hover:underline">Войти в систему</Link>
      </p>
    </PageShell>
  )
}

function PageShell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10"
         style={{
           background: '#F2F4F7',
           backgroundImage: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99,102,241,0.10) 0%, transparent 100%)',
         }}>
      <div className="w-full max-w-[440px] animate-fade-in">
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-4"
            style={{
              background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
              boxShadow: '0 8px 24px rgba(79, 70, 229, 0.30)',
            }}
          >
            <ShoppingBag size={24} className="text-white" />
          </div>
          <h1 className="text-[26px] font-bold text-slate-900 tracking-tight">MegaMall CRM</h1>
          <p className="text-[14px] text-slate-500 mt-1">Анкета нового сотрудника</p>
        </div>
        {children}
      </div>
    </div>
  )
}
