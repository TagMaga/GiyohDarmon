import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import Alert from '../../../shared/components/Alert'
import PasswordInput from '../../../shared/components/PasswordInput'
import Button from '../../../shared/components/Button'
import useProfile from '../../../shared/hooks/useProfile'
import { useToast } from '../../../shared/components/ToastProvider'
import { useMutation } from '@tanstack/react-query'
import { changePassword } from '../../seller/api'

export default function WarehouseChangePasswordPage() {
  const navigate = useNavigate()
  const { userId } = useProfile()
  const toast = useToast()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState('')

  const { mutate: savePassword, isPending } = useMutation({
    mutationFn: () => changePassword(userId, { current_password: currentPassword, new_password: newPassword }),
    onSuccess: () => {
      toast.success('Пароль изменён')
      navigate('/warehouse/profile')
    },
    onError: (err) => setPwError(err?.response?.data?.error?.message ?? err?.message ?? 'Не удалось изменить пароль'),
  })

  function handleSubmit() {
    setPwError('')
    if (newPassword.length < 8) {
      setPwError('Новый пароль должен быть не короче 8 символов')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError('Пароли не совпадают')
      return
    }
    savePassword()
  }

  const canSave = !isPending && currentPassword && newPassword && confirmPassword

  return (
    <div className="p-6 pb-28">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/warehouse/profile')}
            aria-label="Назад"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white"
          >
            <ChevronLeft size={18} className="text-slate-700" />
          </button>
          <h1 className="text-xl font-black text-slate-950">Изменить пароль</h1>
        </div>

        {pwError && <Alert variant="error">{pwError}</Alert>}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
          <Field label="Текущий пароль">
            <PasswordInput
              className="input"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>
          <Field label="Новый пароль">
            <PasswordInput
              className="input"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Минимум 8 символов"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Повторите новый пароль" last>
            <PasswordInput
              className="input"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
        </section>

        <Button variant="primary" fullWidth disabled={!canSave} onClick={handleSubmit}>
          {isPending ? 'Сохранение...' : 'Сохранить пароль'}
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children, last }) {
  return (
    <div className={last ? '' : 'mb-4'}>
      <label className="mb-1.5 block text-sm font-semibold text-slate-600">{label}</label>
      {children}
    </div>
  )
}
