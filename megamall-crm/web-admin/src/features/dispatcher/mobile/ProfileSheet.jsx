import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Sheet from './Sheet'
import { C } from './theme'
import useProfile from '../../../shared/hooks/useProfile'
import useCurrentUser from '../../../shared/hooks/useCurrentUser'
import { useToast } from '../../../shared/components/ToastProvider'
import PasswordInput from '../../../shared/components/PasswordInput'
import { changePassword } from '../../seller/api'

export default function ProfileSheet({ open, onClose, onLogout }) {
  const profile = useProfile()
  const { userId } = useCurrentUser()
  const toast = useToast()
  const [currentPwd, setCurrentPwd] = useState('')
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setCurrentPwd('')
      setPwd('')
      setPwd2('')
      setPasswordOpen(false)
    }
  }, [open])

  const { mutate: savePassword, isPending } = useMutation({
    mutationFn: () => changePassword(userId, { current_password: currentPwd, new_password: pwd }),
    onSuccess: () => {
      toast.success('Пароль успешно изменён')
      setCurrentPwd('')
      setPwd('')
      setPwd2('')
      setPasswordOpen(false)
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  if (!open) return null

  const nameParts = (profile.fullName ?? '').trim().split(/\s+/).filter(Boolean)
  const firstName = nameParts[0] ?? '—'
  const lastName = nameParts.slice(1).join(' ') || '—'
  const canSave = currentPwd.length > 0 && pwd.length >= 8 && pwd === pwd2

  return (
    <Sheet open={open} onClose={onClose} maxHeight="88%" zIndex={44}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 18 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: C.violet, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, fontWeight: 900, flexShrink: 0, boxShadow: '0 6px 16px rgba(99,102,241,.3)' }}>{profile.initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>{profile.fullName ?? 'Диспетчер'}</div>
          <div style={{ fontSize: 12, color: C.text4 }}>Диспетчер</div>
        </div>
      </div>

      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', marginBottom: 18 }}>
        <InfoRow label="Имя" value={firstName} border />
        <InfoRow label="Фамилия" value={lastName} border />
        <InfoRow label="Телефон" value={profile.phone ?? '—'} phone border />
        <InfoRow label="Должность" value="Диспетчер" />
      </div>

      {!passwordOpen ? (
        <button
          type="button"
          onClick={() => setPasswordOpen(true)}
          style={{ width: '100%', padding: 13, border: `1px solid ${C.border}`, borderRadius: 13, background: '#fff', color: C.text1, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', marginBottom: 9 }}
        >
          Изменить пароль
        </button>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: C.text3, padding: '0 2px 10px' }}>Смена пароля</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 12 }}>
            <PasswordInput value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} placeholder="Текущий пароль" autoComplete="current-password" style={inputStyle} />
            <PasswordInput value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Новый пароль (мин. 8 символов)" autoComplete="new-password" style={inputStyle} />
            <PasswordInput value={pwd2} onChange={(e) => setPwd2(e.target.value)} placeholder="Повторите новый пароль" autoComplete="new-password" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 9 }}>
            <button
              type="button"
              onClick={() => { setPasswordOpen(false); setCurrentPwd(''); setPwd(''); setPwd2('') }}
              style={{ flex: 1, padding: 13, border: `1px solid ${C.border}`, borderRadius: 13, background: '#fff', color: C.text2, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => canSave && savePassword()}
              disabled={!canSave || isPending}
              style={{ flex: 1, padding: 13, border: 'none', borderRadius: 13, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: canSave ? 'pointer' : 'default', background: C.gradient, opacity: canSave ? 1 : 0.5 }}
            >
              {isPending ? '...' : 'Изменить пароль'}
            </button>
          </div>
        </div>
      )}
      <button type="button" onClick={onLogout} style={{ width: '100%', padding: 13, border: `1px solid ${C.redSoft}`, borderRadius: 13, background: '#fff', color: C.red, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', marginBottom: 9 }}>
        Выйти
      </button>
      <button type="button" onClick={onClose} style={{ width: '100%', padding: 13, border: `1px solid ${C.border}`, borderRadius: 13, background: '#fff', color: C.text2, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
        Закрыть
      </button>
    </Sheet>
  )
}

const inputStyle = {
  border: `1px solid ${C.border}`, background: '#fff', borderRadius: 12, padding: '12px 13px',
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13, outline: 'none',
}

function InfoRow({ label, value, phone, border }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 14px', borderBottom: border ? `1px solid ${C.border2}` : 'none' }}>
      <span style={{ fontSize: 12, color: C.text3 }}>{label}</span>
      {phone ? (
        <a href={`tel:${value}`} style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: C.blue }}>{value}</a>
      ) : (
        <span style={{ fontSize: 13, fontWeight: 700 }}>{value}</span>
      )}
    </div>
  )
}
