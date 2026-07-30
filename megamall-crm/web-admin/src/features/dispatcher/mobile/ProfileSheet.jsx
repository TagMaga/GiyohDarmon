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
    <Sheet open={open} onClose={onClose} maxHeight="90%" zIndex={44}>
      <div style={{ background: C.gradient, borderRadius: 20, padding: '28px 20px', marginBottom: 20, color: '#fff', boxShadow: '0 10px 28px rgba(99,102,241,.25)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -40, right: -40, width: 120, height: 120, background: 'rgba(255,255,255,.1)', borderRadius: '50%' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: 'rgba(255,255,255,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 900, marginBottom: 18, backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,.3)' }}>{profile.initials}</div>
          <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 4, letterSpacing: '-.01em' }}>{profile.fullName ?? 'Диспетчер'}</div>
          <div style={{ fontSize: 13, opacity: 0.85, fontWeight: 600 }}>Диспетчер</div>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: C.text3, padding: '0 4px 12px' }}>Основная информация</div>
        <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,.04)', border: `1px solid ${C.border}` }}>
          <InfoRow icon="👤" iconBg={C.violetBg} iconColor={C.violetDk} label="Имя" value={firstName} border />
          <InfoRow icon="📝" iconBg={C.blueBg} iconColor={C.blue} label="Фамилия" value={lastName} border />
          <InfoRow icon="📞" iconBg={C.greenBg} iconColor={C.green} label="Телефон" value={profile.phone ?? '—'} phone border />
          <InfoRow icon="💼" iconBg={C.amberBg} iconColor={C.amber} label="Должность" value="Диспетчер" />
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: C.text3, padding: '0 4px 12px' }}>Безопасность</div>

        {passwordOpen ? (
          <div style={{ background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,.04)', border: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              <PasswordInput value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} placeholder="Текущий пароль" autoComplete="current-password" style={inputStyle} />
              <PasswordInput value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Новый пароль (мин. 8 символов)" autoComplete="new-password" style={inputStyle} />
              <PasswordInput value={pwd2} onChange={(e) => setPwd2(e.target.value)} placeholder="Повторите новый пароль" autoComplete="new-password" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 9 }}>
              <button
                type="button"
                onClick={() => { setPasswordOpen(false); setCurrentPwd(''); setPwd(''); setPwd2('') }}
                style={{ flex: 1, padding: 12, border: `1px solid ${C.border}`, borderRadius: 12, background: '#fff', color: C.text2, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => canSave && savePassword()}
                disabled={!canSave || isPending}
                style={{ flex: 1, padding: 12, border: 'none', borderRadius: 12, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#fff', cursor: canSave ? 'pointer' : 'default', background: canSave ? C.gradient : '#DDD', opacity: canSave ? 1 : 0.5 }}
              >
                {isPending ? '...' : 'Изменить'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPasswordOpen(true)}
            style={{ width: '100%', padding: 14, border: `1px solid ${C.border}`, borderRadius: 14, background: '#fff', color: C.text1, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.04)' }}
          >
            🔐 Изменить пароль
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        <button type="button" onClick={onLogout} style={{ width: '100%', padding: 14, border: `1px solid ${C.redSoft}`, borderRadius: 14, background: '#fff', color: C.red, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          Выйти из аккаунта
        </button>
        <button type="button" onClick={onClose} style={{ width: '100%', padding: 14, border: `1px solid ${C.border}`, borderRadius: 14, background: '#fff', color: C.text2, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          Закрыть
        </button>
      </div>
    </Sheet>
  )
}

const inputStyle = {
  border: `1px solid ${C.border}`, background: '#fff', borderRadius: 12, padding: '12px 13px',
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13, outline: 'none',
}

function InfoRow({ icon, iconBg, iconColor, label, value, phone, border }) {
  return (
    <div style={{ padding: '16px 16px', borderBottom: border ? `1px solid ${C.border2}` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: iconColor, fontSize: 18, flexShrink: 0 }}>{icon}</div>
        <div>
          <div style={{ fontSize: 11, color: C.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{label}</div>
          {phone ? (
            <a href={`tel:${value}`} style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: C.blue, textDecoration: 'none' }}>{value}</a>
          ) : (
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text1 }}>{value}</div>
          )}
        </div>
      </div>
    </div>
  )
}
