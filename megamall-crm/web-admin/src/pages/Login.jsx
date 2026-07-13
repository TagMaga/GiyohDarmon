import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { jwtDecode } from 'jwt-decode'
import { ShoppingBag, AlertCircle, Loader2 } from 'lucide-react'
import { login } from '../shared/api/auth'
import useAuthStore from '../shared/store/authStore'
import PasswordInput from '../shared/components/PasswordInput'
import { ROLE_HOME } from '../app/router'

/**
 * Extract the role claim from a JWT without server round-trip.
 * Returns null if the token is malformed or has no role claim.
 */
function decodeRole(token) {
  try {
    const payload = jwtDecode(token)
    // Backend sets claim as "role" (snake_case string)
    return payload.role ?? null
  } catch {
    return null
  }
}

export default function Login() {
  const [phone,       setPhone]       = useState('')
  const [password,    setPassword]    = useState('')
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(false)

  const { setAuth, token, role, _hasHydrated } = useAuthStore()
  const navigate = useNavigate()

  // Redirect already-authenticated users away from /login
  useEffect(() => {
    if (_hasHydrated && token && role) {
      const home = ROLE_HOME[role] ?? '/'
      navigate(home, { replace: true })
    }
  }, [_hasHydrated, token, role, navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!phone.trim())    return setError('Введите номер телефона')
    if (!password.trim()) return setError('Введите пароль')

    setLoading(true)
    try {
      const res        = await login(phone.trim(), password)
      const { access_token, refresh_token } = res.data.data

      const decodedRole = decodeRole(access_token)
      if (!decodedRole) {
        setError('Не удалось определить роль пользователя. Обратитесь к администратору.')
        return
      }

      setAuth(access_token, refresh_token, decodedRole, phone.trim())
      navigate(ROLE_HOME[decodedRole] ?? '/', { replace: true })
    } catch (err) {
      const msg = err?.response?.data?.error?.message
      if (err?.response?.status === 401 || err?.response?.status === 400) {
        setError('Неверный номер телефона или пароль')
      } else if (msg) {
        setError(msg)
      } else {
        setError('Сервер недоступен. Проверьте соединение.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
         style={{
           background: '#F2F4F7',
           backgroundImage: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99,102,241,0.10) 0%, transparent 100%)',
         }}>

      {/* Card */}
      <div className="w-full max-w-[400px] animate-fade-in">

        {/* Brand */}
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
          <p className="text-[14px] text-slate-500 mt-1">Панель управления</p>
        </div>

        {/* Form card */}
        <div className="card p-7">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Вход в систему</h2>
          <p className="text-sm text-slate-500 mb-6">Введите данные учётной записи</p>

          {/* Error banner */}
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
              <p className="text-[13px] text-red-700 leading-snug">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {/* Phone */}
            <div className="mb-4">
              <label className="input-label">Номер телефона</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError('') }}
                placeholder="+992 900 000 000"
                className="input"
                autoComplete="username"
                autoFocus
                disabled={loading}
              />
            </div>

            {/* Password */}
            <div className="mb-6">
              <label className="input-label">Пароль</label>
              <PasswordInput
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                placeholder="••••••••"
                className="input"
                autoComplete="current-password"
                disabled={loading}
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="btn-lg btn-primary w-full"
            >
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> Вход…</>
                : 'Войти'}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-6">
          MegaMall CRM &mdash; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
