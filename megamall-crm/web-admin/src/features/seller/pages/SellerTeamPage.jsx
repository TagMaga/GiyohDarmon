import { useSellerTeamRank } from '../hooks/useSellerMe'
import { Trophy, Star, Medal } from 'lucide-react'

const RANK_CONFIG = [
  { rank: 1, icon: Trophy,  bg: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)', iconBg: '#F59E0B', label: '1 место', text: 'Лидер команды' },
  { rank: 2, icon: Star,    bg: 'linear-gradient(135deg,#F8FAFC,#F1F5F9)', iconBg: '#64748B', label: '2 место', text: 'Отличная работа' },
  { rank: 3, icon: Medal,   bg: 'linear-gradient(135deg,#FFF7ED,#FFEDD5)', iconBg: '#D97706', label: '3 место', text: 'Бронза команды' },
]

export default function SellerTeamPage() {
  const { data: rankData, isLoading } = useSellerTeamRank()

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="card h-48 animate-pulse" />
        <div className="card h-24 animate-pulse" />
      </div>
    )
  }

  const rank = rankData?.rank ?? null
  const totalMembers = rankData?.total_members ?? null
  const cfg = rank ? (RANK_CONFIG.find(c => c.rank === rank) ?? null) : null

  if (rank === null) {
    return (
      <div className="card p-10 text-center">
        <Trophy size={32} className="mx-auto mb-3 text-slate-200" />
        <p className="text-sm text-slate-400">Данные рейтинга недоступны</p>
      </div>
    )
  }

  const Icon = cfg?.icon ?? Trophy
  const heroText = rank === 1
    ? 'Вы #1 в команде!'
    : `Вы #${rank} в команде`

  return (
    <div className="space-y-4">
      {/* ── Rank hero card ───────────────────────────────────────────────── */}
      <div
        className="rounded-[24px] p-8 text-center"
        style={{
          background: cfg?.bg ?? 'linear-gradient(135deg,#EEF2FF,#E0E7FF)',
          boxShadow: '0 2px 8px rgba(16,24,40,0.06), 0 16px 40px rgba(16,24,40,0.08)',
        }}
      >
        {/* Icon circle */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{
            background: cfg?.iconBg ?? '#4F46E5',
            boxShadow: `0 8px 24px ${cfg?.iconBg ?? '#4F46E5'}55`,
          }}
        >
          <Icon size={32} color="white" strokeWidth={2} />
        </div>

        {/* Rank number */}
        <p
          className="text-6xl font-black tracking-tight leading-none"
          style={{ color: cfg?.iconBg ?? '#4F46E5' }}
        >
          #{rank}
        </p>

        {/* Hero text */}
        <p className="text-xl font-bold text-slate-900 mt-3">{heroText}</p>
        {cfg && <p className="text-sm text-slate-500 mt-1">{cfg.text}</p>}

        {/* Team size */}
        {totalMembers && (
          <div
            className="inline-flex items-center gap-2 mt-5 px-4 py-2 rounded-full"
            style={{ background: 'rgba(0,0,0,0.06)' }}
          >
            <span className="text-sm font-semibold text-slate-600">
              В команде: {totalMembers} человек
            </span>
          </div>
        )}
      </div>

      {/* ── Caption ──────────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl px-4 py-3"
        style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(226,232,240,0.7)' }}
      >
        <p className="text-xs text-slate-500 text-center">
          Рейтинг рассчитывается по чистой выручке за текущий месяц.
          Чем больше успешных доставок — тем выше позиция.
        </p>
      </div>
    </div>
  )
}
