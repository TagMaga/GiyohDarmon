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
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query'
import {
  Search, X, ChevronLeft, Edit2, Upload, Phone,
  MapPin, Calendar, Briefcase, Clock, Users,
  TrendingUp,
} from 'lucide-react'

import {
  fetchEmployees, fetchTeams, fetchTeamMembers,
  fetchEmployeeCompensation, fetchEmployeeConfigs, fetchTeamConfigs,
  createConfig, disableConfig,
  updateEmployee, uploadUserAvatar,
} from '../api'
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

// Resolve commission label for the "salary" stat card
function compensationLabel(comp, configs = []) {
  if (!comp && configs.length === 0) return null
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
  return null
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

// ── Status chip ───────────────────────────────────────────────────────────────

function StatusChip({ status, small = false }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.offline
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm ${small ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-[11px]'} font-semibold text-white`}>
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.pulse ? 'animate-pulse' : ''}`}
        style={{ background: cfg.color }}
      />
      {cfg.label}
    </span>
  )
}

// ── Person card (grid) ────────────────────────────────────────────────────────

function PersonCard({ person, teamColor, teamName, onClick }) {
  const st    = STATUS_CFG[person.status ?? 'offline'] ?? STATUS_CFG.offline
  const color = teamColor ?? '#6366f1'
  const tenure = calcTenure(person.hire_date)

  return (
    <button
      onClick={onClick}
      className="text-left bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden hover:-translate-y-1 hover:border-slate-200 hover:shadow-md transition-all duration-200 cursor-pointer group"
    >
      {/* Photo area */}
      <div className="relative aspect-[1/0.92] bg-slate-100 overflow-hidden">
        {/* Team colour bar */}
        <div className="absolute top-0 left-0 right-0 h-1 z-10" style={{ background: color }} />

        {/* Avatar / photo */}
        {person.avatar_url ? (
          <img
            src={person.avatar_url}
            alt={person.full_name}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-5xl font-extrabold"
            style={{ color: `${color}22`, background: `${color}0D` }}
          >
            {initials(person.full_name).toUpperCase()}
          </div>
        )}

        {/* Status chip overlay */}
        <div className="absolute top-3 right-3 z-10">
          <StatusChip status={person.status} small />
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3.5">
        <p className="text-[15px] font-bold text-slate-900 leading-snug truncate">{person.full_name}</p>
        <p className="text-[12.5px] text-slate-500 mt-0.5 font-medium truncate">{ROLE_LABEL[person.role] ?? person.role}</p>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-50">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
            {teamName ?? '—'}
          </span>
          {tenure && <span className="text-[11px] text-slate-400">{tenure}</span>}
        </div>
      </div>
    </button>
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
  const { data: configs = [] } = useQuery({
    queryKey: ['emp-configs', person.id],
    queryFn:  () => fetchEmployeeConfigs(person.id),
  })
  const { data: teamConfigs = [] } = useQuery({
    queryKey: ['team-configs', teamId],
    queryFn:  () => fetchTeamConfigs(teamId),
    enabled: !!teamId,
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
      onUpdated?.()
    },
  })

  const avatarMut = useMutation({
    mutationFn: (file) => uploadUserAvatar(person.id, file),
    onSuccess: (updated) => {
      patchCache(updated)
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
  const salary = compensationLabel(comp, configs)

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
            {/* Team bar */}
            <div className="absolute top-0 left-0 right-0 h-1.5 z-10" style={{ background: color }} />

            {person.avatar_url ? (
              <img src={`${person.avatar_url}?t=${person.updated_at ?? ''}`} alt={person.full_name} className="w-full h-full object-cover" />
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
              <InfoField icon={MapPin}   label="Адрес"         value={person.address ?? '—'} className="col-span-2" />
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
              {person.hire_date ? (
                <TimelineItem
                  date={fmtDate(person.hire_date)}
                  text={`Принят на должность: ${ROLE_LABEL[person.role] ?? person.role}`}
                />
              ) : (
                <p className="text-[13px] text-slate-400">История появится после заполнения данных о найме.</p>
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

function TimelineItem({ date, text }) {
  return (
    <div className="relative pb-5 last:pb-0">
      <div className="absolute -left-5 top-[3px] w-2.5 h-2.5 rounded-full bg-white border-2 border-indigo-500" />
      <p className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{date}</p>
      <p className="text-[13px] text-slate-700 font-medium">{text}</p>
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

// ── Modal: set fixed salary / compensation kind ────────────────────────────────
function SetSalaryModal({ open, onClose, personId, current }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [kind,    setKind]    = useState(current?.compensation_type ?? 'fixed')
  const [salary,  setSalary]  = useState(current?.fixed_salary    != null ? String(current.fixed_salary)              : '')
  const [rate,    setRate]    = useState(current?.commission_rate  != null ? String(current.commission_rate * 100)     : '')
  const [from,    setFrom]    = useState('')
  const [notes,   setNotes]   = useState('')

  useEffect(() => {
    if (open) {
      setKind(current?.compensation_type ?? 'fixed')
      setSalary(current?.fixed_salary    != null ? String(current.fixed_salary)          : '')
      setRate(current?.commission_rate   != null ? String(current.commission_rate * 100) : '')
      setFrom(''); setNotes('')
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

// ── Modal: set personal commission rate override ───────────────────────────────
function PersonalRateModal({ open, onClose, personId, commType, label, existing }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [rate,  setRate]  = useState(existing ? String(+(existing.rate * 100).toFixed(4)) : '')
  const [from,  setFrom]  = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (open) {
      setRate(existing ? String(+(existing.rate * 100).toFixed(4)) : '')
      setFrom(''); setNotes('')
    }
  }, [open])

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
function CommRateRow({ rowDef, empConfig, teamConfig, personId }) {
  const [open, setOpen] = useState(false)
  const active = empConfig ?? teamConfig
  const isPersonal = !!empConfig

  return (
    <>
      <div className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl bg-slate-50 border border-slate-100">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-slate-700">{rowDef.label}</p>
          {isPersonal && (
            <p className="text-[10px] text-indigo-500 font-medium mt-0.5">Личная ставка</p>
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
      />
    </>
  )
}

// ── Main pay panel ─────────────────────────────────────────────────────────────
function PayPanel({ person, teamId, teamName, teamColor, teams, employees, empConfigs, teamConfigs, salaryData }) {
  const [showTeam,    setShowTeam]    = useState(false)
  const [showSalary,  setShowSalary]  = useState(false)
  const isCourier = person.role === 'courier'

  const color = teamColor ?? '#6366f1'

  // Index configs by commission_type
  const empByType  = {}
  const teamByType = {}
  empConfigs.filter(isConfigActive).forEach(c => { empByType[c.commission_type] = c })
  teamConfigs.filter(isConfigActive).forEach(c => { teamByType[c.commission_type] = c })

  const commRows = COMM_ROWS[person.role] ?? []

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
      <h2 className="text-[14px] font-bold text-slate-900 tracking-tight">Оплата</h2>

      {/* ── Team row ──────────────────────────────────────────────────────── */}
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

      {/* ── Courier note ──────────────────────────────────────────────────── */}
      {isCourier && (
        <div className="flex items-start gap-3 bg-amber-50 rounded-xl p-4 border border-amber-100">
          <TrendingUp size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-[12.5px] text-amber-700 font-medium">
            Оплата по тарифу доставки.
          </p>
        </div>
      )}

      {/* ── Salary card (non-courier) ──────────────────────────────────────── */}

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

function FilterBar({ q, setQ, roleFilter, setRoleFilter, statusFilter, setStatusFilter, teamFilter, setTeamFilter, teams, teamColorMap, onClear }) {
  const hasFilters = q || roleFilter !== 'all' || statusFilter !== 'all' || teamFilter !== 'all'

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-2.5 mb-8 flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="flex-1 min-w-[220px] flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-3.5 h-11 focus-within:border-indigo-300 transition-colors">
        <Search size={14} className="text-slate-400 flex-shrink-0" />
        <input
          type="text"
          placeholder="Поиск по имени, должности, команде..."
          value={q}
          onChange={e => setQ(e.target.value)}
          className="flex-1 bg-transparent outline-none text-[13.5px] text-slate-800 placeholder:text-slate-400"
        />
        {q && <button onClick={() => setQ('')}><X size={13} className="text-slate-400 hover:text-slate-600" /></button>}
      </div>

      <div className="w-px h-7 bg-slate-200 flex-shrink-0 hidden sm:block" />

      {/* Role filter */}
      <SelectBox label="Должность" value={roleFilter} onChange={setRoleFilter}>
        <option value="all">Все должности</option>
        {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </SelectBox>

      {/* Status filter */}
      <SelectBox label="Статус" value={statusFilter} onChange={setStatusFilter}>
        <option value="all">Все статусы</option>
        {STATUS_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </SelectBox>

      {/* Team filter */}
      <SelectBox label="Команда" value={teamFilter} onChange={setTeamFilter}>
        <option value="all">Все команды</option>
        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </SelectBox>

      {hasFilters && (
        <button onClick={onClear} className="h-11 px-4 rounded-xl border border-slate-200 text-[13px] text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors font-medium">
          Сбросить
        </button>
      )}
    </div>
  )
}

function SelectBox({ label, value, onChange, children }) {
  return (
    <div className="relative flex-shrink-0">
      <label className="absolute -top-[7px] left-3 text-[9.5px] font-semibold uppercase tracking-widest text-slate-400 bg-white px-1 pointer-events-none z-10">
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-11 pl-3.5 pr-8 rounded-xl border border-slate-200 bg-white text-[13px] font-medium text-slate-700 appearance-none focus:outline-none focus:border-indigo-300 min-w-[148px]"
      >
        {children}
      </select>
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TeamDirectoryPage() {
  const { employees, teams, teamColorMap, membershipMap, loading, invalidate } = useDirectory()

  const [selected, setSelected]       = useState(null)
  const [q, setQ]                     = useState('')
  const [roleFilter, setRoleFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [teamFilter, setTeamFilter]   = useState('all')

  // Build a team name map
  const teamNameMap = useMemo(() => {
    const m = {}
    teams.forEach(t => { m[t.id] = t.name })
    return m
  }, [teams])

  // Filter employees
  const filtered = useMemo(() => {
    const qLow = q.toLowerCase()
    return employees.filter(p => {
      const teamId = membershipMap[p.id]
      const teamN  = teamId ? (teamNameMap[teamId] ?? '').toLowerCase() : ''
      const matchQ = !q || p.full_name.toLowerCase().includes(qLow) || (ROLE_LABEL[p.role] ?? '').toLowerCase().includes(qLow) || teamN.includes(qLow)
      const matchR = roleFilter   === 'all' || p.role    === roleFilter
      const matchS = statusFilter === 'all' || (p.status ?? 'offline') === statusFilter
      const matchT = teamFilter   === 'all' || teamId === teamFilter
      return matchQ && matchR && matchS && matchT
    })
  }, [employees, membershipMap, teamNameMap, q, roleFilter, statusFilter, teamFilter])

  function clearFilters() {
    setQ(''); setRoleFilter('all'); setStatusFilter('all'); setTeamFilter('all')
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
          <p className="text-[13.5px] text-slate-500 mt-1">Все сотрудники компании</p>
        </div>
        <span className="text-[13px] font-semibold text-slate-800 bg-white border border-slate-200 rounded-full px-4 py-1.5 shadow-sm">
          {loading ? '…' : `${filtered.length} чел.`}
        </span>
      </div>

      {/* Filters */}
      <FilterBar
        q={q} setQ={setQ}
        roleFilter={roleFilter}   setRoleFilter={setRoleFilter}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        teamFilter={teamFilter}   setTeamFilter={setTeamFilter}
        teams={teams}
        teamColorMap={teamColorMap}
        onClear={clearFilters}
      />

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-100 overflow-hidden animate-pulse">
              <div className="aspect-[1/0.92] bg-slate-100" />
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
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
    </div>
  )
}
