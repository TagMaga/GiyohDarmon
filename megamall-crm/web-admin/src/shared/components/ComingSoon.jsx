import { useNavigate, useLocation } from 'react-router-dom'
import { Zap, ArrowLeft } from 'lucide-react'

/**
 * ComingSoon — shown for sidebar links that haven't been implemented yet.
 * Phase 8 will replace these with real pages.
 */
export default function ComingSoon() {
  const navigate  = useNavigate()
  const location  = useLocation()

  return (
    <div className="animate-fade-in flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-16 h-16 bg-indigo-50 rounded-3xl flex items-center justify-center mb-5">
        <Zap size={28} className="text-indigo-500" />
      </div>
      <h2 className="text-xl font-bold text-slate-900 mb-2">Раздел в разработке</h2>
      <p className="text-sm text-slate-500 max-w-sm mb-1">
        Страница <code className="text-indigo-600 font-mono text-xs">{location.pathname}</code> будет
        доступна в следующем обновлении.
      </p>
      <p className="text-xs text-slate-400 mb-7">
        Полный функционал запланирован в Phase 8.
      </p>
      <button
        onClick={() => navigate(-1)}
        className="btn-md btn-secondary"
      >
        <ArrowLeft size={15} />
        Назад
      </button>
    </div>
  )
}
