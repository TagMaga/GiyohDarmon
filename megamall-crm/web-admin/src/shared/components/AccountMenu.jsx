import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown, ChevronLeft, ChevronRight,
  User, Settings, Bell, Moon, Sun, LogOut, Lock, Loader2,
} from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import useAuthStore      from '../store/authStore'
import useProfile        from '../hooks/useProfile'
import useTheme          from '../hooks/useTheme'
import useAppSettings    from '../hooks/useAppSettings'
import { useToast }      from './ToastProvider'
import { updateEmployee } from '../../features/people/api'

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_LABELS = {
  owner:             'Владелец',
  sales_team_lead:   'Руководитель группы',
  manager:           'Менеджер',
  seller:            'Продавец',
  dispatcher:        'Диспетчер',
  warehouse_manager: 'Кладовщик',
  courier:           'Курьер',
}

const ROLE_COLORS = {
  owner:             '#f59e0b',
  sales_team_lead:   '#3b82f6',
  manager:           '#10b981',
  seller:            '#8b5cf6',
  dispatcher:        '#6366f1',
  warehouse_manager: '#f97316',
  courier:           '#0ea5e9',
}

// ── Primitives ────────────────────────────────────────────────────────────────

function AvatarCircle({ initials, role, size = 36 }) {
  const color = ROLE_COLORS[role] ?? '#6366f1'
  return (
    <div style={{
      width: size, height: size,
      borderRadius: '50%',
      background: `linear-gradient(135deg, ${color}99 0%, ${color} 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      fontSize: size < 32 ? 11 : size < 46 ? 14 : 17,
      fontWeight: 800, color: '#fff',
      letterSpacing: '0.04em', userSelect: 'none',
    }}>
      {initials}
    </div>
  )
}

function ToggleSwitch({ active, onChange }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange(!active) }}
      role="switch"
      aria-checked={active}
      style={{
        width: 36, height: 20, borderRadius: 99,
        background: active ? '#6366f1' : '#334155',
        border: 'none', cursor: 'pointer', padding: 0,
        position: 'relative', flexShrink: 0,
        transition: 'background 0.2s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: 2,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff',
        transition: 'transform 0.2s',
        transform: active ? 'translateX(16px)' : 'translateX(0)',
        display: 'block',
      }} />
    </button>
  )
}

function MenuRow({ icon: Icon, label, onClick, trailing, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
        background: 'transparent',
        color: danger ? '#f87171' : '#cbd5e1',
        fontSize: 13, fontWeight: 500, textAlign: 'left',
        transition: 'background 0.12s, color 0.12s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.06)'
        e.currentTarget.style.color = danger ? '#fca5a5' : '#f1f5f9'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = danger ? '#f87171' : '#cbd5e1'
      }}
    >
      <Icon size={15} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
      {trailing ?? (onClick && !danger && <ChevronRight size={13} style={{ color: '#475569' }} />)}
    </button>
  )
}

function PanelHeader({ onBack, title }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)',
    }}>
      <button
        onClick={onBack}
        aria-label="Назад"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'transparent', color: '#94a3b8',
          transition: 'background 0.12s, color 0.12s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#fff' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8' }}
      >
        <ChevronLeft size={16} />
      </button>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{title}</span>
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '2px 0' }} />
}

// ── Main menu ─────────────────────────────────────────────────────────────────

function MainView({ fullName, phone, role, initials, theme, onToggleTheme, onGo }) {
  const roleLabel = ROLE_LABELS[role] ?? role
  const isDark = theme === 'dark'
  return (
    <>
      {/* Account header */}
      <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <AvatarCircle initials={initials} role={role} size={46} />
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {fullName ?? phone ?? 'Пользователь'}
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>{roleLabel}</p>
            {fullName && phone && (
              <p style={{ margin: '1px 0 0', fontSize: 11, color: '#475569' }}>{phone}</p>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '6px' }}>
        <MenuRow icon={User}     label="Мой профиль"  onClick={() => onGo('profile')} />
        <MenuRow icon={Settings} label="Настройки"     onClick={() => onGo('settings')} />
        <MenuRow icon={Bell}     label="Уведомления"   onClick={() => onGo('notifications')} />
        <MenuRow
          icon={isDark ? Sun : Moon}
          label={isDark ? 'Светлая тема' : 'Тёмная тема'}
          onClick={onToggleTheme}
          trailing={<ToggleSwitch active={isDark} onChange={() => onToggleTheme()} />}
        />
      </div>

      <Divider />

      {/* Logout */}
      <div style={{ padding: '6px' }}>
        <MenuRow icon={LogOut} label="Выйти из системы" onClick={() => onGo('logout')} danger trailing={null} />
      </div>
    </>
  )
}

// ── Profile panel ─────────────────────────────────────────────────────────────

function ProfileView({ onBack, fullName, phone, role, employee, userId }) {
  const [changingPw, setChangingPw] = useState(false)
  const [pw, setPw] = useState({ next: '', confirm: '' })
  const toast = useToast()
  const roleLabel = ROLE_LABELS[role] ?? role

  const profileInitials = fullName
    ? fullName.trim().split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : (role ? role.slice(0, 2).toUpperCase() : 'U')

  const { mutate: savePw, isPending } = useMutation({
    mutationFn: () => updateEmployee(userId, { password: pw.next }),
    onSuccess: () => {
      toast.success('Пароль обновлён')
      setChangingPw(false)
      setPw({ next: '', confirm: '' })
    },
    onError: err => toast.error(err?.response?.data?.error?.message ?? 'Ошибка обновления пароля'),
  })

  function submitPw() {
    if (pw.next.length < 6) { toast.error('Минимум 6 символов'); return }
    if (pw.next !== pw.confirm) { toast.error('Пароли не совпадают'); return }
    savePw()
  }

  const teamName  = employee?.team_name ?? employee?.team?.name ?? null
  const city      = employee?.city ?? null
  const createdAt = employee?.created_at
    ? new Date(employee.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
    : null

  const rows = [
    { label: 'Телефон',  value: phone },
    { label: 'Роль',     value: roleLabel },
    { label: 'Команда',  value: teamName },
    { label: 'Город',    value: city },
    { label: 'Создан',   value: createdAt },
  ].filter(r => r.value)

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: '8px 12px',
    fontSize: 13, color: '#f1f5f9',
    outline: 'none', transition: 'border-color 0.15s',
  }

  return (
    <>
      <PanelHeader onBack={onBack} title="Мой профиль" />

      {/* Avatar + name */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <AvatarCircle initials={profileInitials} role={role} size={56} />
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{fullName ?? phone}</p>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>{roleLabel}</p>
        </div>
      </div>

      {/* Details */}
      {rows.length > 0 && (
        <div style={{ padding: '4px 16px' }}>
          {rows.map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{r.label}</span>
              <span style={{ fontSize: 13, color: '#cbd5e1', textAlign: 'right' }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Password section */}
      <div style={{ padding: '8px 16px 14px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        {!changingPw ? (
          <MenuRow icon={Lock} label="Изменить пароль" onClick={() => setChangingPw(true)} trailing={null} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ margin: '4px 0 8px', fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Смена пароля</p>
            <input
              type="password"
              placeholder="Новый пароль"
              value={pw.next}
              onChange={e => setPw(p => ({ ...p, next: e.target.value }))}
              style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#6366f1')}
              onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            />
            <input
              type="password"
              placeholder="Повторите пароль"
              value={pw.confirm}
              onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))}
              style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#6366f1')}
              onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              onKeyDown={e => e.key === 'Enter' && submitPw()}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              <button
                onClick={() => { setChangingPw(false); setPw({ next: '', confirm: '' }) }}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Отмена
              </button>
              <button
                onClick={submitPw}
                disabled={isPending || !pw.next || !pw.confirm}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: isPending || !pw.next || !pw.confirm ? 0.5 : 1 }}
              >
                {isPending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'Сохранить'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Settings panel ────────────────────────────────────────────────────────────

function SettingsView({ onBack, settings, onUpdate }) {
  const LANGUAGES = [
    { value: 'ru', label: 'Русский' },
    { value: 'en', label: 'English' },
    { value: 'tj', label: 'Тоҷикӣ' },
  ]

  const rowStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
  }
  const labelStyle = { fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }

  return (
    <>
      <PanelHeader onBack={onBack} title="Настройки" />
      <div style={{ padding: '4px 16px 12px' }}>

        <div style={rowStyle}>
          <span style={labelStyle}>Язык</span>
          <select
            value={settings.language}
            onChange={e => onUpdate({ language: e.target.value })}
            style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '5px 10px', fontSize: 13, color: '#cbd5e1', outline: 'none', cursor: 'pointer' }}
          >
            {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Часовой пояс</span>
          <span style={{ fontSize: 13, color: '#64748b' }}>Asia/Dushanbe</span>
        </div>

        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <span style={labelStyle}>Плотность</span>
          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
            {[{ value: 'comfortable', label: 'Обычная' }, { value: 'compact', label: 'Компактная' }].map(d => (
              <button
                key={d.value}
                onClick={() => onUpdate({ density: d.value })}
                style={{
                  padding: '5px 12px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: settings.density === d.value ? '#6366f1' : 'transparent',
                  color: settings.density === d.value ? '#fff' : '#64748b',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

      </div>
    </>
  )
}

// ── Notifications panel ───────────────────────────────────────────────────────

const NOTIF_ITEMS = [
  { key: 'orderAssigned',  label: 'Заказ назначен' },
  { key: 'orderDelivered', label: 'Заказ доставлен' },
  { key: 'cashSubmitted',  label: 'Касса сдана' },
  { key: 'cashConfirmed',  label: 'Касса подтверждена' },
  { key: 'systemAlerts',   label: 'Системные уведомления' },
]

function NotificationsView({ onBack, settings, onUpdateNotif }) {
  return (
    <>
      <PanelHeader onBack={onBack} title="Уведомления" />
      <div style={{ padding: '4px 16px 12px' }}>
        {NOTIF_ITEMS.map((item, i) => (
          <div
            key={item.key}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '11px 0',
              borderBottom: i < NOTIF_ITEMS.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
            }}
          >
            <span style={{ fontSize: 13, color: '#cbd5e1' }}>{item.label}</span>
            <ToggleSwitch
              active={settings.notifications[item.key]}
              onChange={val => onUpdateNotif(item.key, val)}
            />
          </div>
        ))}
      </div>
    </>
  )
}

// ── Logout confirm ────────────────────────────────────────────────────────────

function LogoutView({ onBack, onConfirm }) {
  return (
    <>
      <PanelHeader onBack={onBack} title="Выход из системы" />
      <div style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 52, height: 52, borderRadius: 16, background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LogOut size={22} style={{ color: '#f87171' }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>Выйти из системы?</p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
            Вы будете перенаправлены<br />на страницу входа
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <button
            onClick={onBack}
            style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: '#dc2626', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#ef4444')}
            onMouseLeave={e => (e.currentTarget.style.background = '#dc2626')}
          >
            Выйти
          </button>
        </div>
      </div>
    </>
  )
}

// ── AccountMenu (export) ──────────────────────────────────────────────────────

// variant: 'light' (default — light glass topbar) | 'dark' (dispatcher dark topbar)
export default function AccountMenu({ variant = 'light' }) {
  const [open, setOpen]   = useState(false)
  const [view, setView]   = useState('main')
  const panelRef          = useRef(null)
  const triggerRef        = useRef(null)

  const { fullName, initials, phone, role, userId, employee } = useProfile()
  const { theme, toggle: toggleTheme }  = useTheme()
  const { settings, update, updateNotification } = useAppSettings()
  const { clearAuth }  = useAuthStore()
  const navigate       = useNavigate()

  // ESC to close
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function close() {
    setOpen(false)
    setTimeout(() => setView('main'), 200)
  }

  function toggle() {
    if (open) { close() } else { setOpen(true) }
  }

  function handleLogout() {
    clearAuth()
    navigate('/login', { replace: true })
  }

  const dropdownStyle = {
    position: 'absolute', right: 0, top: 'calc(100% + 8px)',
    width: 300, zIndex: 9999,
    background: '#0d1a2d',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16,
    boxShadow: '0 0 0 1px rgba(0,0,0,0.4), 0 12px 48px rgba(0,0,0,0.6)',
    overflow: 'hidden',
    animation: 'accountMenuIn 0.15s ease-out',
  }

  const darkTriggerStyle = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '3px 10px 3px 3px',
    borderRadius: 99,
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.1)',
    cursor: 'pointer',
    transition: 'background 0.15s',
    outline: 'none',
  }

  return (
    <div style={{ position: 'relative' }} ref={triggerRef}>
      {/* Trigger — light variant */}
      {variant === 'light' && (
        <button
          onClick={toggle}
          aria-label="Аккаунт"
          aria-expanded={open}
          className="flex items-center gap-2 pl-1 pr-3 py-1.5 rounded-full bg-white/70 border border-slate-200/60 hover:bg-white transition-all duration-150"
        >
          <AvatarCircle initials={initials} role={role} size={28} />
          <span className="hidden sm:block text-[13px] font-medium text-slate-700 max-w-[120px] truncate">
            {fullName ?? phone}
          </span>
          <ChevronDown
            size={13}
            className="text-slate-400"
            style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0)' }}
          />
        </button>
      )}

      {/* Trigger — dark variant (dispatcher board) */}
      {variant === 'dark' && (
        <button
          onClick={toggle}
          aria-label="Аккаунт"
          aria-expanded={open}
          style={darkTriggerStyle}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
        >
          <AvatarCircle initials={initials} role={role} size={26} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fullName ?? phone}
          </span>
          <ChevronDown
            size={12}
            style={{ color: '#64748b', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0)', flexShrink: 0 }}
          />
        </button>
      )}

      {/* Backdrop */}
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={close} />
      )}

      {/* Dropdown */}
      {open && (
        <div ref={panelRef} style={dropdownStyle}>
          {view === 'main' && (
            <MainView
              fullName={fullName}
              phone={phone}
              role={role}
              initials={initials}
              theme={theme}
              onToggleTheme={toggleTheme}
              onGo={setView}
            />
          )}
          {view === 'profile' && (
            <ProfileView
              onBack={() => setView('main')}
              fullName={fullName}
              phone={phone}
              role={role}
              employee={employee}
              userId={userId}
            />
          )}
          {view === 'settings' && (
            <SettingsView
              onBack={() => setView('main')}
              settings={settings}
              onUpdate={update}
            />
          )}
          {view === 'notifications' && (
            <NotificationsView
              onBack={() => setView('main')}
              settings={settings}
              onUpdateNotif={updateNotification}
            />
          )}
          {view === 'logout' && (
            <LogoutView
              onBack={() => setView('main')}
              onConfirm={handleLogout}
            />
          )}
        </div>
      )}
    </div>
  )
}
