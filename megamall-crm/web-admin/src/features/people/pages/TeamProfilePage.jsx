import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate }       from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Edit2, PowerOff, Users2, ShoppingCart, TrendingUp,
  Layers, Building2,
} from 'lucide-react'

import Badge             from '../../../shared/components/Badge'
import Button            from '../../../shared/components/Button'
import Alert             from '../../../shared/components/Alert'
import Modal             from '../../../shared/components/Modal'
import { CardSkeleton }  from '../../../shared/components/Skeleton'
import { useToast }      from '../../../shared/components/ToastProvider'

import useTeams          from '../hooks/useTeams'
import useTeamMembers    from '../hooks/useTeamMembers'
import useTeamConfigs    from '../hooks/useTeamConfigs'
import useEmployees      from '../hooks/useEmployees'
import useConfigs        from '../../hr/hooks/useConfigs'
import usePayables       from '../../team-lead/hooks/usePayables'

import { updateTeam, deleteTeam, fetchTeamOrders } from '../api'
import { KEYS }                   from '../../../shared/queryKeys'
import {
  buildUserMap, fmtMoney, fmtPct,
  ROLE_LABEL, calcPerformance, isConfigActive,
} from '../utils/peopleHelpers'
import PeriodRangeFilter from '../../../shared/components/PeriodRangeFilter'

// ─────────────────────────────────────────────────────────────────────────────
// Date range helpers
// ─────────────────────────────────────────────────────────────────────────────
function toYMD(d) {
  const year  = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day   = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Default range: start of the current month → today.
function defaultDateRange() {
  const now = new Date()
  return { from: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), to: toYMD(now) }
}

// "YYYY-MM-DD" → local Date (avoids the UTC-parsing day shift of `new Date(str)`).
function parseYMD(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatRangeLabel(from, to) {
  if (!from || !to) return 'Период'
  const opts = { day: 'numeric', month: 'short' }
  return `${parseYMD(from).toLocaleDateString('ru-RU', opts)} – ${parseYMD(to).toLocaleDateString('ru-RU', opts)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Status config for member cards (mirrors TeamDirectoryPage's STATUS_CFG)
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_CFG = {
  online:     { label: 'Online',     color: '#3DD68C' },
  away:       { label: 'Away',       color: '#F0B23D' },
  offline:    { label: 'Offline',    color: '#6B7280' },
  vacation:   { label: 'В отпуске',  color: '#9B8CFF' },
  sick:       { label: 'Больничный', color: '#FF6B5B' },
  terminated: { label: 'Уволен',     color: '#6B7280' },
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
}

function avatarSrc(person) {
  if (!person?.avatar_url) return null
  return `${person.avatar_url}?t=${person.updated_at ?? ''}`
}

function Avatar({ person, size = 44, gradient = 'linear-gradient(135deg,#4f46e5,#818cf8)' }) {
  const photo = avatarSrc(person)
  if (photo) {
    return (
      <img
        src={photo}
        alt={person.full_name}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white flex-shrink-0"
      style={{ width: size, height: size, background: gradient, fontSize: size * 0.32 }}
    >
      {initials(person?.full_name).toUpperCase()}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EditTeamModal
// ─────────────────────────────────────────────────────────────────────────────
function EditTeamModal({ open, onClose, team, users }) {
  const qc       = useQueryClient()
  const toast    = useToast()
  const navigate = useNavigate()

  const [name,       setName]       = useState('')
  const [teamLeadId, setTeamLeadId] = useState('')
  const [managerId,  setManagerId]  = useState('')
  const [isActive,   setIsActive]   = useState(true)

  useEffect(() => {
    if (team) {
      setName(team.name ?? '')
      setTeamLeadId(team.team_lead_id ?? '')
      setManagerId(team.manager_id   ?? '')
      setIsActive(team.is_active !== false)
    }
  }, [team])

  const leads    = users.filter(u => ['sales_team_lead'].includes(u.role ?? u.Role ?? ''))
  const managers = users.filter(u => ['manager'].includes(u.role ?? u.Role ?? ''))

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error('Название обязательно')
      return updateTeam(team.id, {
        name:         name.trim(),
        team_lead_id: teamLeadId || undefined,
        manager_id:   managerId  || undefined,
        is_active:    isActive,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.people.team(team.id) })
      qc.invalidateQueries({ queryKey: ['people', 'teams'] })
      qc.invalidateQueries({ queryKey: ['people'] })
      toast.success('Команда обновлена')
      const trimmed = name.trim()
      reset()
      onClose()
      // The route key is the team name — jump to the new URL if it changed.
      if (trimmed && trimmed !== team.name) {
        navigate(`/owner/teams/${encodeURIComponent(trimmed)}`, { replace: true })
      }
    },
  })

  const handleClose = () => { reset(); onClose() }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Редактировать команду"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button variant="primary"   onClick={() => mutate()} loading={isPending}>Сохранить</Button>
        </>
      }
    >
      {error && (
        <Alert variant="error" className="mb-4">
          {error.response?.data?.error?.message ?? error.message}
        </Alert>
      )}
      <div className="space-y-4">
        <div>
          <label className="input-label">Название *</label>
          <input value={name} onChange={e => setName(e.target.value)} className="input mt-1" />
        </div>
        <div>
          <label className="input-label">Руководитель группы</label>
          <select value={teamLeadId} onChange={e => setTeamLeadId(e.target.value)} className="input mt-1">
            <option value="">Без руководителя</option>
            {leads.map(u => (
              <option key={u.id} value={u.id}>{u.full_name ?? u.FullName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="input-label">Менеджер</label>
          <select value={managerId} onChange={e => setManagerId(e.target.value)} className="input mt-1">
            <option value="">Без менеджера</option>
            {managers.map(u => (
              <option key={u.id} value={u.id}>{u.full_name ?? u.FullName}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
          <input
            type="checkbox"
            checked={isActive}
            onChange={e => setIsActive(e.target.checked)}
            className="w-4 h-4 rounded accent-indigo-600"
          />
          <span className="text-sm text-slate-700">Активна</span>
        </label>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DeactivateTeamModal
// ─────────────────────────────────────────────────────────────────────────────
function DeactivateTeamModal({ open, onClose, team, memberCount }) {
  const qc       = useQueryClient()
  const toast    = useToast()
  const navigate = useNavigate()

  const hasMembers = memberCount > 0

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => deleteTeam(team.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['people', 'teams'] })
      qc.invalidateQueries({ queryKey: ['people'] })
      toast.success(`Команда «${team.name}» деактивирована`)
      reset()
      onClose()
      navigate('/owner/team-directory', { replace: true })
    },
  })

  const handleClose = () => { reset(); onClose() }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Деактивировать команду"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button variant="danger"    onClick={() => mutate()} loading={isPending}>
            Деактивировать
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <Alert variant="error">
            {error.response?.data?.error?.message ?? error.message}
          </Alert>
        )}

        {hasMembers && (
          <Alert variant="warning">
            В команде {memberCount} {memberCount === 1 ? 'участник' : 'участников'}.
            Деактивация команды не удаляет сотрудников, но они потеряют привязку к этой команде.
          </Alert>
        )}

        <p className="text-sm text-slate-700">
          Вы собираетесь деактивировать команду{' '}
          <span className="font-semibold">«{team?.name}»</span>.
        </p>
        <p className="text-sm text-slate-500">
          Это действие можно отменить позднее через редактирование команды.
          Исторические данные (заказы, правила начисления) сохранятся.
        </p>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI card
// ─────────────────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, iconBg, iconColor }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-4">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: iconBg, color: iconColor }}>
        {icon}
      </div>
      <p className="text-[20px] font-extrabold text-slate-900 leading-none tracking-tight truncate">{value}</p>
      <p className="text-xs font-medium text-slate-500 mt-1.5">{label}</p>
      {sub && <p className="text-[10.5px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Commission distribution card
// ─────────────────────────────────────────────────────────────────────────────
function CommissionDistributionCard({ sellerEarned, managerEarned, personalNet, companyShare, poolTotal, netBase, periodLabel }) {
  const hasCompany = companyShare != null && netBase != null && netBase > 0
  const base = hasCompany ? netBase : poolTotal

  const segments = [
    hasCompany ? { label: 'Компания',  amount: companyShare,  color: '#64748b' } : null,
    { label: 'Продавцы',  amount: sellerEarned,  color: '#34d399' },
    { label: 'Менеджеры', amount: managerEarned, color: '#a78bfa' },
    { label: 'Тимлид',    amount: personalNet,   color: '#fbbf24' },
  ].filter(Boolean)

  const pctOf = (n) => base > 0 ? `${Math.round((n / base) * 1000) / 10}%` : '0%'

  return (
    <div className="rounded-2xl p-6 mb-6 text-white" style={{ background: 'linear-gradient(150deg,#0f172a,#1e293b)' }}>
      <div className="flex flex-wrap items-start justify-between gap-5 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-indigo-300" />
            <h2 className="text-[15px] font-bold tracking-tight">Распределение комиссии</h2>
            <span className="text-[10.5px] font-semibold text-slate-400 bg-white/10 px-2.5 py-0.5 rounded-full">
              {periodLabel} · только чтение
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400 max-w-lg leading-relaxed">
            Компания начисляется только с заказов, где для команды настроена доля пула тимлида.
            Тимлид распределяет комиссии продавцам и менеджерам из своего пула.
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {hasCompany && (
            <div className="rounded-2xl px-4 py-3 min-w-[150px]" style={{ background: 'rgba(56,189,248,.1)', border: '1px solid rgba(56,189,248,.25)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-sky-300">Прибыль компании</p>
              <p className="text-xl font-extrabold mt-1">{fmtMoney(companyShare)}</p>
            </div>
          )}
          <div className="rounded-2xl px-4 py-3 min-w-[150px]" style={{ background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.25)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-300">Доход тимлида</p>
            <p className="text-xl font-extrabold mt-1">{fmtMoney(personalNet)}</p>
          </div>
        </div>
      </div>

      {!hasCompany && (
        <Alert variant="warning" className="mb-4 !bg-white/5 !border-white/10 !text-slate-300">
          Ставка пула руководителя не настроена — доля компании не может быть рассчитана. Настройте её через «Настроить комиссию».
        </Alert>
      )}

      <div className="flex h-3.5 rounded-full overflow-hidden mb-1.5" style={{ background: 'rgba(255,255,255,.08)' }}>
        {segments.map((s, i) => (
          <div key={i} style={{ width: pctOf(s.amount), background: s.color }} />
        ))}
      </div>
      <div className="flex justify-between text-[10.5px] text-slate-500 mb-5">
        <span>0</span>
        <span>база 100% = {fmtMoney(base)}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {hasCompany && (
          <Row color="#64748b" label="Доля компании" note="остаётся у компании" amount={companyShare} pct={pctOf(companyShare)} />
        )}
        <Row wide color="#818cf8" label="Начислено команде" note="продавцы + менеджеры + тимлид" amount={poolTotal} pct={hasCompany ? pctOf(poolTotal) : '100%'} />
        <Row color="#34d399" label="Комиссии продавцов" note="выплачивает тимлид из пула" amount={sellerEarned} pct={pctOf(sellerEarned)} />
        <Row color="#a78bfa" label="Комиссии менеджеров" note="выплачивает тимлид из пула" amount={managerEarned} pct={pctOf(managerEarned)} />
        <Row wide color="#fbbf24" label="Итоговый доход тимлида" note="пул минус выплаты команде" amount={personalNet} pct={pctOf(personalNet)} />
      </div>
    </div>
  )
}

function Row({ color, label, note, amount, pct, wide }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 ${wide ? 'sm:col-span-2' : ''}`} style={{ background: 'rgba(255,255,255,.04)' }}>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: color }} />
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-slate-200 truncate">{label}</p>
          <p className="text-[10.5px] text-slate-500 truncate">{note}</p>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[14px] font-extrabold text-white">{fmtMoney(amount)}</p>
        <p className="text-[10px] text-slate-500">{pct}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead hero card
// ─────────────────────────────────────────────────────────────────────────────
function LeadHeroCard({ lead, ordersCount, revenue, personalNet }) {
  if (!lead) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-6 text-center mb-3.5">
        <p className="text-sm font-semibold text-slate-500">Руководитель группы не назначен</p>
        <p className="text-xs text-slate-400 mt-1">Назначьте тимлида, чтобы видеть его доход и распределение комиссии.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-white border border-indigo-200/70 shadow-sm p-5 mb-3.5 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3.5">
        <Avatar person={lead} size={52} />
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[16px] font-extrabold text-slate-900">{lead.full_name}</span>
            <Badge variant="indigo">Тимлид · получает выплату</Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1">Руководитель группы · распределяет комиссии команде</p>
        </div>
      </div>
      <div className="flex gap-6 text-center">
        <div>
          <p className="text-lg font-extrabold text-slate-900 leading-none">{ordersCount}</p>
          <p className="text-[10.5px] text-slate-400 mt-1">заказов</p>
        </div>
        <div>
          <p className="text-lg font-extrabold text-slate-900 leading-none">{fmtMoney(revenue)}</p>
          <p className="text-[10.5px] text-slate-400 mt-1">выручка</p>
        </div>
        <div>
          <p className="text-lg font-extrabold text-amber-500 leading-none">{fmtMoney(personalNet)}</p>
          <p className="text-[10.5px] text-slate-400 mt-1">личный доход</p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Member card (grid)
// ─────────────────────────────────────────────────────────────────────────────
function MemberCard({ person, ordersCount, revenue, commission }) {
  const status = STATUS_CFG[person.status ?? 'offline'] ?? STATUS_CFG.offline
  return (
    <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-3.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex-shrink-0">
            <Avatar person={person} size={42} gradient={person.role === 'manager' ? 'linear-gradient(135deg,#7c3aed,#a78bfa)' : 'linear-gradient(135deg,#059669,#34d399)'} />
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white" style={{ background: status.color }} />
          </div>
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold text-slate-900 truncate">{person.full_name}</p>
            <p className="text-[11px] text-slate-400 font-medium">{ROLE_LABEL[person.role] ?? person.role}</p>
          </div>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ color: status.color, background: `${status.color}18` }}>
          {status.label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-50 text-center">
        <div>
          <p className="text-[14px] font-extrabold text-slate-900">{ordersCount}</p>
          <p className="text-[9.5px] text-slate-400 mt-0.5">заказы</p>
        </div>
        <div>
          <p className="text-[13px] font-extrabold text-slate-900 truncate">{fmtMoney(revenue)}</p>
          <p className="text-[9.5px] text-slate-400 mt-0.5">выручка</p>
        </div>
        <div>
          <p className="text-[13px] font-extrabold text-emerald-600 truncate">{fmtMoney(commission)}</p>
          <p className="text-[9.5px] text-slate-400 mt-0.5">комиссия</p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TeamProfilePage
// ─────────────────────────────────────────────────────────────────────────────
export default function TeamProfilePage() {
  const { teamName } = useParams()
  const navigate   = useNavigate()
  const decodedName = decodeURIComponent(teamName ?? '')

  const [dateRange,      setDateRange]      = useState(defaultDateRange)
  const [showEdit,       setShowEdit]       = useState(false)
  const [showDeactivate, setShowDeactivate] = useState(false)

  // Teams are looked up by name (route is /owner/teams/:teamName) — there is
  // no single-team-by-id endpoint, so we find it inside the already-fetched list.
  const { data: allTeams = [], isLoading: teamsLoading } = useTeams()
  const team   = allTeams.find(t => t.name === decodedName)
  const teamId = team?.id

  const { data: memberRows = [], isLoading: membersLoading }             = useTeamMembers(teamId)
  const { data: teamConfigs = [], isLoading: configsLoading }            = useTeamConfigs(teamId)
  const { data: globalConfigs = [] }                                     = useConfigs()
  const { data: allEmployees = [] }                                      = useEmployees()

  const userMap = useMemo(() => buildUserMap(allEmployees), [allEmployees])

  const { from, to } = dateRange
  const periodLabel  = formatRangeLabel(from, to)

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: KEYS.people.teamOrders(teamId ?? decodedName, { from, to }),
    queryFn:  () => fetchTeamOrders(team?.team_lead_id, { from, to }),
    enabled:  !!team?.team_lead_id,
  })

  const { data: payables, isLoading: payablesLoading } = usePayables(team?.team_lead_id, { from, to })

  // ── Loading / error states ───────────────────────────────────────────────
  if (teamsLoading) return (
    <div className="p-4 md:p-6 space-y-4">
      <CardSkeleton /><CardSkeleton /><CardSkeleton />
    </div>
  )

  if (!team) return (
    <div className="p-4 md:p-6">
      <Alert variant="error">Команда не найдена</Alert>
      <Button variant="secondary" onClick={() => navigate('/owner/team-directory')} className="mt-3">
        Назад
      </Button>
    </div>
  )

  const lead = team.team_lead_id ? userMap[team.team_lead_id] : null

  // ── Roster (managers + sellers, excluding the lead) ─────────────────────
  const memberIds     = memberRows.map(r => r.user_id).filter(id => id && id !== team.team_lead_id)
  const rosterMembers = memberIds.map(id => userMap[id]).filter(Boolean)
  const teamMembers   = rosterMembers.filter(u => u.role === 'manager' || u.role === 'seller')
  const managerCount  = teamMembers.filter(u => u.role === 'manager').length
  const sellerCount   = teamMembers.filter(u => u.role === 'seller').length

  // ── Orders / revenue for the period ─────────────────────────────────────
  const perf = calcPerformance(orders)

  // ── Payables → real earned/gross per member + team totals ──────────────
  const payableMembers = payables?.members ?? []
  const payMap = {}
  payableMembers.forEach(p => { payMap[p.payee_id] = p })

  const sellerEarned  = payableMembers.filter(m => m.role === 'seller').reduce((s, m) => s + m.earned, 0)
  const managerEarned = payableMembers.filter(m => m.role === 'manager').reduce((s, m) => s + m.earned, 0)
  const personalNet   = payables?.personal_net ?? 0
  const poolTotal     = sellerEarned + managerEarned + personalNet

  // ── Best-effort company/pool split (real distributed amount ÷ configured pool rate) ─
  const activeTeamConfigs   = teamConfigs.filter(isConfigActive)
  const activeGlobalConfigs = globalConfigs.filter(c => c.scope === 'global' && isConfigActive(c))
  const poolRate = activeTeamConfigs.find(c => c.commission_type === 'team_lead_pool_rate')?.rate
    ?? activeGlobalConfigs.find(c => c.commission_type === 'team_lead_pool_rate')?.rate
    ?? null
  const netBase      = poolRate ? poolTotal / poolRate : null
  const companyShare = netBase != null ? netBase - poolTotal : null

  const memberStats = teamMembers.map(u => {
    const p = payMap[u.id]
    return {
      person:      u,
      ordersCount: p?.orders_count ?? 0,
      revenue:     p?.gross_amount ?? 0,
      commission:  p?.earned ?? 0,
    }
  })

  const anyDataLoading = membersLoading || ordersLoading || payablesLoading || configsLoading

  return (
    <div className="p-4 md:p-6 pb-16">
      {/* ── Back navigation ───────────────────────────────────────────── */}
      <button
        onClick={() => navigate('/owner/team-directory')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 min-h-[44px]"
      >
        <ArrowLeft size={15} /> Назад к командам
      </button>

      {/* ── Header identity card ──────────────────────────────────────── */}
      <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-5 mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#4f46e5,#6366f1)' }}>
              <Users2 size={24} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-extrabold text-slate-900 tracking-tight truncate">{team.name}</h1>
                <Badge variant={team.is_active !== false ? 'emerald' : 'slate'} dot>
                  {team.is_active !== false ? 'Активна' : 'Архив'}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-2 text-sm">
                <span className="text-slate-500">
                  Тимлид: <span className="font-semibold text-slate-800">{lead?.full_name ?? 'Не назначен'}</span>
                </span>
                <span className="text-slate-500"><b className="text-slate-900">{managerCount}</b> менеджера</span>
                <span className="text-slate-500"><b className="text-slate-900">{sellerCount}</b> продавцов</span>
                <span className="text-slate-500"><b className="text-slate-900">{orders.length}</b> заказов ({periodLabel})</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowEdit(true)}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
              title="Редактировать"
            >
              <Edit2 size={14} />
            </button>
            {team.is_active !== false && (
              <button
                onClick={() => setShowDeactivate(true)}
                className="w-9 h-9 rounded-xl bg-rose-50 hover:bg-rose-100 flex items-center justify-center text-rose-500 transition-colors"
                title="Деактивировать команду"
              >
                <PowerOff size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Period selector ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <h2 className="text-base font-bold text-slate-800">Показатели</h2>
        <PeriodRangeFilter
          from={from}
          to={to}
          align="right"
          onChange={(range) => setDateRange({ from: range.from, to: range.to })}
        />
      </div>

      {anyDataLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-[104px] rounded-2xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* ── KPI grid (4 real metrics) ─────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <KpiCard
              icon={<ShoppingCart size={17} />} iconBg="#e0e7ff" iconColor="#4f46e5"
              label={`Заказы (${periodLabel})`} value={orders.length}
            />
            <KpiCard
              icon={<TrendingUp size={17} />} iconBg="#d1fae5" iconColor="#059669"
              label="Выручка (доставлено)" value={fmtMoney(perf.revenue)}
            />
            <KpiCard
              icon={<Layers size={17} />} iconBg="#ede9fe" iconColor="#7c3aed"
              label="Начислено команде" value={fmtMoney(poolTotal)} sub="продавцы + менеджеры + тимлид"
            />
            <KpiCard
              icon={<Building2 size={17} />} iconBg="#e0f2fe" iconColor="#0284c7"
              label="Прибыль компании" value={companyShare != null ? fmtMoney(companyShare) : '—'}
              sub={companyShare != null ? `~${fmtPct(1 - (poolRate ?? 0))}` : 'ставка пула не настроена'}
            />
          </div>

          {/* ── Commission distribution ────────────────────────────────── */}
          <CommissionDistributionCard
            sellerEarned={sellerEarned}
            managerEarned={managerEarned}
            personalNet={personalNet}
            companyShare={companyShare}
            poolTotal={poolTotal}
            netBase={netBase}
            periodLabel={periodLabel}
          />
        </>
      )}

      {/* ── Team section ──────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-base font-bold text-slate-800">Команда</h2>
          <span className="text-xs text-slate-400 font-medium">
            {lead ? '1 тимлид · ' : ''}{managerCount} менеджера · {sellerCount} продавцов
          </span>
        </div>

        <LeadHeroCard lead={lead} ordersCount={orders.length} revenue={perf.revenue} personalNet={personalNet} />

        {membersLoading || payablesLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-[150px] rounded-2xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : memberStats.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-slate-400 text-sm">
            В команде пока нет менеджеров или продавцов.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {memberStats.map(m => (
              <MemberCard key={m.person.id} person={m.person} ordersCount={m.ordersCount} revenue={m.revenue} commission={m.commission} />
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────── */}
      <EditTeamModal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        team={team}
        users={allEmployees}
      />
      <DeactivateTeamModal
        open={showDeactivate}
        onClose={() => setShowDeactivate(false)}
        team={team}
        memberCount={teamMembers.length}
      />
    </div>
  )
}
