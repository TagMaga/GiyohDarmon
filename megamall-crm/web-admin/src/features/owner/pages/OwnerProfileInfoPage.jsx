import { useState, useEffect, useRef } from 'react'
import Alert from '../../../shared/components/Alert'
import PasswordInput from '../../../shared/components/PasswordInput'
import { useSellerMe, usePatchMe, useChangePassword, useUploadMyAvatar } from '../../seller/hooks/useSellerMe'
import useCurrentUser from '../../../shared/hooks/useCurrentUser'
import { useToast } from '../../../shared/components/ToastProvider'
import { translateMediaError } from '../../../shared/api/mediaErrors'
import { withCacheBust } from '../../../shared/api/mediaUpload'
import { Check, Upload } from 'lucide-react'
import { M, Card } from '../../seller/components/mobileUi'

function initials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || 'ВЛ'
}

export default function OwnerProfileInfoPage() {
  const { data: me, isLoading } = useSellerMe()
  const { userId } = useCurrentUser()
  const patch = usePatchMe()
  const changePassword = useChangePassword(userId)
  const avatarUpload = useUploadMyAvatar()
  const toast = useToast()

  const [fullName, setFullName] = useState('')
  // Two separate refs: mobile and desktop layouts are both always mounted
  // (shown/hidden via Tailwind's lg: breakpoint classes), so a single
  // shared ref would only ever point at whichever block rendered last.
  const fileRef = useRef()
  const fileRefDesktop = useRef()

  function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    avatarUpload.mutate(file, {
      onError: (err) => toast.error(translateMediaError(err)),
    })
  }
  const [pwOpen, setPwOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState('')

  useEffect(() => {
    if (me?.full_name != null) setFullName(me.full_name)
  }, [me])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="card h-16 animate-pulse" />)}
      </div>
    )
  }

  const errMsg = patch.error?.response?.data?.error?.message ?? patch.error?.message

  function handleSaveAll() {
    patch.mutate({ full_name: fullName.trim() }, { onSuccess: () => toast.success('Изменения сохранены') })
  }

  function resetPasswordForm() {
    setPwOpen(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPwError('')
  }

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
          resetPasswordForm()
        },
        onError: (err) => {
          setPwError(err?.response?.data?.error?.message ?? err?.message ?? 'Не удалось изменить пароль')
        },
      }
    )
  }

  const avatarUrl = withCacheBust(me?.avatar_url, me?.updated_at)

  const passwordForm = (
    <>
      <div style={{ padding: '13px 0', borderBottom: `1px solid ${M.bg}` }}>
        <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Текущий пароль</div>
        <PasswordInput
          value={currentPassword}
          onChange={e => setCurrentPassword(e.target.value)}
          style={desktopInputStyle}
          placeholder="••••••••"
          autoComplete="current-password"
        />
      </div>
      <div style={{ padding: '13px 0', borderBottom: `1px solid ${M.bg}` }}>
        <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Новый пароль</div>
        <PasswordInput
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          style={desktopInputStyle}
          placeholder="Минимум 8 символов"
          autoComplete="new-password"
        />
      </div>
      <div style={{ padding: '13px 0' }}>
        <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Повторите новый пароль</div>
        <PasswordInput
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          style={desktopInputStyle}
          placeholder="••••••••"
          autoComplete="new-password"
        />
      </div>
      {pwError && <Alert variant="error">{pwError}</Alert>}
      <div className="flex gap-2" style={{ paddingTop: 4 }}>
        <button
          type="button"
          onClick={handleChangePassword}
          disabled={changePassword.isPending || !currentPassword || !newPassword || !confirmPassword}
          style={{
            background: 'linear-gradient(135deg,#6366F1,#4F46E5)', color: '#fff', border: 'none',
            fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, padding: '11px 18px', borderRadius: 12,
            cursor: changePassword.isPending ? 'not-allowed' : 'pointer',
            opacity: changePassword.isPending || !currentPassword || !newPassword || !confirmPassword ? 0.6 : 1,
          }}
        >
          {changePassword.isPending ? 'Сохранение...' : 'Сохранить пароль'}
        </button>
        <button
          type="button"
          onClick={resetPasswordForm}
          style={{
            background: 'transparent', color: M.sub, border: `1px solid ${M.borderAlt}`,
            fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, padding: '11px 18px', borderRadius: 12,
            cursor: 'pointer',
          }}
        >
          Отмена
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* ═══ MOBILE ═══ */}
      <div className="lg:hidden flex flex-col gap-4" style={{ fontFamily: M.font }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Личные данные</h1>

        {errMsg && <Alert variant="error">{errMsg}</Alert>}

        <Card className="flex flex-col items-center text-center" style={{ borderRadius: 20, padding: '24px 18px' }}>
          <div className="relative group/av">
            <div
              className="flex items-center justify-center overflow-hidden cursor-pointer"
              style={{ width: 84, height: 84, borderRadius: '50%', background: '#E7E5FB', color: M.indigoDeep, fontWeight: 800, fontSize: 28 }}
              onClick={() => fileRef.current?.click()}
            >
              {avatarUrl ? <img src={avatarUrl} alt={fullName || 'Профиль'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(fullName)}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/av:opacity-100 transition-opacity flex items-center justify-center" style={{ borderRadius: '50%' }}>
                {avatarUpload.isPending ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Upload size={18} className="text-white" />
                )}
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
        </Card>

        <div>
          <SectionTitle>Основное</SectionTitle>
          <Card style={{ borderRadius: 16, padding: '4px 16px' }}>
            <div style={{ padding: '13px 0', borderBottom: `1px solid ${M.bg}` }}>
              <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Имя и фамилия</div>
              <input value={fullName} onChange={e => setFullName(e.target.value)} style={desktopInputStyle} placeholder="Имя и фамилия" />
            </div>
            <div style={{ padding: '13px 0' }}>
              <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Логин (телефон)</div>
              <div className="flex items-center justify-between" style={{ marginTop: 4 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: M.ink }}>{me?.phone || '—'}</span>
                <span className="inline-flex items-center gap-1" style={{ fontSize: 11, fontWeight: 700, color: M.green, background: M.greenBg, padding: '3px 9px', borderRadius: 7 }}>
                  <Check size={9} strokeWidth={3.2} />
                  Подтверждён
                </span>
              </div>
            </div>
          </Card>
        </div>

        <button
          type="button"
          onClick={handleSaveAll}
          disabled={patch.isPending || !fullName.trim()}
          className="active:scale-[0.98] transition-transform"
          style={{
            background: 'linear-gradient(135deg,#6366F1,#4F46E5)', color: '#fff', border: 'none',
            fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, padding: '13px 20px', borderRadius: 14,
            cursor: patch.isPending || !fullName.trim() ? 'not-allowed' : 'pointer',
            opacity: patch.isPending || !fullName.trim() ? 0.7 : 1,
            boxShadow: '0 8px 20px rgba(99,102,241,.32)',
          }}
        >
          {patch.isPending ? 'Сохранение...' : 'Сохранить изменения'}
        </button>

        <div>
          <SectionTitle>Безопасность</SectionTitle>
          <Card style={{ borderRadius: 16, padding: '4px 16px' }}>
            {!pwOpen ? (
              <div className="flex items-center justify-between" style={{ padding: '14px 0' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: M.ink }}>Пароль</span>
                <button
                  type="button"
                  onClick={() => setPwOpen(true)}
                  style={{ background: 'none', border: 'none', color: M.indigo, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                >
                  Изменить пароль
                </button>
              </div>
            ) : passwordForm}
          </Card>
        </div>
      </div>

      {/* ═══ DESKTOP ═══ */}
      <div className="hidden lg:flex flex-col gap-5" style={{ padding: '36px 44px', fontFamily: M.font }}>
      <div className="flex items-center justify-between">
        <h1 style={{ fontSize: 28, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Личные данные</h1>
        <button
          type="button"
          onClick={handleSaveAll}
          disabled={patch.isPending || !fullName.trim()}
          style={{
            background: 'linear-gradient(135deg,#6366F1,#4F46E5)', color: '#fff', border: 'none',
            fontFamily: 'inherit', fontSize: 14, fontWeight: 700, padding: '12px 26px', borderRadius: 13,
            cursor: patch.isPending || !fullName.trim() ? 'not-allowed' : 'pointer',
            opacity: patch.isPending || !fullName.trim() ? 0.7 : 1,
            boxShadow: '0 8px 20px rgba(99,102,241,.32)',
          }}
        >
          {patch.isPending ? 'Сохранение...' : 'Сохранить изменения'}
        </button>
      </div>

      {errMsg && <Alert variant="error">{errMsg}</Alert>}

      <div className="grid gap-5" style={{ gridTemplateColumns: '300px 1fr' }}>
        {/* avatar column */}
        <Card style={{ borderRadius: 20, padding: '32px 20px', height: 'fit-content' }} className="flex flex-col items-center text-center">
          <div className="relative group/av">
            <div
              className="flex items-center justify-center overflow-hidden cursor-pointer"
              style={{ width: 96, height: 96, borderRadius: '50%', background: '#E7E5FB', color: M.indigoDeep, fontWeight: 800, fontSize: 32 }}
              onClick={() => fileRefDesktop.current?.click()}
            >
              {avatarUrl ? <img src={avatarUrl} alt={fullName || 'Профиль'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(fullName)}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/av:opacity-100 transition-opacity flex items-center justify-center" style={{ borderRadius: '50%' }}>
                {avatarUpload.isPending ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Upload size={20} className="text-white" />
                )}
              </div>
            </div>
            <input ref={fileRefDesktop} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
        </Card>

        {/* form column */}
        <div className="flex flex-col gap-[18px] overflow-hidden">
          <div>
            <SectionTitle>Основное</SectionTitle>
            <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 16, padding: '6px 22px' }} className="grid grid-cols-2">
              <div style={{ gridColumn: '1 / -1', padding: '14px 0', borderBottom: `1px solid ${M.bg}` }}>
                <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Имя и фамилия</div>
                <input value={fullName} onChange={e => setFullName(e.target.value)} style={desktopInputStyle} placeholder="Имя и фамилия" />
              </div>
              <div style={{ gridColumn: '1 / -1', padding: '14px 0' }}>
                <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Логин (телефон)</div>
                <div className="flex items-center justify-between" style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: M.ink }}>{me?.phone || '—'}</span>
                  <span className="inline-flex items-center gap-1" style={{ fontSize: 11, fontWeight: 700, color: M.green, background: M.greenBg, padding: '3px 9px', borderRadius: 7 }}>
                    <Check size={9} strokeWidth={3.2} />
                    Подтверждён
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <SectionTitle>Безопасность</SectionTitle>
            <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 16, padding: '6px 22px' }}>
              {!pwOpen ? (
                <div className="flex items-center justify-between" style={{ padding: '14px 0' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: M.ink }}>Пароль</span>
                  <button
                    type="button"
                    onClick={() => setPwOpen(true)}
                    style={{ background: 'none', border: 'none', color: M.indigo, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  >
                    Изменить пароль
                  </button>
                </div>
              ) : passwordForm}
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}

function SectionTitle({ children, style }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: M.muted, letterSpacing: '.04em', textTransform: 'uppercase', margin: '0 4px 10px', ...style }}>
      {children}
    </div>
  )
}

const desktopInputStyle = {
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
