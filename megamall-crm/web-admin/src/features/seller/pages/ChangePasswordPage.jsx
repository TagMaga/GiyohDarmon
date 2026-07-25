import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import Alert from '../../../shared/components/Alert'
import PasswordInput from '../../../shared/components/PasswordInput'
import { useChangePassword } from '../hooks/useSellerMe'
import useCurrentUser from '../../../shared/hooks/useCurrentUser'
import { useToast } from '../../../shared/components/ToastProvider'
import { M, Card } from '../components/mobileUi'

export default function ChangePasswordPage() {
  const navigate = useNavigate()
  const { userId } = useCurrentUser()
  const changePassword = useChangePassword(userId)
  const toast = useToast()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState('')

  function handleChangePassword() {
    setPwError('')
    if (newPassword.length < 8) {
      setPwError('Новый пароль должен быть не короче 8 символов')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError('Пароли не совпадают')
      return
    }
    changePassword.mutate(
      { current_password: currentPassword, new_password: newPassword },
      {
        onSuccess: () => {
          toast.success('Пароль изменён')
          navigate('..')
        },
        onError: (err) => {
          setPwError(err?.response?.data?.error?.message ?? err?.message ?? 'Не удалось изменить пароль')
        },
      }
    )
  }

  const canSave = !changePassword.isPending && currentPassword && newPassword && confirmPassword

  const form = (
    <>
      <div style={{ padding: '13px 0', borderBottom: `1px solid ${M.bg}` }}>
        <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Текущий пароль</div>
        <PasswordInput
          value={currentPassword}
          onChange={e => setCurrentPassword(e.target.value)}
          style={inputStyle}
          placeholder="••••••••"
          autoComplete="current-password"
        />
      </div>
      <div style={{ padding: '13px 0', borderBottom: `1px solid ${M.bg}` }}>
        <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Новый пароль</div>
        <PasswordInput
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          style={inputStyle}
          placeholder="Минимум 8 символов"
          autoComplete="new-password"
        />
      </div>
      <div style={{ padding: '13px 0' }}>
        <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Повторите новый пароль</div>
        <PasswordInput
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          style={inputStyle}
          placeholder="••••••••"
          autoComplete="new-password"
        />
      </div>
    </>
  )

  return (
    <>
      {/* ═══ MOBILE ═══ */}
      <div className="lg:hidden flex flex-col gap-4" style={{ fontFamily: M.font }}>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate('..')}
            aria-label="Назад"
            className="flex items-center justify-center flex-shrink-0"
            style={{ width: 32, height: 32, borderRadius: 10, background: M.card, border: `1px solid ${M.border}` }}
          >
            <ChevronLeft size={17} color={M.ink} />
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Изменить пароль</h1>
        </div>

        {pwError && <Alert variant="error">{pwError}</Alert>}

        <div>
          <SectionTitle>Пароль</SectionTitle>
          <Card style={{ borderRadius: 16, padding: '4px 16px' }}>{form}</Card>
        </div>

        <button
          type="button"
          onClick={handleChangePassword}
          disabled={!canSave}
          className="active:scale-[0.98] transition-transform"
          style={{
            background: 'linear-gradient(135deg,#6366F1,#4F46E5)', color: '#fff', border: 'none',
            fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, padding: '13px 20px', borderRadius: 14,
            cursor: canSave ? 'pointer' : 'not-allowed',
            opacity: canSave ? 1 : 0.6,
            boxShadow: '0 8px 20px rgba(99,102,241,.32)',
          }}
        >
          {changePassword.isPending ? 'Сохранение...' : 'Сохранить пароль'}
        </button>
        <p style={{ fontSize: 11.5, color: M.muted, textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
          После сохранения вы вернётесь в профиль
        </p>
      </div>

      {/* ═══ DESKTOP ═══ */}
      <div className="hidden lg:flex flex-col gap-5" style={{ padding: '36px 44px', fontFamily: M.font, maxWidth: 560 }}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('..')}
            aria-label="Назад"
            className="flex items-center justify-center flex-shrink-0"
            style={{ width: 36, height: 36, borderRadius: 11, background: '#fff', border: `1px solid ${M.border}`, cursor: 'pointer' }}
          >
            <ChevronLeft size={18} color={M.ink} />
          </button>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Изменить пароль</h1>
        </div>

        {pwError && <Alert variant="error">{pwError}</Alert>}

        <div>
          <SectionTitle>Пароль</SectionTitle>
          <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 16, padding: '6px 22px' }}>{form}</div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleChangePassword}
            disabled={!canSave}
            style={{
              background: 'linear-gradient(135deg,#6366F1,#4F46E5)', color: '#fff', border: 'none',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700, padding: '12px 26px', borderRadius: 13,
              cursor: canSave ? 'pointer' : 'not-allowed',
              opacity: canSave ? 1 : 0.6,
              boxShadow: '0 8px 20px rgba(99,102,241,.32)',
            }}
          >
            {changePassword.isPending ? 'Сохранение...' : 'Сохранить пароль'}
          </button>
          <button
            type="button"
            onClick={() => navigate('..')}
            style={{
              background: 'transparent', color: M.sub, border: `1px solid ${M.borderAlt}`,
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700, padding: '12px 26px', borderRadius: 13,
              cursor: 'pointer',
            }}
          >
            Отмена
          </button>
        </div>
      </div>
    </>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: M.muted, letterSpacing: '.04em', textTransform: 'uppercase', margin: '0 4px 10px' }}>
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  fontSize: 15,
  fontWeight: 700,
  color: M.ink,
  outline: 'none',
  padding: '4px 0 0',
  margin: 0,
}
