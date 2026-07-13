import { useNavigate } from 'react-router-dom'
import { Truck, Smartphone, LogOut } from 'lucide-react'
import useAuthStore from '../store/authStore'
import useProfile   from '../hooks/useProfile'

const DOWNLOAD_PAGE = '/courier-app-download.html'

/**
 * CourierAppNotice — shown at /courier instead of a web dashboard.
 *
 * Couriers work exclusively from the mobile app; the web panel that used to
 * live here has been removed. This is a standalone full-screen page (no
 * Layout/Sidebar — courier has no other pages to navigate to).
 */
export default function CourierAppNotice() {
  const navigate           = useNavigate()
  const { clearAuth }      = useAuthStore()
  const { fullName }       = useProfile()

  function handleLogout() {
    clearAuth()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm text-center animate-fade-in">
        <div className="w-16 h-16 mx-auto bg-indigo-50 rounded-3xl flex items-center justify-center mb-5">
          <Truck size={28} className="text-indigo-500" />
        </div>

        <h1 className="text-xl font-bold text-slate-900 mb-2">
          {fullName ? `Привет, ${fullName.split(' ')[0]}!` : 'Привет!'}
        </h1>
        <p className="text-sm text-slate-500 max-w-xs mx-auto mb-1">
          Курьеры MegaMall работают через мобильное приложение — заказы, статусы
          доставки и сдача наличных доступны только там.
        </p>
        <p className="text-sm text-slate-500 max-w-xs mx-auto mb-7">
          Веб-версия для курьеров больше не используется.
        </p>

        <a
          href={DOWNLOAD_PAGE}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary btn-lg w-full mb-3"
        >
          <Smartphone size={16} />
          Скачать приложение
        </a>

        <button onClick={handleLogout} className="btn btn-secondary btn-md w-full">
          <LogOut size={15} />
          Выйти из системы
        </button>
      </div>
    </div>
  )
}
