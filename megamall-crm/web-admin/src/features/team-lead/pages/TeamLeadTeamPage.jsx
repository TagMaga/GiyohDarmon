/**
 * TeamLeadTeamPage — /team-lead/team ("Команда")
 *
 * Teamlead Panel Redesign: mobile shows a single flat ranking list (matching
 * the mockup, reached via Профиль → Команда); desktop keeps the existing
 * Менеджеры/Продавцы sub-tabs since it has room for them and they're useful
 * filtering, not just visual — dropping them would be a functionality
 * regression the mockup never asked for (its mock scenario simply has no
 * manager).
 *
 * Row tap now navigates to /team-lead/team/:payeeId (TeamLeadSellerFinanceDetailPage)
 * instead of opening the old MemberDetailSheet modal — same usePayables()
 * source of truth, just a real page instead of a sheet.
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, ChevronRight } from 'lucide-react'
import Badge             from '../../../shared/components/Badge'
import EmptyState        from '../../../shared/components/EmptyState'
import { CardSkeleton }  from '../../../shared/components/Skeleton'
import { fmtAmount }     from '../../../shared/orderStatusConfig'
import useCurrentUser    from '../../../shared/hooks/useCurrentUser'
import usePayables       from '../hooks/usePayables'
import { M, MobileShell, Card, InitialsAvatar, SectionLabel } from '../../seller/components/mobileUi'

function toYMD(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const ROLE_LABEL = { manager: 'Менеджер', seller: 'Продавец' }
const ROLE_BADGE = { manager: 'indigo', seller: 'violet' }

function RankBadge({ rank }) {
  const isFirst = rank === 1
  return (
    <span
      className="flex items-center justify-center flex-shrink-0"
      style={{
        width: 22, height: 22, borderRadius: 7, fontSize: 12, fontWeight: 800,
        background: isFirst ? '#FEF3C7' : '#F0EFEA',
        color: isFirst ? '#B45309' : '#76766E',
      }}
    >
      {rank}
    </span>
  )
}

function MobileMemberRow({ member, rank, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-[11px] text-left"
      style={{ padding: '13px 15px' }}
    >
      <RankBadge rank={rank} />
      <InitialsAvatar name={member.full_name} size={36} palette={rank - 1} />
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>{member.full_name}</div>
        <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>
          {ROLE_LABEL[member.role] ?? member.role} · {member.orders_count} заказ{member.orders_count === 1 ? '' : 'ов'}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <span style={{ fontSize: 12.5, fontWeight: 700, color: M.ink }}>{fmtAmount(member.earned)} с</span>
      </div>
      <ChevronRight size={16} style={{ color: '#C7C5BC' }} className="flex-shrink-0" />
    </button>
  )
}

function DesktopMemberRow({ member, onClick }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow" onClick={onClick}>
      <InitialsAvatar name={member.full_name} size={44} radius={16} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-900 truncate">{member.full_name}</p>
          <Badge variant={ROLE_BADGE[member.role] ?? 'slate'} size="sm">{ROLE_LABEL[member.role] ?? member.role}</Badge>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          Заказов: <b className="text-slate-600">{member.orders_count}</b> · Доход за период: <b className="text-slate-600">{fmtAmount(member.earned)} смн</b>
        </p>
      </div>
      <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
    </div>
  )
}

export default function TeamLeadTeamPage() {
  const [subTab, setSubTab] = useState('all')
  const { userId } = useCurrentUser()
  const navigate = useNavigate()

  const now  = new Date()
  const from = toYMD(new Date(now.getFullYear(), now.getMonth(), 1))
  const to   = toYMD(now)

  const { data: payables, isLoading } = usePayables(userId, { from, to })
  const members  = payables?.members ?? []
  const managers = members.filter(m => m.role === 'manager')
  const sellers  = members.filter(m => m.role === 'seller')
  const list     = subTab === 'manager' ? managers : subTab === 'seller' ? sellers : members

  const ranked = useMemo(
    () => [...members].sort((a, b) => (b.orders_count ?? 0) - (a.orders_count ?? 0)),
    [members]
  )

  function openDetail(payeeId) {
    navigate(`/team-lead/team/${payeeId}`)
  }

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP LAYOUT
      ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:block p-4 md:p-6 space-y-4 min-h-screen" style={{ background: M.bg, fontFamily: M.font }}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: M.ink }}>Команда</h1>
          <p className="text-xs" style={{ color: M.muted }}>Все / Менеджеры / Продавцы · только ваша команда · текущий месяц</p>
        </div>

        <div
          className="flex gap-1 rounded-2xl p-1 shadow-[0_10px_30px_rgba(15,23,42,0.04)]"
          style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(226,232,240,0.6)' }}
        >
          {[
            { id: 'all',     label: `Все · ${members.length}` },
            { id: 'manager', label: `Менеджеры · ${managers.length}` },
            { id: 'seller',  label: `Продавцы · ${sellers.length}` },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
              style={subTab === t.id
                ? { background: M.dark, color: '#fff', boxShadow: '0 8px 18px rgba(15,23,42,0.16)' }
                : { color: '#94A3B8' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <CardSkeleton key={i} />)}</div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Users size={22} />}
            title={subTab === 'manager' ? 'Нет менеджеров в команде' : subTab === 'seller' ? 'Нет продавцов в команде' : 'Команда пуста'}
            description="Добавьте сотрудника через HR-панель, чтобы он появился здесь."
          />
        ) : (
          <div className="space-y-3">
            {list.map(m => (
              <DesktopMemberRow key={m.payee_id} member={m} onClick={() => openDetail(m.payee_id)} />
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          MOBILE LAYOUT — Teamlead Panel Redesign
      ═══════════════════════════════════════════════════════════ */}
      <MobileShell>
        <div className="px-5">
          <h1 style={{ fontSize: 20, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', margin: 0, paddingTop: 8 }}>Команда</h1>
          <div style={{ fontSize: 12, color: M.muted, fontWeight: 500, marginTop: 2 }}>{members.length} участников</div>

          <SectionLabel style={{ margin: '18px 4px 10px' }}>Рейтинг команды</SectionLabel>

          {isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: M.border }} />)}</div>
          ) : ranked.length === 0 ? (
            <Card style={{ padding: 24, textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: M.muted }}>Команда пуста</p>
            </Card>
          ) : (
            <Card style={{ overflow: 'hidden' }}>
              {ranked.map((m, i) => (
                <div key={m.payee_id} style={{ borderBottom: i < ranked.length - 1 ? `1px solid ${M.bg}` : 'none' }}>
                  <MobileMemberRow member={m} rank={i + 1} onClick={() => openDetail(m.payee_id)} />
                </div>
              ))}
            </Card>
          )}
        </div>
      </MobileShell>
    </>
  )
}
