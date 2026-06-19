/**
 * TeamMembersWithRates
 *
 * Member cards for the Team Profile → Участники tab.
 * Each card shows the member's role AND their relevant commission rule inline,
 * with Настроить / Изменить buttons — no separate Financial Model section needed.
 *
 * Commission data: team-scoped configs indexed by commission_type.
 * Rates are team-wide (all sellers share seller_rate, etc.).
 *
 * company_rate is NEVER shown or editable here — it is a global owner setting.
 * company_rate is enforced absent by never passing it to any modal.
 */
import { useState }               from 'react'
import { useNavigate }             from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, ChevronRight, Edit2, Plus } from 'lucide-react'

import Badge             from '../../../shared/components/Badge'
import Alert             from '../../../shared/components/Alert'
import Button            from '../../../shared/components/Button'
import Modal             from '../../../shared/components/Modal'
import EmptyState        from '../../../shared/components/EmptyState'
import { CardSkeleton }  from '../../../shared/components/Skeleton'
import { useToast }      from '../../../shared/components/ToastProvider'
import { KEYS }          from '../../../shared/queryKeys'
import { createConfig, disableConfig } from '../api'
import { ROLE_LABEL, ROLE_BADGE, fmtPct, fmtDate, isConfigActive } from '../utils/peopleHelpers'

// ─────────────────────────────────────────────────────────────────────────────
// Commission row definitions per user role
// Each entry: { commType, label, accent, isPool? }
// ─────────────────────────────────────────────────────────────────────────────

const COMMISSION_ROWS_BY_ROLE = {
  seller: [
    { commType: 'seller_rate',          label: 'Комиссия продавца',   accent: 'emerald' },
  ],
  manager: [
    { commType: 'manager_team_rate',    label: 'Комиссия с команды',  accent: 'violet'  },
    { commType: 'manager_personal_rate',label: 'Личные заказы',       accent: 'sky'     },
  ],
  sales_team_lead: [
    { commType: 'team_lead_pool_rate',  label: 'Пул руководителя',    accent: 'amber', isPool: true },
  ],
}

// Tailwind class maps — explicit so Tailwind purge doesn't strip them
const ACCENT = {
  text:    { emerald:'text-emerald-700', violet:'text-violet-700', sky:'text-sky-700', amber:'text-amber-700' },
  bg:      { emerald:'bg-emerald-50',    violet:'bg-violet-50',    sky:'bg-sky-50',    amber:'bg-amber-50'    },
  ring:    { emerald:'ring-emerald-200', violet:'ring-violet-200', sky:'ring-sky-200', amber:'ring-amber-200' },
  softBtn: {
    emerald: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
    violet:  'bg-violet-50  hover:bg-violet-100  text-violet-700  ring-1 ring-violet-200',
    sky:     'bg-sky-50     hover:bg-sky-100     text-sky-700     ring-1 ring-sky-200',
    amber:   'bg-amber-50   hover:bg-amber-100   text-amber-700   ring-1 ring-amber-200',
  },
  primBtn: {
    emerald: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    violet:  'bg-violet-600  hover:bg-violet-700  text-white',
    sky:     'bg-sky-600     hover:bg-sky-700     text-white',
    amber:   'bg-amber-500   hover:bg-amber-600   text-white',
  },
}

// Human-readable titles used inside modals
const RULE_TITLE = {
  seller_rate:           'Комиссия продавца',
  manager_team_rate:     'Комиссия с команды (менеджер)',
  manager_personal_rate: 'Личные заказы менеджера',
  team_lead_pool_rate:   'Пул руководителя',
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfigRuleModal — create a new rule or replace an existing one
// ─────────────────────────────────────────────────────────────────────────────

function ConfigRuleModal({ open, onClose, commType, scopeId, existingConfig }) {
  const qc      = useQueryClient()
  const toast   = useToast()
  const isEdit  = !!existingConfig
  const title   = RULE_TITLE[commType] ?? commType

  // rate is stored as decimal (0.10) but displayed/entered as percentage (10)
  const [rate,          setRate]          = useState(
    existingConfig ? String(+(existingConfig.rate * 100).toFixed(4)) : ''
  )
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [notes,         setNotes]         = useState('')

  const rateNum = parseFloat(rate)   // in % — user types 10 meaning 10%

  const rowDef = Object.values(COMMISSION_ROWS_BY_ROLE)
    .flat()
    .find(r => r.commType === commType)

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async () => {
      if (isNaN(rateNum) || rateNum <= 0 || rateNum > 100)
        throw new Error('Введите значение от 0 до 100%')
      if (!effectiveFrom)
        throw new Error('Укажите дату вступления в силу')
      if (!notes.trim())
        throw new Error('Укажите причину изменения')

      // Immutable versioning: close existing rule first, then create new one
      if (isEdit) {
        await disableConfig(existingConfig.id, {
          effective_to: new Date(effectiveFrom).toISOString(),
          notes:        `Заменено: ${notes.trim()}`,
        })
      }

      return createConfig({
        scope:           'team',
        team_id:         scopeId,
        commission_type: commType,
        rate:            rateNum / 100,      // convert % → decimal for API
        effective_from:  new Date(effectiveFrom).toISOString(),
        notes:           notes.trim(),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.people.teamConfigs(scopeId) })
      toast.success(isEdit ? 'Правило обновлено' : 'Правило создано')
      reset(); setRate(''); setEffectiveFrom(''); setNotes('')
      onClose()
    },
  })

  const handleClose = () => {
    reset(); setRate(''); setEffectiveFrom(''); setNotes('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? `Изменить — ${title}` : `Настроить — ${title}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button variant="primary"   onClick={() => mutate()} loading={isPending}>
            {isEdit ? 'Обновить' : 'Сохранить'}
          </Button>
        </>
      }
    >
      {error && (
        <Alert variant="error" className="mb-4">
          {error.response?.data?.error?.message ?? error.message}
        </Alert>
      )}

      {/* Context banner */}
      {rowDef && (
        <div className={`rounded-xl px-4 py-3 mb-5 ${ACCENT.bg[rowDef.accent]}`}>
          <p className={`text-xs font-semibold ${ACCENT.text[rowDef.accent]}`}>{title}</p>
          {rowDef.isPool && (
            <p className="text-xs text-slate-500 mt-0.5">
              Руководитель получает остаток после распределения между продавцом и менеджером.
            </p>
          )}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="input-label">Процент комиссии *</label>
          <div className="relative mt-1">
            <input
              type="number" min="0" max="100" step="0.01"
              value={rate}
              onChange={e => setRate(e.target.value)}
              className="input pr-8"
              placeholder="10"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400 pointer-events-none">
              %
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Введите процент. Например: 10 = 10%
          </p>
        </div>

        <div>
          <label className="input-label">Действует с *</label>
          <input
            type="datetime-local"
            value={effectiveFrom}
            onChange={e => setEffectiveFrom(e.target.value)}
            className="input mt-1"
          />
          {isEdit && (
            <p className="text-xs text-slate-400 mt-1">
              Текущее правило будет закрыто с этой даты.
            </p>
          )}
        </div>

        <div>
          <label className="input-label">Причина изменения *</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="input resize-none mt-1"
            rows={2}
            placeholder="Например: обновление по итогам квартала"
          />
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CommissionRow — one line inside a member card
// Shows the rule value (or "Не настроено") + action button
// ─────────────────────────────────────────────────────────────────────────────

function CommissionRow({ rowDef, config, scopeId }) {
  const [showModal, setShowModal] = useState(false)
  const isConfigured = !!config

  const valueDisplay = isConfigured
    ? fmtPct(config.rate)
    : (rowDef.isPool ? 'Остаток после распределения' : 'Не настроено')

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        {/* Label + value */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[11px] text-slate-500 whitespace-nowrap">{rowDef.label}:</span>
          {isConfigured ? (
            <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${ACCENT.bg[rowDef.accent]} ${ACCENT.text[rowDef.accent]}`}>
              {valueDisplay}
            </span>
          ) : (
            <span className={`text-[11px] ${rowDef.isPool ? `font-medium ${ACCENT.text[rowDef.accent]}` : 'text-slate-400 italic'}`}>
              {valueDisplay}
            </span>
          )}
        </div>

        {/* Action button */}
        <button
          onClick={() => setShowModal(true)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors min-h-[28px] flex-shrink-0 ${
            isConfigured
              ? ACCENT.softBtn[rowDef.accent]
              : 'bg-indigo-600 hover:bg-indigo-700 text-white'
          }`}
        >
          {isConfigured
            ? <><Edit2 size={10} /> Изменить</>
            : <><Plus  size={10} /> Настроить</>
          }
        </button>
      </div>

      <ConfigRuleModal
        open={showModal}
        onClose={() => setShowModal(false)}
        commType={rowDef.commType}
        scopeId={scopeId}
        existingConfig={isConfigured ? config : null}
      />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MemberCard
// ─────────────────────────────────────────────────────────────────────────────

function MemberCard({ member, userMap, activeByType, scopeId }) {
  const navigate = useNavigate()
  const user = userMap[member.user_id]

  if (!user) {
    return (
      <div className="card p-3 text-xs text-slate-400">
        Участник {member.user_id?.slice(0, 8)}… (данные не загружены)
      </div>
    )
  }

  const role     = user.role ?? user.Role ?? ''
  const initials = (user.full_name ?? '?')
    .trim()
    .split(/\s+/)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

  const commissionRows = COMMISSION_ROWS_BY_ROLE[role] ?? []
  const isCourier      = role === 'courier'

  return (
    <div className="card p-4 space-y-3">
      {/* ── Header: avatar + name + role badge ─────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-white">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate leading-tight">
            {user.full_name}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <Badge variant={ROLE_BADGE[role] ?? 'slate'} size="sm">
              {ROLE_LABEL[role] ?? role}
            </Badge>
            {user.is_active === false && (
              <Badge variant="slate" size="sm">Неактивен</Badge>
            )}
          </div>
        </div>
      </div>

      {/* ── Phone ──────────────────────────────────────────────────────── */}
      {user.phone && (
        <p className="text-xs text-slate-400 pl-[52px] -mt-1">{user.phone}</p>
      )}

      {/* ── Commission rows ─────────────────────────────────────────────── */}
      {isCourier ? (
        <div className="pl-[52px]">
          <span className="text-[11px] text-slate-400 italic">Оплата по тарифу доставки</span>
        </div>
      ) : commissionRows.length > 0 ? (
        <div className="pl-[52px] space-y-1.5">
          {commissionRows.map(rowDef => (
            <CommissionRow
              key={rowDef.commType}
              rowDef={rowDef}
              config={activeByType[rowDef.commType] ?? null}
              scopeId={scopeId}
            />
          ))}
        </div>
      ) : null}

      {/* ── Profile link ────────────────────────────────────────────────── */}
      <div className="pl-[52px] pt-0.5">
        <button
          onClick={() => navigate(`/owner/employees/${user.id}`)}
          className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors min-h-[32px]"
        >
          Открыть профиль <ChevronRight size={12} />
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Props:
 *   members   {Array}   hierarchy rows [{ user_id, team_id, … }]
 *   userMap   {object}  userId → user object
 *   configs   {Array}   team commission configs (active + history)
 *   scopeId   {string}  teamId — needed for create/update mutations
 *   loading   {bool}
 */
export default function TeamMembersWithRates({
  members  = [],
  userMap  = {},
  configs  = [],
  scopeId,
  loading,
}) {
  // Index active configs by commission_type — O(1) lookup per card
  const activeByType = {}
  configs.filter(isConfigActive).forEach(c => {
    // Never expose company_rate in team member cards
    if (c.commission_type !== 'company_rate') {
      activeByType[c.commission_type] = c
    }
  })

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <CardSkeleton key={i} />)}
      </div>
    )
  }

  if (members.length === 0) {
    return (
      <EmptyState
        icon={<Users size={20} />}
        title="Участники не назначены"
        description="Добавьте сотрудников в команду через профиль сотрудника."
      />
    )
  }

  return (
    <div className="space-y-3">
      {members.map((m, i) => (
        <MemberCard
          key={m.user_id ?? i}
          member={m}
          userMap={userMap}
          activeByType={activeByType}
          scopeId={scopeId}
        />
      ))}
    </div>
  )
}
