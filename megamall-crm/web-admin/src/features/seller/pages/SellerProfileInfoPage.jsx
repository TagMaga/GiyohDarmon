import { useState, useEffect } from 'react'
import Alert from '../../../shared/components/Alert'
import { useSellerMe, usePatchMe } from '../hooks/useSellerMe'
import { useToast } from '../../../shared/components/ToastProvider'
import { Check, MessageCircle } from 'lucide-react'
import { M, Card } from '../components/mobileUi'

function toDateInput(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function initials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || 'SE'
}

export default function SellerProfileInfoPage() {
  const { data: me, isLoading } = useSellerMe()
  const patch = usePatchMe()
  const toast = useToast()
  const [fullName, setFullName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [telegramChatId, setTelegramChatId] = useState('')

  useEffect(() => {
    if (me?.full_name != null) setFullName(me.full_name)
    if (me?.date_of_birth != null) setDateOfBirth(toDateInput(me.date_of_birth))
    if (me?.telegram_chat_id != null) setTelegramChatId(me.telegram_chat_id)
  }, [me])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="card h-16 animate-pulse" />)}
      </div>
    )
  }

  const errMsg = patch.error?.response?.data?.error?.message ?? patch.error?.message

  function handleTelegramSave() {
    patch.mutate(
      { telegram_chat_id: telegramChatId.trim() || null },
      { onSuccess: () => toast.success('Сохранено') }
    )
  }

  function handlePersonalSave() {
    const payload = {
      full_name: fullName.trim(),
      ...(dateOfBirth ? { date_of_birth: `${dateOfBirth}T00:00:00Z` } : {}),
    }
    patch.mutate(payload, { onSuccess: () => toast.success('Изменения сохранены') })
  }

  const avatarUrl = me?.avatar_url ? `${me.avatar_url}?t=${me.updated_at ?? ''}` : null
  const roleLabel = me?.role === 'manager' ? 'Менеджер' : me?.role === 'sales_team_lead' ? 'Тимлид' : 'Продавец'
  const cityLabel = me?.city_name ?? me?.city ?? me?.address ?? 'Душанбе'

  function handleSaveAll() {
    handlePersonalSave()
    if (telegramChatId.trim() !== (me?.telegram_chat_id ?? '')) handleTelegramSave()
  }

  return (
    <>
      {/* ═══ MOBILE ═══ */}
      <div className="lg:hidden flex flex-col gap-4" style={{ fontFamily: M.font }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Личные данные</h1>

        {errMsg && <Alert variant="error">{errMsg}</Alert>}

        <Card className="flex flex-col items-center text-center" style={{ borderRadius: 20, padding: '24px 18px' }}>
          <div
            className="flex items-center justify-center overflow-hidden"
            style={{ width: 84, height: 84, borderRadius: '50%', background: '#E7E5FB', color: M.indigoDeep, fontWeight: 800, fontSize: 28 }}
          >
            {avatarUrl ? <img src={avatarUrl} alt={fullName || 'Профиль'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(fullName)}
          </div>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: M.indigo, marginTop: 12 }}>Изменить фото</span>
        </Card>

        <div>
          <SectionTitle>Основное</SectionTitle>
          <Card style={{ borderRadius: 16, padding: '4px 16px' }}>
            <div style={{ padding: '13px 0', borderBottom: `1px solid ${M.bg}` }}>
              <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Имя и фамилия</div>
              <input value={fullName} onChange={e => setFullName(e.target.value)} style={desktopInputStyle} placeholder="Имя и фамилия" />
            </div>
            <div style={{ padding: '13px 0', borderBottom: `1px solid ${M.bg}` }}>
              <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Дата рождения</div>
              <input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} style={desktopInputStyle} />
            </div>
            <div style={{ padding: '13px 0' }}>
              <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Номер телефона</div>
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

        <div>
          <SectionTitle>Локация и работа</SectionTitle>
          <Card style={{ borderRadius: 16, overflow: 'hidden' }}>
            <div className="flex items-center justify-between" style={{ padding: '14px 16px', borderBottom: `1px solid ${M.bg}` }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: M.ink }}>Город</span>
              <span style={{ fontSize: 13.5, color: '#76766E', fontWeight: 600 }}>{cityLabel}</span>
            </div>
            <div className="flex items-center justify-between" style={{ padding: '14px 16px' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: M.ink }}>Роль</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#76766E', background: '#F0EFEA', padding: '4px 11px', borderRadius: 7 }}>{roleLabel}</span>
            </div>
          </Card>
        </div>

        <div>
          <SectionTitle>Telegram</SectionTitle>
          <Card style={{ borderRadius: 16, padding: '16px' }} className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#2481CC,#1A6CB0)' }}>
                <MessageCircle size={15} color="white" />
              </div>
              <p style={{ fontSize: 12, color: M.sub }}>Для уведомлений о заказах</p>
            </div>
            <input
              className="input"
              placeholder="Chat ID, например -100123456789"
              value={telegramChatId}
              onChange={e => setTelegramChatId(e.target.value)}
            />
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
          <div className="relative">
            <div
              className="flex items-center justify-center overflow-hidden"
              style={{ width: 96, height: 96, borderRadius: '50%', background: '#E7E5FB', color: M.indigoDeep, fontWeight: 800, fontSize: 32 }}
            >
              {avatarUrl ? <img src={avatarUrl} alt={fullName || 'Профиль'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(fullName)}
            </div>
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, color: M.indigo, marginTop: 14, cursor: 'pointer' }}>Изменить фото</span>
        </Card>

        {/* form column */}
        <div className="flex flex-col gap-[18px] overflow-hidden">
          <div>
            <SectionTitle>Основное</SectionTitle>
            <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 16, padding: '6px 22px' }} className="grid grid-cols-2">
              <div style={{ padding: '14px 14px 14px 0', borderBottom: `1px solid ${M.bg}` }}>
                <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Имя и фамилия</div>
                <input value={fullName} onChange={e => setFullName(e.target.value)} style={desktopInputStyle} placeholder="Имя и фамилия" />
              </div>
              <div style={{ padding: '14px 0 14px 14px', borderBottom: `1px solid ${M.bg}` }}>
                <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Дата рождения</div>
                <input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} style={desktopInputStyle} />
              </div>
              <div style={{ gridColumn: '1 / -1', padding: '14px 0' }}>
                <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600 }}>Номер телефона</div>
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
            <SectionTitle>Локация и работа</SectionTitle>
            <Card style={{ borderRadius: 16, overflow: 'hidden' }}>
              <div className="flex items-center justify-between" style={{ padding: '15px 22px', borderBottom: `1px solid ${M.bg}` }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: M.ink }}>Город</span>
                <span style={{ fontSize: 14, color: '#76766E', fontWeight: 600 }}>{cityLabel}</span>
              </div>
              <div className="flex items-center justify-between" style={{ padding: '15px 22px' }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: M.ink }}>Роль</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#76766E', background: '#F0EFEA', padding: '5px 12px', borderRadius: 7 }}>{roleLabel}</span>
              </div>
            </Card>
          </div>

          <div>
            <SectionTitle>Telegram</SectionTitle>
            <Card style={{ borderRadius: 16, padding: '18px 22px' }} className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#2481CC,#1A6CB0)' }}>
                  <MessageCircle size={15} color="white" />
                </div>
                <p style={{ fontSize: 12.5, color: M.sub }}>Для уведомлений о заказах</p>
              </div>
              <input
                className="input"
                placeholder="Chat ID, например -100123456789"
                value={telegramChatId}
                onChange={e => setTelegramChatId(e.target.value)}
              />
            </Card>
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
