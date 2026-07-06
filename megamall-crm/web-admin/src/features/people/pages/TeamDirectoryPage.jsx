/**
 * TeamDirectoryPage — /owner/team-directory
 *
 * List view  : grid of person cards (avatar, name, role, team tag, status chip, tenure)
 * Detail view: full profile with photo upload, status change, salary/commission display & edit
 *
 * Data sources:
 *   GET /users                      — employee list
 *   GET /teams                      — team list (for colour tags)
 *   GET /hierarchy/team/:id/members — member→team mapping
 *   GET /hr/compensation/employees/:id/salary — fixed salary / compensation
 *   GET /hr/compensation/employees/:id        — commission configs
 *   POST /users/:id/avatar          — photo upload
 *   PATCH /users/:id                — status / profile update
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useQueryClient, useQuery, useMutation, useQueries } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Search, X, ChevronLeft, Edit2, Upload, Phone,
  MapPin, Calendar, Briefcase, Clock, Users,
  TrendingUp, Plus, Trash2, ShoppingCart, WalletCards, Crown,
} from 'lucide-react'

import {
  fetchEmployees, fetchTeams, fetchTeamMembers,
  fetchTeamOrders,
  fetchEmployeeCompensation, fetchEmployeeCompensationHistory,
  fetchEmployeeConfigs, fetchEmployeeConfigHistory, fetchTeamConfigs,
  fetchGlobalRates, createConfig, disableConfig,
  updateEmployee, uploadUserAvatar,
  uploadFile, fetchUserDocuments, createUserDocument, deleteUserDocument,
  updateUserDocumentStatus, fetchUserHistory, fetchAllUserHistory,
} from '../api'
import {
  fetchCourierTariffs, createCourierTariff, deleteCourierTariff,
} from '../../dispatcher/api'
import { ALL_ROLES, ROLE_LABEL, COMMISSION_TYPE_LABEL, fmtDate, fmtMoney, fmtPct, isConfigActive } from '../utils/peopleHelpers'
import Modal               from '../../../shared/components/Modal'
import Button              from '../../../shared/components/Button'
import Alert               from '../../../shared/components/Alert'
import Badge               from '../../../shared/components/Badge'
import { useToast }        from '../../../shared/components/ToastProvider'
import AssignTeamModal     from '../components/AssignTeamModal'

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG = {
  online:     { label: 'Online',       color: '#3DD68C', dot: 'online',  pulse: true  },
  away:       { label: 'Away',         color: '#F0B23D', dot: 'away',    pulse: false },
  offline:    { label: 'Offline',      color: '#6B7280', dot: 'offline', pulse: false },
  vacation:   { label: 'В отпуске',    color: '#9B8CFF', dot: 'away',    pulse: false },
  sick:       { label: 'Больничный',   color: '#FF6B5B', dot: 'away',    pulse: false },
  terminated: { label: 'Уволен',       color: '#6B7280', dot: 'offline', pulse: false },
}

const STATUS_OPTIONS = Object.entries(STATUS_CFG).map(([key, cfg]) => ({ key, ...cfg }))
const PERSON_GRID_CLASS = 'grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-[7px]'

// Team colors — cycled when a team doesn't have a pre-assigned colour
const PALETTE = ['#2E6BFF', '#3DD68C', '#9B8CFF', '#F0B23D', '#FF6B5B', '#06B6D4', '#EC4899']

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name = '') {
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
}

function calcTenure(hireDateIso) {
  if (!hireDateIso) return null
  const start = new Date(hireDateIso)
  const now   = new Date()
  let months  = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (now.getDate() < start.getDate()) months -= 1
  if (months < 0) months = 0
  const yrs = Math.floor(months / 12)
  const rem = months % 12
  if (yrs === 0) return `${rem} мес.`
  if (rem === 0) return `${yrs} г.`
  return `${yrs} г. ${rem} мес.`
}

function calcAge(dobIso) {
  if (!dobIso) return null
  const d = new Date(dobIso)
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age -= 1
  return age
}

function avatarSrc(person) {
  if (!person?.avatar_url) return null
  return `${person.avatar_url}?t=${person.updated_at ?? ''}`
}

// Resolve commission label for the "salary" stat card
function normalizeGlobalRates(globalRates) {
  if (!globalRates) return {}
  return Object.fromEntries(
    Object.entries(globalRates)
      .filter(([, value]) => value?.commission_type)
      .map(([, value]) => [value.commission_type, { ...value, scope: 'global' }])
  )
}

function compensationLabel(comp, configs = [], globalByType = {}) {
  if (!comp && configs.length === 0 && Object.keys(globalByType).length === 0) return null
  if (comp) {
    const kind = comp.compensation_type
    if (kind === 'fixed')   return comp.fixed_salary != null ? `${Number(comp.fixed_salary).toLocaleString('ru-RU')} TJS / мес.` : null
    if (kind === 'percent') return comp.commission_rate != null ? `${(comp.commission_rate * 100).toFixed(1)}%` : null
    if (kind === 'mixed') {
      const parts = []
      if (comp.fixed_salary != null)    parts.push(`${Number(comp.fixed_salary).toLocaleString('ru-RU')} TJS`)
      if (comp.commission_rate != null) parts.push(`${(comp.commission_rate * 100).toFixed(1)}%`)
      return parts.join(' + ')
    }
  }
  // Fall back to active commission config
  const active = configs.find(c => c.is_active !== false && !c.effective_to)
  if (active) return `${(active.rate * 100).toFixed(1)}% (${COMMISSION_TYPE_LABEL[active.commission_type] ?? active.commission_type})`
  const globalActive = Object.values(globalByType)[0]
  if (globalActive) return `${(globalActive.rate * 100).toFixed(1)}% (${COMMISSION_TYPE_LABEL[globalActive.commission_type] ?? globalActive.commission_type})`
  return null
}

function orderAmount(order) {
  return Number(
    order?.net_revenue
    ?? order?.total_order_amount
    ?? order?.total_amount
    ?? order?.amount
    ?? 0
  ) || 0
}

function orderDate(order) {
  const raw = order?.delivered_at ?? order?.created_at ?? order?.updated_at
  const date = raw ? new Date(raw) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

function buildSevenDayTrend(orders = []) {
  const buckets = Array(7).fill(0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  orders.forEach(order => {
    const date = orderDate(order)
    if (!date) return
    date.setHours(0, 0, 0, 0)
    const diff = Math.round((today - date) / 86400000)
    if (diff >= 0 && diff < 7) buckets[6 - diff] += orderAmount(order)
  })

  return buckets
}

function lastSevenDays() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (6 - index))
    return date
  })
}

function chartDateLabel(date) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
    .format(date)
    .replace('.', '')
}

function linePoints(values = [], width = 260, height = 82, pad = 10) {
  const safe = values.length ? values : [0, 0, 0, 0, 0, 0, 0]
  const min = Math.min(...safe)
  const max = Math.max(...safe)
  return safe.map((value, index) => {
    const x = pad + index * ((width - pad * 2) / Math.max(safe.length - 1, 1))
    const y = pad + ((max - value) / Math.max(max - min, 1)) * (height - pad * 2)
    return [Math.round(x), Math.round(y)]
  })
}

function svgPath(points) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0]} ${point[1]}`).join(' ')
}

function svgArea(points, width = 260, height = 82) {
  return `${svgPath(points)} L ${points[points.length - 1][0]} ${height} L ${points[0][0]} ${height} Z`
}

function groupCardTone(index) {
  return [
    { icon: '#7C3AED', chart: '#22C7A5', pillBg: '#EDE9FE', pillText: '#6D28D9' },
    { icon: '#2F7DF6', chart: '#2F7DF6', pillBg: '#DBEAFE', pillText: '#2563EB' },
    { icon: '#FF7A00', chart: '#FF7A00', pillBg: '#FFEDD5', pillText: '#C2410C' },
    { icon: '#10B981', chart: '#22C7A5', pillBg: '#D1FAE5', pillText: '#059669' },
    { icon: '#FF3448', chart: '#FF3448', pillBg: '#FFE4E6', pillText: '#BE123C' },
  ][index % 5]
}

function historyDateValue(item) {
  const raw = item?.created_at ?? item?.effective_from ?? item?.effective_to
  const date = raw ? new Date(raw) : null
  return date && !Number.isNaN(date.getTime()) ? date : new Date(0)
}

function compensationHistoryText(item) {
  const parts = []
  if (item.compensation_type) {
    parts.push(COMP_KIND_LABEL[item.compensation_type] ?? item.compensation_type)
  }
  if (item.fixed_salary != null) {
    parts.push(fmtMoney(item.fixed_salary))
  }
  if (item.commission_rate != null) {
    parts.push(fmtPct(item.commission_rate))
  }
  return `Изменена оплата: ${parts.filter(Boolean).join(' · ') || 'настройка оплаты'}`
}

function commissionHistoryText(item) {
  const label = COMMISSION_TYPE_LABEL[item.commission_type] ?? item.commission_type
  const state = item.is_active === false || item.effective_to ? 'Закрыта ставка' : 'Изменена ставка'
  return `${state}: ${label} · ${fmtPct(item.rate)}`
}

function userHistoryText(item) {
  const oldValue = item.old_value ?? '—'
  const newValue = item.new_value ?? '—'
  if (item.field_name === 'role') {
    const from = ROLE_LABEL[item.old_value] ?? oldValue
    const to = ROLE_LABEL[item.new_value] ?? newValue
    return `Изменена должность: ${from} → ${to}`
  }
  if (item.field_name === 'status') {
    const from = STATUS_CFG[item.old_value]?.label ?? oldValue
    const to = STATUS_CFG[item.new_value]?.label ?? newValue
    return `Изменён статус: ${from} → ${to}`
  }
  if (item.field_name === 'is_active') {
    return `Изменён доступ: ${oldValue === 'true' ? 'Активный' : 'Неактивный'} → ${newValue === 'true' ? 'Активный' : 'Неактивный'}`
  }
  if (item.field_name === 'document_uploaded') {
    return `Загружен документ: ${newValue}`
  }
  if (item.field_name === 'document_deleted') {
    return `Удалён документ: ${oldValue}`
  }
  if (item.field_name === 'document_verified') {
    return `Проверен документ: ${newValue}`
  }
  if (item.field_name === 'document_rejected') {
    return `Отклонён документ: ${newValue}`
  }
  if (item.field_name === 'document_status') {
    return `Изменён статус документа: ${oldValue} → ${newValue}`
  }
  const labels = {
    full_name: 'ФИО',
    phone: 'Телефон',
    hire_date: 'Дата найма',
    date_of_birth: 'Дата рождения',
    address: 'Адрес',
    avatar_url: 'Фото профиля',
  }
  return `Изменено поле "${labels[item.field_name] ?? item.field_name}": ${oldValue} → ${newValue}`
}

function auditFieldLabel(field) {
  const labels = {
    full_name: 'ФИО',
    phone: 'Телефон',
    role: 'Должность',
    is_active: 'Доступ',
    avatar_url: 'Фото',
    status: 'Статус',
    hire_date: 'Дата найма',
    date_of_birth: 'Дата рождения',
    address: 'Адрес',
    document_uploaded: 'Документ загружен',
    document_deleted: 'Документ удалён',
    document_verified: 'Документ проверен',
    document_rejected: 'Документ отклонён',
    document_status: 'Статус документа',
  }
  return labels[field] ?? field
}

function buildEmployeeHistory({ person, salaryHistory = [], configHistory = [], userHistory = [], userMap = {} }) {
  const rows = [
    ...salaryHistory.map(item => ({
      id: `salary-${item.id}`,
      date: historyDateValue(item),
      text: compensationHistoryText(item),
      note: item.notes,
    })),
    ...configHistory.map(item => ({
      id: `rate-${item.id}`,
      date: historyDateValue(item),
      text: commissionHistoryText(item),
      note: item.notes,
    })),
    ...userHistory.map(item => ({
      id: `user-${item.id}`,
      date: historyDateValue(item),
      text: userHistoryText(item),
      note: item.changed_by ? `Изменил: ${userMap[item.changed_by]?.full_name ?? item.changed_by}` : null,
    })),
  ].sort((a, b) => b.date - a.date)

  if (person.hire_date) {
    rows.push({
      id: 'hire-date',
      date: new Date(person.hire_date),
      text: `Принят на должность: ${ROLE_LABEL[person.role] ?? person.role}`,
    })
  }

  return rows
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useDirectory() {
  const qc = useQueryClient()

  const { data: employees = [], isLoading: empLoading } = useQuery({
    queryKey: ['people'],
    queryFn: () => fetchEmployees({ limit: 200 }),
  })

  const { data: teams = [], isLoading: teamLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: () => fetchTeams({ limit: 200 }),
  })

  // Build team colour map
  const teamColorMap = useMemo(() => {
    const m = {}
    teams.forEach((t, i) => { m[t.id] = PALETTE[i % PALETTE.length] })
    return m
  }, [teams])

  // Build employee→team lookup via hierarchy for each team
  const { data: membershipMap = {} } = useQuery({
    queryKey: ['directory-membership', teams.map(t => t.id).join(',')],
    enabled: teams.length > 0,
    queryFn: async () => {
      const map = {}
      await Promise.all(
        teams.map(async t => {
          try {
            const members = await fetchTeamMembers(t.id)
            members.forEach(m => { map[m.user_id ?? m.UserID] = t.id })
          } catch { /* ignore */ }
        })
      )
      return map
    },
  })

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['people'] })
  }, [qc])

  return { employees, teams, teamColorMap, membershipMap, loading: empLoading || teamLoading, invalidate }
}

// ── Person card (grid) ────────────────────────────────────────────────────────

function PersonCard({ person, teamColor, teamName, onClick }) {
  const color = teamColor ?? '#6366f1'
  const tenure = calcTenure(person.hire_date)
  const photo = avatarSrc(person)

  return (
    <button
      onClick={onClick}
      className="text-left rounded-2xl bg-transparent shadow-sm overflow-hidden hover:-translate-y-1 hover:shadow-md transition-all duration-200 cursor-pointer group"
    >
      {/* Photo area */}
      <div className="relative aspect-[4/5] rounded-t-2xl bg-slate-100 overflow-hidden leading-none">
        {/* Avatar / photo */}
        {photo ? (
          <img
            src={photo}
            alt={person.full_name}
            className="block w-full h-full object-cover scale-[1.01] group-hover:scale-[1.04] transition-transform duration-300"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-5xl font-extrabold"
            style={{ color: `${color}22`, background: `${color}0D` }}
          >
            {initials(person.full_name).toUpperCase()}
          </div>
        )}

        {/* Team chip overlay */}
        <div className="absolute inset-x-2 bottom-2 z-10 sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3">
          <span className="inline-flex w-full max-w-full items-center gap-1.5 rounded-lg bg-white/90 px-2 py-1.5 text-[10px] font-bold text-slate-700 shadow-sm ring-1 ring-white/70 backdrop-blur-sm sm:w-auto sm:max-w-[150px] sm:rounded-full sm:bg-black/60 sm:py-1 sm:font-semibold sm:text-white sm:ring-0">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="truncate">{teamName ?? 'Без команды'}</span>
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-[112px] flex-col rounded-b-2xl border-x border-b border-slate-100 bg-white px-4 py-3.5">
        <p className="h-5 text-[15px] font-bold text-slate-900 leading-5 truncate">{person.full_name}</p>
        <p className="mt-0.5 h-5 text-[12.5px] text-slate-500 leading-5 font-medium truncate">{ROLE_LABEL[person.role] ?? person.role}</p>
        <div className="mt-auto flex min-h-5 items-center justify-end border-t border-slate-50 pt-3">
          <span className={`text-[11px] text-slate-400 ${tenure ? '' : 'invisible'}`}>{tenure ?? '—'}</span>
        </div>
      </div>
    </button>
  )
}

function GroupCard({ team, index, members, orders, leaderName, onClick }) {
  const tone = groupCardTone(index)
  const revenue = orders.reduce((sum, order) => sum + orderAmount(order), 0)
  const trend = buildSevenDayTrend(orders)
  const days = lastSevenDays()
  const points = linePoints(trend)
  const line = svgPath(points)
  const area = svgArea(points)
  const growth = trend[0] > 0 ? ((trend[6] - trend[0]) / trend[0]) * 100 : 0
  const growthLabel = Number.isFinite(growth) && growth !== 0 ? `${growth > 0 ? '+' : ''}${growth.toFixed(1)}%` : '0%'
  const payoutEstimate = Math.round(revenue * 0.16)

  return (
    <button
      type="button"
      onClick={onClick}
      className="group group-card-motion text-left rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md overflow-hidden sm:p-4"
      style={{ '--motion-delay': `${Math.min(index, 9) * 55}ms` }}
    >
      <div className="grid grid-cols-[46px_minmax(0,1fr)_auto] items-start gap-3 sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:gap-2.5">
        <div
          className="group-icon-motion relative grid h-[46px] w-[46px] place-items-center rounded-xl text-white shadow-lg sm:h-11 sm:w-11"
          style={{ background: `linear-gradient(135deg, ${tone.icon}, ${tone.icon}cc)` }}
        >
          <span className="absolute right-2 top-1 text-[8px] font-black text-white/95">
            {String(index + 1).padStart(2, '0')}
          </span>
          <Crown size={19} className="mt-2" />
        </div>
        <div className="min-w-0 pt-1">
          <p className="truncate text-[15px] font-black leading-tight text-slate-950 sm:text-[13px]">Команда {team.name}</p>
          <p className="mt-1 truncate text-[10.5px] font-semibold text-slate-500">Лидер: {leaderName ?? 'не назначен'}</p>
        </div>
        <span
          className="mt-2 h-2.5 w-2.5 rounded-full shadow-[0_0_0_5px_rgba(16,185,129,.10)]"
          style={{ background: team.is_active === false ? '#F43F5E' : '#10B981' }}
        />
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,.9fr)_minmax(126px,1fr)] items-end gap-2 sm:mt-5 sm:block">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-500">Выручка (TJS)</p>
          <div className="mt-1 flex items-end gap-2">
            <p className="text-[25px] font-black leading-none tracking-tight text-slate-950 sm:text-[24px]">{revenue.toLocaleString('ru-RU')}</p>
            <p className={`text-[12px] font-black ${growth >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {growth >= 0 ? '↑' : '↓'} {growthLabel.replace('-', '')}
            </p>
          </div>
          <p className="mt-1.5 text-[11px] font-semibold text-slate-500 sm:mt-2">Рост за 7 дней</p>
        </div>

        <div className="relative h-[64px] sm:mt-1 sm:h-[92px]">
          <span className="absolute right-0 top-0 z-10 rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-500 shadow-sm">
            7 дней
          </span>
          <svg viewBox="0 0 260 82" preserveAspectRatio="none" className="h-[58px] w-full overflow-visible sm:h-[72px]">
            <defs>
              <linearGradient id={`teamGrad-${team.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={tone.chart} stopOpacity=".3" />
                <stop offset="100%" stopColor={tone.chart} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="group-chart-area" d={area} fill={`url(#teamGrad-${team.id})`} />
            <path className="group-chart-line" pathLength="1" d={line} fill="none" stroke={tone.chart} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <circle className="group-chart-dot" cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="4.5" fill={tone.chart} stroke="#fff" strokeWidth="3" />
            {points.map(([x, y], pointIndex) => {
              const tooltipWidth = 88
              const tooltipX = Math.min(Math.max(x - tooltipWidth / 2, 2), 260 - tooltipWidth - 2)
              const tooltipY = Math.max(y - 38, 2)
              return (
                <g key={pointIndex} className="chart-point">
                  <circle cx={x} cy={y} r="18" fill="transparent" />
                  <line className="chart-point-ui" x1={x} y1="8" x2={x} y2="76" stroke="#CBD5E1" strokeWidth="1" strokeDasharray="4 5" />
                  <circle className="chart-point-ui" cx={x} cy={y} r="5" fill={tone.chart} stroke="#fff" strokeWidth="3" />
                  <rect className="chart-point-ui" x={tooltipX} y={tooltipY} width={tooltipWidth} height="31" rx="9" fill="#fff" filter="drop-shadow(0 8px 16px rgba(15,23,42,.14))" />
                  <text className="chart-point-ui" x={tooltipX + tooltipWidth / 2} y={tooltipY + 12} textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#64748B">
                    {chartDateLabel(days[pointIndex])}
                  </text>
                  <text className="chart-point-ui" x={tooltipX + tooltipWidth / 2} y={tooltipY + 24} textAnchor="middle" fontSize="9" fontWeight="900" fill="#0F172A">
                    {trend[pointIndex].toLocaleString('ru-RU')} TJS
                  </text>
                </g>
              )
            })}
          </svg>
          <div className="hidden justify-between text-[10px] font-black text-slate-500 sm:mt-0 sm:flex">
            <span>{chartDateLabel(days[0])}</span>
            <span>{chartDateLabel(days[3])}</span>
            <span>{chartDateLabel(days[6])}</span>
          </div>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2.5 sm:mt-2 sm:pt-3">
        <GroupStat icon={<Users size={16} />} color={tone.icon} value={members.length} label="Продавцы" />
        <GroupStat icon={<ShoppingCart size={16} />} color={tone.chart} value={orders.length} label="Заказы" />
        <GroupStat icon={<WalletCards size={16} />} color="#FF7A00" value={payoutEstimate.toLocaleString('ru-RU')} label="К выплате" />
      </div>
    </button>
  )
}

function GroupStat({ icon, color, value, label }) {
  return (
    <div className="min-w-0">
      <div style={{ color }}>{icon}</div>
      <p className="mt-1 text-[13px] font-black leading-none text-slate-950 truncate">{value}</p>
      <p className="mt-1.5 text-[10px] font-semibold leading-none text-slate-500 truncate">{label}</p>
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ person, teamId, teamColor, teamName, teams, employees, onBack, onUpdated }) {
  const qc        = useQueryClient()
  const fileRef   = useRef()
  const color     = teamColor ?? '#6366f1'

  const [editOpen,      setEditOpen]      = useState(false)
  const [editingStatus, setEditingStatus] = useState(false)
  const [pendingStatus, setPendingStatus] = useState(person.status ?? 'offline')

  useEffect(() => {
    setPendingStatus(person.status ?? 'offline')
  }, [person.status])

  // Compensation data
  const { data: comp }    = useQuery({
    queryKey: ['emp-comp', person.id],
    queryFn:  () => fetchEmployeeCompensation(person.id),
  })
  const { data: salaryHistory = [] } = useQuery({
    queryKey: ['emp-comp-history', person.id],
    queryFn:  () => fetchEmployeeCompensationHistory(person.id),
  })
  const { data: configs = [] } = useQuery({
    queryKey: ['emp-configs', person.id],
    queryFn:  () => fetchEmployeeConfigs(person.id),
  })
  const { data: configHistory = [] } = useQuery({
    queryKey: ['emp-config-history', person.id],
    queryFn:  () => fetchEmployeeConfigHistory(person.id),
  })
  const { data: userHistory = [] } = useQuery({
    queryKey: ['user-history', person.id],
    queryFn:  () => fetchUserHistory(person.id),
  })
  const { data: teamConfigs = [] } = useQuery({
    queryKey: ['team-configs', teamId],
    queryFn:  () => fetchTeamConfigs(teamId),
    enabled: !!teamId,
  })
  const { data: globalRates } = useQuery({
    queryKey: ['global-rates'],
    queryFn:  fetchGlobalRates,
  })

  function patchCache(updated) {
    qc.setQueryData(['people'], (old) =>
      Array.isArray(old) ? old.map(u => u.id === updated.id ? updated : u) : old
    )
    qc.invalidateQueries({ queryKey: ['people'] })
  }

  const updateMut = useMutation({
    mutationFn: (body) => updateEmployee(person.id, body),
    onSuccess: (updated) => {
      patchCache(updated)
      qc.invalidateQueries({ queryKey: ['user-history', person.id] })
      qc.invalidateQueries({ queryKey: ['users-history'] })
      onUpdated?.()
    },
  })

  const avatarMut = useMutation({
    mutationFn: (file) => uploadUserAvatar(person.id, file),
    onSuccess: (updated) => {
      patchCache(updated)
      qc.invalidateQueries({ queryKey: ['user-history', person.id] })
      qc.invalidateQueries({ queryKey: ['users-history'] })
      onUpdated?.()
    },
  })

  function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (file) avatarMut.mutate(file)
    e.target.value = ''
  }

  function saveStatus() {
    updateMut.mutate({ status: pendingStatus })
    setEditingStatus(false)
  }

  const tenure = calcTenure(person.hire_date)
  const age    = calcAge(person.date_of_birth)
  const globalByType = normalizeGlobalRates(globalRates)
  const roleGlobalByType = Object.fromEntries(
    (COMM_ROWS[person.role] ?? [])
      .map(row => [row.ct, globalByType[row.ct]])
      .filter(([, value]) => value)
  )
  const salary = compensationLabel(comp, configs, roleGlobalByType)
  const photo  = avatarSrc(person)
  const userMap = useMemo(() => {
    const map = {}
    employees.forEach(user => { map[user.id] = user })
    return map
  }, [employees])
  const historyItems = buildEmployeeHistory({ person, salaryHistory, configHistory, userHistory, userMap })

  const isCourier = person.role === 'courier'

  const stats = [
    { label: 'Стаж',      value: tenure ?? '—' },
    { label: 'Возраст',   value: age != null ? `${age} лет` : '—' },
    {
      label: isCourier ? 'Тариф' : 'Компенсация',
      value: isCourier ? 'По тарифу' : (salary ?? '—'),
    },
  ]

  return (
    <div className="animate-fade-in">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-slate-500 hover:text-slate-800 text-[13.5px] font-medium mb-7 transition-colors"
      >
        <ChevronLeft size={16} />
        Назад к команде
      </button>

      {/* Header */}
      <div className="flex gap-6 items-start mb-8 flex-wrap">
        {/* Avatar with upload */}
        <div className="relative flex-shrink-0 group/av">
          <div
            className="w-[148px] h-[148px] rounded-2xl overflow-hidden cursor-pointer"
            onClick={() => fileRef.current?.click()}
          >
            {photo ? (
              <img src={photo} alt={person.full_name} className="block w-full h-full object-cover" />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-5xl font-extrabold"
                style={{ color: `${color}33`, background: `${color}11` }}
              >
                {initials(person.full_name).toUpperCase()}
              </div>
            )}

            {/* Upload overlay */}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/av:opacity-100 transition-opacity flex items-center justify-center z-20">
              {avatarMut.isPending ? (
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Upload size={22} className="text-white" />
              )}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
        </div>

        {/* Name / role / badges */}
        <div className="flex-1 min-w-[200px] pt-2">
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-[28px] font-extrabold text-slate-900 leading-none tracking-tight">
              {person.full_name}
            </h1>
          </div>
          <p className="text-[15px] text-slate-500 font-medium mb-4">{ROLE_LABEL[person.role] ?? person.role}</p>
          <div className="flex gap-2 flex-wrap">
            {/* Status badge */}
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-semibold border"
              style={{ color: STATUS_CFG[person.status ?? 'offline'].color, borderColor: `${STATUS_CFG[person.status ?? 'offline'].color}33`, background: `${STATUS_CFG[person.status ?? 'offline'].color}11` }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_CFG[person.status ?? 'offline'].color }} />
              {STATUS_CFG[person.status ?? 'offline'].label}
            </span>
            {/* Team badge */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
              {teamName ?? '—'}
            </span>
            {/* Active / terminated */}
            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-[12.5px] font-semibold border ${
              person.is_active
                ? 'bg-slate-100 text-slate-600 border-slate-200'
                : 'bg-rose-50 text-rose-600 border-rose-200'
            }`}>
              {person.is_active ? 'Штатный сотрудник' : 'Неактивен'}
            </span>
          </div>
        </div>

        {/* Edit button */}
        <button
          className="flex items-center gap-2 h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[13.5px] font-semibold transition-colors flex-shrink-0"
          onClick={() => setEditOpen(true)}
        >
          <Edit2 size={14} />
          Редактировать
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3 mb-7">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <p className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-widest mb-2">{s.label}</p>
            <p className="text-[17px] font-bold text-slate-900 leading-snug">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5">

        {/* Left — personal info */}
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h2 className="text-[14px] font-bold text-slate-900 mb-5 tracking-tight">Личная информация</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <InfoField icon={Calendar} label="Дата рождения" value={person.date_of_birth ? fmtDate(person.date_of_birth) : '—'} />
              <InfoField icon={Briefcase} label="Дата найма"   value={person.hire_date    ? fmtDate(person.hire_date)    : '—'} />
              <InfoField icon={Phone}    label="Телефон"       value={person.phone ?? '—'} />
              <InfoField icon={MapPin}   label="Адрес"         value={person.address ?? '—'} />
              {person.role !== 'owner' && (
                <DocumentsField personId={person.id} />
              )}
            </div>
          </div>

          {/* Pay panel */}
          <PayPanel
            person={person}
            teamId={teamId}
            teamName={teamName}
            teamColor={teamColor}
            teams={teams}
            employees={employees}
            empConfigs={configs}
            teamConfigs={teamConfigs}
            globalConfigs={globalByType}
            salaryData={comp}
          />
        </div>

        {/* Right — status & history */}
        <div className="space-y-5">
          {/* Status panel */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h2 className="text-[14px] font-bold text-slate-900 mb-4 tracking-tight">Статус</h2>
            {editingStatus ? (
              <div className="space-y-3">
                <select
                  className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-[13.5px] font-medium px-3 appearance-none focus:outline-none focus:border-indigo-400"
                  value={pendingStatus}
                  onChange={e => setPendingStatus(e.target.value)}
                >
                  {STATUS_OPTIONS.map(o => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={saveStatus}
                    disabled={updateMut.isPending}
                    className="flex-1 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold transition-colors disabled:opacity-50"
                  >
                    {updateMut.isPending ? 'Сохраняю…' : 'Сохранить'}
                  </button>
                  <button
                    onClick={() => { setEditingStatus(false); setPendingStatus(person.status ?? 'offline') }}
                    className="h-9 px-3 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-700 text-[13px] font-medium transition-colors"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setEditingStatus(true)}
                className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: STATUS_CFG[person.status ?? 'offline'].color }}
                  />
                  <span className="text-[13.5px] font-semibold text-slate-800">
                    {STATUS_CFG[person.status ?? 'offline'].label}
                  </span>
                </div>
                <Edit2 size={13} className="text-slate-400" />
              </button>
            )}
          </div>

          {/* History panel */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h2 className="text-[14px] font-bold text-slate-900 mb-5 tracking-tight">История</h2>
            <div className="relative pl-5">
              <div className="absolute left-[5px] top-1 bottom-1 w-px bg-slate-100" />
              {historyItems.length > 0 ? (
                historyItems.map(item => (
                  <TimelineItem
                    key={item.id}
                    date={fmtDate(item.date)}
                    text={item.text}
                    note={item.note}
                  />
                ))
              ) : (
                <p className="text-[13px] text-slate-400">История появится после изменения оплаты или ставок.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <EditPersonModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        person={person}
        onSaved={onUpdated}
      />
    </div>
  )
}

function InfoField({ icon: Icon, label, value, className = '' }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={11} className="text-slate-400" />
        <span className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-[13.5px] text-slate-800 font-medium">{value}</p>
    </div>
  )
}

function DocumentsField({ personId }) {
  const inputRef = useRef(null)
  const qc = useQueryClient()
  const toast = useToast()
  const [documentType, setDocumentType] = useState('passport')
  const [expiresAt, setExpiresAt] = useState('')

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['user-documents', personId],
    queryFn: () => fetchUserDocuments(personId),
    enabled: !!personId,
  })

  const uploadMut = useMutation({
    mutationFn: async (selectedFiles) => {
      const files = Array.from(selectedFiles ?? [])
      for (const file of files) {
        const uploaded = await uploadFile(file)
        const fileUrl = uploaded?.url ?? uploaded?.data?.url
        if (!fileUrl) throw new Error('Не удалось получить ссылку на файл')
        await createUserDocument(personId, {
          file_url: fileUrl,
          original_filename: file.name,
          content_type: file.type || undefined,
          size_bytes: file.size,
          document_type: documentType,
          expires_at: expiresAt ? `${expiresAt}T00:00:00Z` : undefined,
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-documents', personId] })
      qc.invalidateQueries({ queryKey: ['user-history', personId] })
      qc.invalidateQueries({ queryKey: ['users-history'] })
      toast.success('Документы загружены')
    },
  })

  const deleteMut = useMutation({
    mutationFn: (documentId) => deleteUserDocument(personId, documentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-documents', personId] })
      qc.invalidateQueries({ queryKey: ['user-history', personId] })
      qc.invalidateQueries({ queryKey: ['users-history'] })
      toast.success('Документ удалён')
    },
  })

  const statusMut = useMutation({
    mutationFn: ({ documentId, status }) => updateUserDocumentStatus(personId, documentId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-documents', personId] })
      qc.invalidateQueries({ queryKey: ['user-history', personId] })
      qc.invalidateQueries({ queryKey: ['users-history'] })
      toast.success('Статус документа обновлён')
    },
  })

  function onSelect(e) {
    const next = Array.from(e.target.files ?? [])
    if (next.length > 0) uploadMut.mutate(next)
    e.target.value = ''
  }

  return (
    <div className="col-span-2">
      <div className="flex items-center gap-1.5 mb-2">
        <Upload size={11} className="text-slate-400" />
        <span className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider">Документы</span>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <select
          value={documentType}
          onChange={e => setDocumentType(e.target.value)}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 outline-none transition-colors focus:border-indigo-300"
        >
          {DOCUMENT_TYPES.map(type => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
        <input
          type="date"
          value={expiresAt}
          onChange={e => setExpiresAt(e.target.value)}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 outline-none transition-colors focus:border-indigo-300"
          title="Срок действия"
        />
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploadMut.isPending}
        className="w-full min-h-[76px] rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13.5px] font-semibold text-slate-800">
              {uploadMut.isPending ? 'Загружаю документы…' : 'Загрузить документы'}
            </p>
            <p className="mt-1 text-[12px] font-medium text-slate-500">Паспорт, договор, сертификаты</p>
          </div>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm">
            {uploadMut.isPending ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
            ) : (
              <Upload size={14} />
            )}
          </span>
        </div>
      </button>
      {uploadMut.error && (
        <p className="mt-2 text-[12px] font-medium text-rose-600">
          {uploadMut.error.response?.data?.error?.message ?? uploadMut.error.message}
        </p>
      )}
      <div className="mt-3 space-y-2">
        {isLoading && (
          <p className="text-[12px] font-medium text-slate-400">Загружаю список документов…</p>
        )}
        {documents.map(doc => (
          <div key={doc.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <a
              href={doc.file_url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 text-[12px] font-semibold text-slate-700 hover:text-indigo-700"
              title={doc.original_filename}
            >
              <span className="block truncate">{doc.original_filename}</span>
              <span className="block truncate text-[10.5px] font-semibold text-slate-400">
                {DOCUMENT_TYPE_LABEL[doc.document_type] ?? 'Другое'} · {DOCUMENT_STATUS_LABEL[doc.verification_status] ?? 'Загружен'}
                {doc.expires_at ? ` · до ${fmtDate(doc.expires_at)}` : ''}
              </span>
            </a>
            <div className="flex flex-shrink-0 items-center gap-1">
              {doc.verification_status !== 'verified' && (
                <button
                  type="button"
                  onClick={() => statusMut.mutate({ documentId: doc.id, status: 'verified' })}
                  disabled={statusMut.isPending}
                  className="rounded-lg px-2 py-1 text-[10.5px] font-black text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-50"
                  title="Проверить документ"
                >
                  Проверить
                </button>
              )}
              {doc.verification_status !== 'rejected' && (
                <button
                  type="button"
                  onClick={() => statusMut.mutate({ documentId: doc.id, status: 'rejected' })}
                  disabled={statusMut.isPending}
                  className="rounded-lg px-2 py-1 text-[10.5px] font-black text-amber-600 transition-colors hover:bg-amber-50 disabled:opacity-50"
                  title="Отклонить документ"
                >
                  Отклонить
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                deleteMut.mutate(doc.id)
              }}
              disabled={deleteMut.isPending}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
              title="Удалить документ"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
        onChange={onSelect}
      />
    </div>
  )
}

function TimelineItem({ date, text, note }) {
  return (
    <div className="relative pb-5 last:pb-0">
      <div className="absolute -left-5 top-[3px] w-2.5 h-2.5 rounded-full bg-white border-2 border-indigo-500" />
      <p className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{date}</p>
      <p className="text-[13px] text-slate-700 font-medium">{text}</p>
      {note && (
        <p className="mt-1 text-[12px] text-slate-400 leading-snug">{note}</p>
      )}
    </div>
  )
}

// ── Pay panel ─────────────────────────────────────────────────────────────────

// Commission rows per role (commission_type → display config)
const COMM_ROWS = {
  seller:         [{ ct: 'seller_rate',           label: 'Комиссия продавца',    accent: 'emerald' }],
  manager:        [{ ct: 'manager_team_rate',      label: 'Комиссия с команды',   accent: 'violet'  },
                   { ct: 'manager_personal_rate',  label: 'Личные заказы',        accent: 'sky'     }],
  sales_team_lead:[{ ct: 'team_lead_pool_rate',    label: 'Пул руководителя',     accent: 'amber'   }],
}

const COMP_KIND_LABEL = { percent: 'Процент', fixed: 'Фиксированная', mixed: 'Смешанная', none: 'Не назначено' }
const COMP_KIND_BADGE = { percent: 'indigo', fixed: 'emerald', mixed: 'violet', none: 'slate' }
const DEFAULT_NOTE = 'Обновлено без примечания'
const todayInputValue = () => new Date().toISOString().slice(0, 10)
const DOCUMENT_TYPES = [
  { value: 'passport', label: 'Паспорт' },
  { value: 'contract', label: 'Договор' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'diploma', label: 'Диплом' },
  { value: 'medical', label: 'Медицинский документ' },
  { value: 'other', label: 'Другое' },
]
const DOCUMENT_TYPE_LABEL = Object.fromEntries(DOCUMENT_TYPES.map(item => [item.value, item.label]))
const DOCUMENT_STATUS_LABEL = { uploaded: 'Загружен', verified: 'Проверен', rejected: 'Отклонён' }

// ── Modal: set fixed salary / compensation kind ────────────────────────────────
function SetSalaryModal({ open, onClose, personId, current }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [kind,    setKind]    = useState(current?.compensation_type ?? 'fixed')
  const [salary,  setSalary]  = useState(current?.fixed_salary    != null ? String(current.fixed_salary)              : '')
  const [rate,    setRate]    = useState(current?.commission_rate  != null ? String(current.commission_rate * 100)     : '')
  const [from,    setFrom]    = useState(todayInputValue)
  const [notes,   setNotes]   = useState('')

  useEffect(() => {
    if (open) {
      setKind(current?.compensation_type ?? 'fixed')
      setSalary(current?.fixed_salary    != null ? String(current.fixed_salary)          : '')
      setRate(current?.commission_rate   != null ? String(current.commission_rate * 100) : '')
      setFrom(todayInputValue()); setNotes('')
    }
  }, [open])

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async () => {
      if (!from)        throw new Error('Укажите дату начала')
      const body = { compensation_type: kind, effective_from: from + 'T00:00:00Z', notes: notes.trim() || DEFAULT_NOTE }
      if (kind === 'fixed' || kind === 'mixed') {
        const s = parseFloat(salary)
        if (isNaN(s) || s <= 0) throw new Error('Укажите сумму оклада')
        body.fixed_salary = s
      }
      if (kind === 'percent' || kind === 'mixed') {
        const r = parseFloat(rate)
        if (isNaN(r) || r <= 0 || r > 100) throw new Error('Укажите процент 0–100')
        body.commission_rate = r / 100
      }
      const { setEmployeeCompensation } = await import('../api')
      return setEmployeeCompensation(personId, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emp-comp', personId] })
      qc.invalidateQueries({ queryKey: ['emp-comp-history', personId] })
      qc.invalidateQueries({ queryKey: ['users-history'] })
      toast.success('Оклад обновлён')
      reset(); onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Настроить оклад / схему" size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={isPending}>Отмена</Button>
        <Button variant="primary" onClick={() => mutate()} loading={isPending}>Сохранить</Button>
      </>}
    >
      {error && <Alert variant="error" className="mb-4">{error.response?.data?.error?.message ?? error.message}</Alert>}
      <Alert variant="warning" title="Влияет только на будущие начисления">
        Новая схема начнёт действовать с выбранной даты. Уже созданные и закрытые заказы не пересчитываются.
      </Alert>
      <div className="space-y-4">
        <div>
          <label className="input-label">Схема оплаты *</label>
          <select value={kind} onChange={e => setKind(e.target.value)} className="input mt-1">
            <option value="fixed">Фиксированный оклад</option>
            <option value="percent">Процент от заказов</option>
            <option value="mixed">Смешанная (оклад + %)</option>
            <option value="none">Не назначено</option>
          </select>
        </div>
        {(kind === 'fixed' || kind === 'mixed') && (
          <div>
            <label className="input-label">Оклад (TJS/мес) *</label>
            <input type="number" min="0" step="0.01" value={salary}
              onChange={e => setSalary(e.target.value)} className="input mt-1" placeholder="3000" />
          </div>
        )}
        {(kind === 'percent' || kind === 'mixed') && (
          <div>
            <label className="input-label">Процент комиссии *</label>
            <div className="relative mt-1">
              <input type="number" min="0" max="100" step="0.01" value={rate}
                onChange={e => setRate(e.target.value)} className="input pr-8" placeholder="5" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400 pointer-events-none">%</span>
            </div>
          </div>
        )}
        <div>
          <label className="input-label">Действует с *</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input mt-1" />
        </div>
      </div>
    </Modal>
  )
}

// ── Modal: courier delivery tariffs (normal / fast, range-based) ───────────────
const DELIVERY_TYPES = [
  { key: 'normal', label: 'Обычная доставка' },
  { key: 'fast',   label: 'Срочная доставка' },
]
const TARIFF_TYPES = [
  { key: 'fixed',   label: 'Фиксированная (сом)' },
  { key: 'percent', label: 'Процент (%)' },
]

function CourierTariffsModal({ open, onClose, courierId, courierName }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState('normal')
  const [form, setForm] = useState({ amount_from: '', amount_to: '', tariff_type: 'fixed', tariff_value: '' })

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['courier-tariffs', courierId],
    queryFn:  () => fetchCourierTariffs(courierId),
    enabled:  open,
  })

  useEffect(() => {
    if (open) {
      setTab('normal')
      setForm({ amount_from: '', amount_to: '', tariff_type: 'fixed', tariff_value: '' })
    }
  }, [open])

  const setF = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const { mutate: addRule, isPending: adding, error: addError, reset: resetAdd } = useMutation({
    mutationFn: () => {
      const amtFrom = parseFloat(form.amount_from)
      const amtTo   = form.amount_to.trim() !== '' ? parseFloat(form.amount_to) : null
      const val     = parseFloat(form.tariff_value)
      if (isNaN(amtFrom) || amtFrom < 0) throw new Error('Сумма от: некорректное значение')
      if (amtTo !== null && (isNaN(amtTo) || amtTo <= amtFrom)) throw new Error('Сумма до должна быть больше суммы от')
      if (isNaN(val) || val <= 0) throw new Error('Значение тарифа должно быть > 0')
      return createCourierTariff(courierId, {
        delivery_type: tab, amount_from: amtFrom, amount_to: amtTo,
        tariff_type: form.tariff_type, tariff_value: val,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courier-tariffs', courierId] })
      setForm({ amount_from: '', amount_to: '', tariff_type: 'fixed', tariff_value: '' })
      resetAdd()
    },
  })

  const { mutate: removeRule } = useMutation({
    mutationFn: (rule) => deleteCourierTariff(courierId, rule.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courier-tariffs', courierId] })
      toast.success('Тариф удалён')
    },
    onError: (e) => toast.error(e?.response?.data?.error?.message ?? 'Ошибка удаления'),
  })

  const visibleRules = rules.filter((r) => r.delivery_type === tab)

  return (
    <Modal open={open} onClose={onClose} title={`Тарифы — ${courierName}`}
      description="Оплата курьеру зависит от типа доставки и суммы заказа" size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Закрыть</Button>}
    >
      <div className="flex gap-1 border-b border-slate-100 mb-4">
        {DELIVERY_TYPES.map((dt) => (
          <button
            key={dt.key}
            onClick={() => setTab(dt.key)}
            className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors ${
              tab === dt.key ? 'text-indigo-600 border-indigo-600' : 'text-slate-400 border-transparent'
            }`}
          >
            {dt.label}
          </button>
        ))}
      </div>

      <div className="bg-slate-50 rounded-xl border border-slate-100 p-4 mb-5">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-3">Добавить тариф</p>
        <div className="grid grid-cols-2 gap-2.5 mb-2.5">
          <div>
            <label className="input-label">Сумма от (сом)</label>
            <input type="number" min="0" value={form.amount_from} onChange={setF('amount_from')} className="input mt-1" placeholder="0" />
          </div>
          <div>
            <label className="input-label">Сумма до (сом)</label>
            <input type="number" min="0" value={form.amount_to} onChange={setF('amount_to')} className="input mt-1" placeholder="∞ (без ограничений)" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-3">
          <div>
            <label className="input-label">Тип тарифа</label>
            <select value={form.tariff_type} onChange={setF('tariff_type')} className="input mt-1">
              {TARIFF_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="input-label">Значение</label>
            <input type="number" min="0" step="0.01" value={form.tariff_value} onChange={setF('tariff_value')}
              className="input mt-1" placeholder={form.tariff_type === 'percent' ? '5 (= 5%)' : '15 (сом)'} />
          </div>
        </div>
        {addError && <Alert variant="error" className="mb-3">{addError.response?.data?.error?.message ?? addError.message}</Alert>}
        <div className="flex justify-end">
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => addRule()} loading={adding}>
            Добавить
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400 py-3">Загрузка…</p>
      ) : visibleRules.length === 0 ? (
        <div className="text-center py-7 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
          Тарифов нет. Добавьте первый тариф выше.
        </div>
      ) : (
        <div className="space-y-2">
          {visibleRules.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 bg-white border border-slate-100 rounded-xl px-3.5 py-2.5">
              <div className="text-[13px]">
                <span className="text-slate-500">{r.amount_from} – {r.amount_to != null ? r.amount_to : '∞'} сом</span>
                <span className="mx-2 text-slate-300">→</span>
                <span className="font-bold text-slate-900">
                  {r.tariff_type === 'percent' ? `${r.tariff_value}%` : `${r.tariff_value} сом`}
                </span>
                <span className="ml-2 text-[11px] text-slate-400">
                  ({r.tariff_type === 'percent' ? 'процент' : 'фиксировано'})
                </span>
              </div>
              <button
                onClick={() => removeRule(r)}
                title="Удалить"
                className="text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg p-1.5 flex-shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ── Modal: set personal commission rate override ───────────────────────────────
function PersonalRateModal({ open, onClose, personId, commType, label, existing, currentRate }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const initialRate = existing?.rate ?? currentRate
  const [rate,  setRate]  = useState(initialRate != null ? String(+(initialRate * 100).toFixed(4)) : '')
  const [from,  setFrom]  = useState(todayInputValue)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (open) {
      const nextRate = existing?.rate ?? currentRate
      setRate(nextRate != null ? String(+(nextRate * 100).toFixed(4)) : '')
      setFrom(todayInputValue()); setNotes('')
    }
  }, [open, existing, currentRate])

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async () => {
      const r = parseFloat(rate)
      if (isNaN(r) || r <= 0 || r > 100) throw new Error('Введите процент 0–100')
      if (!from)         throw new Error('Укажите дату начала')
      const note = notes.trim() || DEFAULT_NOTE
      if (existing) {
        await disableConfig(existing.id, {
          effective_to: from + 'T00:00:00Z',
          notes: `Заменено: ${note}`,
        })
      }
      return createConfig({
        scope: 'employee', user_id: personId,
        commission_type: commType,
        rate: r / 100,
        effective_from: from + 'T00:00:00Z',
        notes: note,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emp-configs', personId] })
      qc.invalidateQueries({ queryKey: ['emp-config-history', personId] })
      qc.invalidateQueries({ queryKey: ['users-history'] })
      toast.success('Ставка обновлена')
      reset(); onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title={`Личная ставка — ${label}`} size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={isPending}>Отмена</Button>
        <Button variant="primary" onClick={() => mutate()} loading={isPending}>
          {existing ? 'Обновить' : 'Сохранить'}
        </Button>
      </>}
    >
      {error && <Alert variant="error" className="mb-4">{error.response?.data?.error?.message ?? error.message}</Alert>}
      <Alert variant="warning" title="Влияет только на будущие заказы">
        Ставка применяется с выбранной даты. Прошлые заказы и уже созданные начисления не меняются.
      </Alert>
      <div className="space-y-4">
        <div>
          <label className="input-label">Процент *</label>
          <div className="relative mt-1">
            <input type="number" min="0" max="100" step="0.01" value={rate}
              onChange={e => setRate(e.target.value)} className="input pr-8" placeholder="10" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400 pointer-events-none">%</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Персональная ставка — переопределяет командную.</p>
        </div>
        <div>
          <label className="input-label">Действует с *</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input mt-1" />
          {existing && <p className="text-xs text-slate-400 mt-1">Текущая ставка будет закрыта с этой даты.</p>}
        </div>
      </div>
    </Modal>
  )
}

// ── Commission rate row ────────────────────────────────────────────────────────
function CommRateRow({ rowDef, empConfig, teamConfig, globalConfig, personId }) {
  const [open, setOpen] = useState(false)
  const active = empConfig ?? teamConfig ?? globalConfig
  const isPersonal = !!empConfig
  const isTeam = !empConfig && !!teamConfig
  const isGlobal = !empConfig && !teamConfig && !!globalConfig

  return (
    <>
      <div className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl bg-slate-50 border border-slate-100">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-slate-700">{rowDef.label}</p>
          {isPersonal && (
            <p className="text-[10px] text-indigo-500 font-medium mt-0.5">Личная ставка</p>
          )}
          {isTeam && (
            <p className="text-[10px] text-indigo-500 font-medium mt-0.5">Ставка команды</p>
          )}
          {isGlobal && (
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">Базовая ставка</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {active ? (
            <span className="text-[13px] font-bold text-indigo-700">{fmtPct(active.rate)}</span>
          ) : (
            <span className="text-[12px] text-slate-400 italic">Не задано</span>
          )}
          <button
            onClick={() => setOpen(true)}
            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors px-2 py-1 rounded-lg hover:bg-indigo-50 min-h-[28px]"
          >
            {active ? 'Изменить' : 'Задать'}
          </button>
        </div>
      </div>
      <PersonalRateModal
        open={open} onClose={() => setOpen(false)}
        personId={personId} commType={rowDef.ct} label={rowDef.label}
        existing={empConfig ?? null}
        currentRate={active?.rate ?? null}
      />
    </>
  )
}

// ── Main pay panel ─────────────────────────────────────────────────────────────
function PayPanel({ person, teamId, teamName, teamColor, teams, employees, empConfigs, teamConfigs, globalConfigs = {}, salaryData }) {
  const [showTeam,    setShowTeam]    = useState(false)
  const [showSalary,  setShowSalary]  = useState(false)
  const [showTariffs, setShowTariffs] = useState(false)
  const isCourier = person.role === 'courier'
  const isSalaryRole = ['dispatcher', 'warehouse_manager'].includes(person.role)

  const { data: courierTariffs = [] } = useQuery({
    queryKey: ['courier-tariffs', person.id],
    queryFn:  () => fetchCourierTariffs(person.id),
    enabled:  isCourier,
  })

  const color = teamColor ?? '#6366f1'

  // Index configs by commission_type
  const empByType  = {}
  const teamByType = {}
  empConfigs.filter(isConfigActive).forEach(c => { empByType[c.commission_type] = c })
  teamConfigs.filter(isConfigActive).forEach(c => { teamByType[c.commission_type] = c })

  const commRows = COMM_ROWS[person.role] ?? []
  const canChangeTeam = !['owner', 'courier', 'warehouse_manager'].includes(person.role)
  const hasPayContent = canChangeTeam || isCourier || isSalaryRole || commRows.length > 0

  if (!hasPayContent) return null

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
      <h2 className="text-[14px] font-bold text-slate-900 tracking-tight">Оплата</h2>

      {/* ── Team row ──────────────────────────────────────────────────────── */}
      {canChangeTeam && (
        <div className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl bg-slate-50 border border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
            <p className="text-[12.5px] font-semibold text-slate-700 truncate">{teamName ?? 'Без команды'}</p>
          </div>
          <button
            onClick={() => setShowTeam(true)}
            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors px-2 py-1 rounded-lg hover:bg-indigo-50 min-h-[28px] flex-shrink-0"
          >
            Изменить команду
          </button>
        </div>
      )}

      {/* ── Courier tariff ───────────────────────────────────────────────── */}
      {isCourier && (
        <div className="flex items-start justify-between gap-3 bg-amber-50 rounded-xl p-4 border border-amber-100">
          <div className="flex items-start gap-3 min-w-0">
            <TrendingUp size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[12.5px] text-amber-700 font-medium">
                Оплата по тарифу доставки
              </p>
              <p className="text-[11px] text-amber-600/80 mt-0.5">
                {courierTariffs.length > 0
                  ? `Настроено тарифов: ${courierTariffs.length}`
                  : 'Тарифы не настроены'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowTariffs(true)}
            className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 transition-colors px-2 py-1 rounded-lg hover:bg-amber-100 min-h-[28px] flex-shrink-0"
          >
            Настроить
          </button>
        </div>
      )}

      {/* ── Salary card ────────────────────────────────────────────────────── */}
      {isSalaryRole && (
        <div className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl bg-slate-50 border border-slate-100">
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-slate-700">Фиксированная зарплата</p>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
              {salaryData?.effective_from ? `Действует с ${fmtDate(salaryData.effective_from)}` : 'Для штатной роли'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {salaryData?.fixed_salary != null ? (
              <span className="text-[13px] font-bold text-indigo-700">{fmtMoney(salaryData.fixed_salary)}</span>
            ) : (
              <span className="text-[12px] text-slate-400 italic">Не задано</span>
            )}
            <button
              onClick={() => setShowSalary(true)}
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors px-2 py-1 rounded-lg hover:bg-indigo-50 min-h-[28px]"
            >
              {salaryData?.fixed_salary != null ? 'Изменить' : 'Задать'}
            </button>
          </div>
        </div>
      )}

      {/* ── Commission rates ───────────────────────────────────────────────── */}
      {commRows.length > 0 && (
        <div>
          <p className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Ставки комиссии</p>
          <div className="space-y-2">
            {commRows.map(rowDef => (
              <CommRateRow
                key={rowDef.ct}
                rowDef={rowDef}
                empConfig={empByType[rowDef.ct] ?? null}
                teamConfig={teamByType[rowDef.ct] ?? null}
                globalConfig={globalConfigs[rowDef.ct] ?? null}
                personId={person.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      <AssignTeamModal
        open={showTeam}
        onClose={() => setShowTeam(false)}
        user={person}
        teams={teams}
        users={employees}
        current={teamId ? { team_id: teamId } : null}
      />
      <SetSalaryModal
        open={showSalary}
        onClose={() => setShowSalary(false)}
        personId={person.id}
        current={salaryData}
      />
      {isCourier && (
        <CourierTariffsModal
          open={showTariffs}
          onClose={() => setShowTariffs(false)}
          courierId={person.id}
          courierName={person.full_name}
        />
      )}
    </div>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditPersonModal({ open, onClose, person, onSaved }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [fullName,    setFullName]    = useState('')
  const [phone,       setPhone]       = useState('')
  const [role,        setRole]        = useState('seller')
  const [isActive,    setIsActive]    = useState(true)
  const [status,      setStatus]      = useState('offline')
  const [hireDate,    setHireDate]    = useState('')
  const [dob,         setDob]         = useState('')
  const [address,     setAddress]     = useState('')

  useEffect(() => {
    if (!person) return
    setFullName(person.full_name ?? '')
    setPhone(person.phone ?? '')
    setRole(person.role ?? 'seller')
    setIsActive(person.is_active !== false)
    setStatus(person.status ?? 'offline')
    setHireDate(person.hire_date ? person.hire_date.slice(0, 10) : '')
    setDob(person.date_of_birth ? person.date_of_birth.slice(0, 10) : '')
    setAddress(person.address ?? '')
  }, [person])

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!fullName.trim()) throw new Error('Имя обязательно')
      return updateEmployee(person.id, {
        full_name:     fullName.trim(),
        phone:         phone.trim()   || undefined,
        role,
        is_active:     isActive,
        status,
        hire_date:     hireDate ? hireDate + 'T00:00:00Z' : undefined,
        date_of_birth: dob     ? dob + 'T00:00:00Z'     : undefined,
        address:       address.trim() || undefined,
      })
    },
    onSuccess: (updated) => {
      qc.setQueryData(['people'], (old) =>
        Array.isArray(old) ? old.map(u => u.id === updated.id ? updated : u) : old
      )
      qc.invalidateQueries({ queryKey: ['people'] })
      qc.invalidateQueries({ queryKey: ['user-history', person.id] })
      qc.invalidateQueries({ queryKey: ['users-history'] })
      toast.success('Данные обновлены')
      reset()
      onSaved?.()
      onClose()
    },
  })

  if (!person) return null

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title="Редактировать сотрудника"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => { reset(); onClose() }} disabled={isPending}>Отмена</Button>
          <Button variant="primary" onClick={() => mutate()} loading={isPending}>Сохранить</Button>
        </>
      }
    >
      {error && (
        <Alert variant="error" className="mb-4">
          {error.response?.data?.error?.message ?? error.message}
        </Alert>
      )}

      <div className="space-y-5">
        {/* Row 1 — name + phone */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="input-label">Полное имя *</label>
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="input mt-1"
              placeholder="Имя Фамилия"
            />
          </div>
          <div>
            <label className="input-label">Телефон</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="input mt-1"
              placeholder="+992 93 000 00 00"
            />
          </div>
        </div>

        {/* Row 2 — role */}
        <div>
          <label className="input-label">Должность *</label>
          <select value={role} onChange={e => setRole(e.target.value)} className="input mt-1">
            {ALL_ROLES.filter(r => r !== 'owner').map(r => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>

        {/* Row 3 — hire date + dob */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="input-label">Дата найма</label>
            <input
              type="date"
              value={hireDate}
              onChange={e => setHireDate(e.target.value)}
              className="input mt-1"
            />
          </div>
          <div>
            <label className="input-label">Дата рождения</label>
            <input
              type="date"
              value={dob}
              onChange={e => setDob(e.target.value)}
              className="input mt-1"
            />
          </div>
        </div>

        {/* Row 4 — status + is_active */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="input-label">Статус</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className="input mt-1">
              {STATUS_OPTIONS.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-[2px]">
            <label className="flex items-center gap-2.5 cursor-pointer min-h-[44px]">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600"
              />
              <span className="text-[13.5px] text-slate-700 font-medium">Активный сотрудник</span>
            </label>
          </div>
        </div>

        {/* Row 5 — address */}
        <div>
          <label className="input-label">Адрес</label>
          <input
            value={address}
            onChange={e => setAddress(e.target.value)}
            className="input mt-1"
            placeholder="г. Душанбе, ул. ..."
          />
        </div>
      </div>
    </Modal>
  )
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({ q, setQ, roleFilter, setRoleFilter, teamFilter, setTeamFilter, teams, teamColorMap, onClear }) {
  const hasFilters = q || roleFilter !== 'all' || teamFilter !== 'all'

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-2.5 mb-8 flex flex-wrap items-center gap-2">
      <div className="flex w-full min-w-0 flex-nowrap items-center gap-2 sm:contents">
        {/* Search */}
        <div className="min-w-0 flex-1 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-2.5 sm:px-3.5 h-11 focus-within:border-indigo-300 transition-colors sm:min-w-[220px]">
          <Search size={14} className="text-slate-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Поиск"
            value={q}
            onChange={e => setQ(e.target.value)}
            className="min-w-0 flex-1 bg-transparent outline-none text-[13px] sm:text-[13.5px] text-slate-800 placeholder:text-slate-400"
          />
          {q && <button onClick={() => setQ('')}><X size={13} className="text-slate-400 hover:text-slate-600" /></button>}
        </div>

        <div className="w-px h-7 bg-slate-200 flex-shrink-0 hidden sm:block" />

        {/* Role filter */}
        <SelectBox
          label="Должность"
          value={roleFilter}
          onChange={setRoleFilter}
          mobileDisplay={roleFilter === 'all' ? 'Все' : ROLE_LABEL[roleFilter] ?? roleFilter}
        >
          <option value="all">Все должности</option>
          {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </SelectBox>

        {/* Team filter */}
        <SelectBox
          label="Команда"
          value={teamFilter}
          onChange={setTeamFilter}
          mobileDisplay={teamFilter === 'all' ? 'Все' : teams.find(t => t.id === teamFilter)?.name ?? 'Команда'}
        >
          <option value="all">Все команды</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectBox>
      </div>

      {hasFilters && (
        <button onClick={onClear} className="h-11 px-4 rounded-xl border border-slate-200 text-[13px] text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors font-medium">
          Сбросить
        </button>
      )}
    </div>
  )
}

function SelectBox({ label, value, onChange, mobileDisplay, children }) {
  return (
    <div className="relative w-[96px] flex-shrink-0 sm:w-auto">
      <label className="absolute -top-[7px] left-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400 bg-white px-1 pointer-events-none z-10 sm:text-[9.5px] sm:tracking-widest">
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-2 pr-6 text-[12.5px] font-semibold text-transparent appearance-none focus:outline-none focus:border-indigo-300 sm:min-w-[148px] sm:pl-3.5 sm:pr-8 sm:text-[13px] sm:font-medium sm:text-slate-700"
      >
        {children}
      </select>
      <span className="pointer-events-none absolute left-3 right-7 top-1/2 -translate-y-1/2 truncate text-[13px] font-semibold text-slate-700 sm:hidden">
        {mobileDisplay}
      </span>
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
    </div>
  )
}

function AuditJournal({ history = [], userMap = {} }) {
  const [query, setQuery] = useState('')
  const [fieldFilter, setFieldFilter] = useState('all')
  const [editorFilter, setEditorFilter] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const fieldOptions = useMemo(() => {
    const fields = Array.from(new Set(history.map(item => item.field_name))).filter(Boolean).sort()
    return fields.map(field => ({ field, label: auditFieldLabel(field) }))
  }, [history])

  const editorOptions = useMemo(() => {
    const ids = Array.from(new Set(history.map(item => item.changed_by).filter(Boolean)))
    return ids.map(id => ({ id, label: userMap[id]?.full_name ?? id }))
  }, [history, userMap])

  const filteredHistory = useMemo(() => {
    const q = query.trim().toLowerCase()
    const fromDate = from ? new Date(`${from}T00:00:00`) : null
    const toDate = to ? new Date(`${to}T23:59:59`) : null
    return history.filter(item => {
      const created = item.created_at ? new Date(item.created_at) : null
      const employeeName = userMap[item.user_id]?.full_name ?? ''
      const editorName = item.changed_by ? (userMap[item.changed_by]?.full_name ?? item.changed_by) : ''
      const text = `${employeeName} ${editorName} ${userHistoryText(item)}`.toLowerCase()
      const matchQ = !q || text.includes(q)
      const matchField = fieldFilter === 'all' || item.field_name === fieldFilter
      const matchEditor = editorFilter === 'all' || item.changed_by === editorFilter
      const matchFrom = !fromDate || (created && created >= fromDate)
      const matchTo = !toDate || (created && created <= toDate)
      return matchQ && matchField && matchEditor && matchFrom && matchTo
    })
  }, [history, userMap, query, fieldFilter, editorFilter, from, to])

  if (history.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center shadow-sm">
        <Clock size={28} className="mx-auto text-slate-300" />
        <p className="mt-3 text-[14px] font-bold text-slate-700">Журнал пока пуст</p>
        <p className="mt-1 text-[12.5px] font-medium text-slate-400">Новые изменения сотрудников появятся здесь.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-4 grid gap-2 lg:grid-cols-[minmax(180px,1fr)_170px_170px_140px_140px]">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Поиск по сотруднику или изменению"
          className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] font-semibold text-slate-700 outline-none transition-colors focus:border-indigo-300"
        />
        <select
          value={fieldFilter}
          onChange={e => setFieldFilter(e.target.value)}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 outline-none transition-colors focus:border-indigo-300"
        >
          <option value="all">Все поля</option>
          {fieldOptions.map(item => (
            <option key={item.field} value={item.field}>{item.label}</option>
          ))}
        </select>
        <select
          value={editorFilter}
          onChange={e => setEditorFilter(e.target.value)}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 outline-none transition-colors focus:border-indigo-300"
        >
          <option value="all">Все авторы</option>
          {editorOptions.map(item => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={e => setFrom(e.target.value)}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 outline-none transition-colors focus:border-indigo-300"
        />
        <input
          type="date"
          value={to}
          onChange={e => setTo(e.target.value)}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 outline-none transition-colors focus:border-indigo-300"
        />
      </div>
      <div className="divide-y divide-slate-100">
        {filteredHistory.map(item => (
          <div key={item.id} className="grid gap-2 py-3 sm:grid-cols-[170px_minmax(0,1fr)_180px] sm:items-center">
            <div>
              <p className="text-[12.5px] font-black text-slate-900">
                {userMap[item.user_id]?.full_name ?? 'Сотрудник'}
              </p>
              <p className="text-[11px] font-semibold text-slate-400">{fmtDate(item.created_at)}</p>
            </div>
            <p className="text-[13px] font-semibold text-slate-700">{userHistoryText(item)}</p>
            <p className="text-[11.5px] font-semibold text-slate-400 sm:text-right">
              {item.changed_by ? `Изменил: ${userMap[item.changed_by]?.full_name ?? item.changed_by}` : ''}
            </p>
          </div>
        ))}
        {filteredHistory.length === 0 && (
          <div className="py-10 text-center text-[13px] font-semibold text-slate-400">
            По выбранным фильтрам событий нет.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TeamDirectoryPage() {
  const navigate = useNavigate()
  const { employees, teams, teamColorMap, membershipMap, loading, invalidate } = useDirectory()

  const [selected, setSelected]       = useState(null)
  const [tab, setTab]                 = useState('employees')
  const [q, setQ]                     = useState('')
  const [roleFilter, setRoleFilter]   = useState('all')
  const [teamFilter, setTeamFilter]   = useState('all')
  const { data: auditHistory = [] } = useQuery({
    queryKey: ['users-history'],
    queryFn: fetchAllUserHistory,
    enabled: tab === 'audit',
  })

  // Build a team name map
  const teamNameMap = useMemo(() => {
    const m = {}
    teams.forEach(t => { m[t.id] = t.name })
    return m
  }, [teams])

  const userMap = useMemo(() => {
    const m = {}
    employees.forEach(user => { m[user.id] = user })
    return m
  }, [employees])

  const teamMembersMap = useMemo(() => {
    const map = {}
    teams.forEach(team => { map[team.id] = [] })
    employees.forEach(person => {
      const teamId = membershipMap[person.id]
      if (!teamId) return
      if (!map[teamId]) map[teamId] = []
      map[teamId].push(person)
    })
    return map
  }, [employees, membershipMap, teams])

  const teamOrderQueries = useQueries({
    queries: teams.map(team => ({
      queryKey: ['directory-team-orders', team.id, team.team_lead_id],
      queryFn: () => fetchTeamOrders(team.team_lead_id, { limit: 200 }),
      enabled: !!team.team_lead_id,
      staleTime: 60_000,
    })),
  })

  const teamOrdersMap = useMemo(() => {
    const map = {}
    teams.forEach((team, index) => {
      map[team.id] = teamOrderQueries[index]?.data ?? []
    })
    return map
  }, [teams, teamOrderQueries])

  // Filter employees
  const filtered = useMemo(() => {
    const qLow = q.toLowerCase()
    return employees.filter(p => {
      const teamId = membershipMap[p.id]
      const teamN  = teamId ? (teamNameMap[teamId] ?? '').toLowerCase() : ''
      const matchQ = !q || p.full_name.toLowerCase().includes(qLow) || (ROLE_LABEL[p.role] ?? '').toLowerCase().includes(qLow) || teamN.includes(qLow)
      const matchR = roleFilter   === 'all' || p.role    === roleFilter
      const matchT = teamFilter   === 'all' || teamId === teamFilter
      return matchQ && matchR && matchT
    })
  }, [employees, membershipMap, teamNameMap, q, roleFilter, teamFilter])

  function clearFilters() {
    setQ(''); setRoleFilter('all'); setTeamFilter('all')
  }

  // When a person is updated, refresh the selected person data
  function handleUpdated() {
    invalidate()
    // The selected card will update after query cache invalidation
  }

  // Resolve selected person from live data
  const selectedPerson = selected ? employees.find(e => e.id === selected) ?? null : null

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (selectedPerson) {
    const tid    = membershipMap[selectedPerson.id]
    const tColor = tid ? teamColorMap[tid] : null
    const tName  = tid ? teamNameMap[tid]  : null

    return (
      <div className="p-4 md:p-6 pb-16">
        <DetailPanel
          person={selectedPerson}
          teamId={tid}
          teamColor={tColor}
          teamName={tName}
          teams={teams}
          employees={employees}
          onBack={() => setSelected(null)}
          onUpdated={handleUpdated}
        />
      </div>
    )
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 pb-16">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Команда</h1>
          <p className="text-[13.5px] text-slate-500 mt-1">
            {tab === 'groups'
              ? 'Группы продаж, выручка, лидеры и участники'
              : tab === 'audit'
                ? 'История изменений сотрудников'
                : 'Все сотрудники компании'}
          </p>
        </div>
        <span className="text-[13px] font-semibold text-slate-800 bg-white border border-slate-200 rounded-full px-4 py-1.5 shadow-sm">
          {loading ? '…' : tab === 'groups' ? `${teams.length} групп` : tab === 'audit' ? `${auditHistory.length} событий` : `${filtered.length} чел.`}
        </span>
      </div>

      <div className="mb-7 flex gap-7 border-b border-slate-200">
        {[
          { id: 'employees', label: 'Все сотрудники' },
          { id: 'groups', label: 'Groups' },
          { id: 'audit', label: 'Журнал' },
        ].map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={[
              'relative -mb-px min-h-[44px] px-1 text-[14px] font-extrabold transition-colors',
              tab === item.id ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-800',
            ].join(' ')}
          >
            {item.label}
            {tab === item.id && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-indigo-600" />}
          </button>
        ))}
      </div>

      {tab === 'employees' && (
        <>
          {/* Filters */}
          <FilterBar
            q={q} setQ={setQ}
            roleFilter={roleFilter}   setRoleFilter={setRoleFilter}
            teamFilter={teamFilter}   setTeamFilter={setTeamFilter}
            teams={teams}
            teamColorMap={teamColorMap}
            onClear={clearFilters}
          />

          {/* Grid */}
          {loading ? (
            <div className={PERSON_GRID_CLASS}>
              {[...Array(8)].map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-slate-100 overflow-hidden animate-pulse">
                  <div className="aspect-[4/5] bg-slate-100" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-slate-100 rounded w-3/4" />
                    <div className="h-3 bg-slate-100 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
              <Users size={36} className="opacity-40" />
              <p className="text-[15px] font-semibold text-slate-600">Никто не найден</p>
              <p className="text-[13px]">Попробуйте изменить фильтры или очистить поиск.</p>
            </div>
          ) : (
            <div className={PERSON_GRID_CLASS}>
              {filtered.map(p => {
                const tid    = membershipMap[p.id]
                const tColor = tid ? teamColorMap[tid] : undefined
                const tName  = tid ? teamNameMap[tid]  : undefined
                return (
                  <PersonCard
                    key={p.id}
                    person={p}
                    teamColor={tColor}
                    teamName={tName}
                    onClick={() => setSelected(p.id)}
                  />
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'groups' && (
        loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-[330px] rounded-2xl border border-slate-100 bg-white animate-pulse" />
            ))}
          </div>
        ) : teams.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <Users size={36} className="opacity-40" />
            <p className="text-[15px] font-semibold text-slate-600">Группы не созданы</p>
            <p className="text-[13px]">Создайте команду в разделе команд, чтобы она появилась здесь.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-4">
            {teams.map((team, index) => {
              const members = teamMembersMap[team.id] ?? []
              const leader = team.team_lead_id ? userMap[team.team_lead_id]?.full_name : null
              return (
                <GroupCard
                  key={team.id}
                  team={team}
                  index={index}
                  members={members}
                  orders={teamOrdersMap[team.id] ?? []}
                  leaderName={leader}
                  onClick={() => navigate(`/owner/teams/${team.id}`)}
                />
              )
            })}
          </div>
        )
      )}

      {tab === 'audit' && (
        <AuditJournal history={auditHistory} userMap={userMap} />
      )}
    </div>
  )
}
