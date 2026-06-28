/**
 * TeamFinancialModelSection — Phase 15.5
 *
 * Design principle:
 *   A TEAM never earns money. Only people earn money.
 *   This page answers ONE question:
 *   "When an order is delivered, how is net revenue distributed?"
 *
 * Page is structured around a Revenue Distribution Model, not a payroll list.
 *
 * Visible commission types (team scope):
 *   seller_rate           → Продавец
 *   manager_team_rate     → Менеджер команды
 *   manager_personal_rate → Личные заказы менеджера
 *   team_lead_pool_rate   → Руководитель группы (gets остаток if no fixed rate)
 *
 * company_rate:
 *   Intentionally READ-ONLY here — it is a global owner-level setting,
 *   not a per-team parameter. Fetched from global configs for simulation only.
 *
 * No backend changes. No API contract changes. Frontend only.
 */
import { useState, useMemo }            from 'react'
import { useMutation, useQueryClient }  from '@tanstack/react-query'
import {
  ShoppingBag, Users2, User, Award,
  Building2, Edit2, History, ChevronDown, ChevronUp,
  ExternalLink, Calculator, Info,
} from 'lucide-react'

import Badge             from '../../../shared/components/Badge'
import Button            from '../../../shared/components/Button'
import Alert             from '../../../shared/components/Alert'
import Modal             from '../../../shared/components/Modal'
import { CardSkeleton }  from '../../../shared/components/Skeleton'
import { useToast }      from '../../../shared/components/ToastProvider'
import { KEYS }          from '../../../shared/queryKeys'
import useConfigs        from '../../hr/hooks/useConfigs'
import { createConfig, disableConfig } from '../api'
import { fmtPct, fmtDate, isConfigActive } from '../utils/peopleHelpers'
const DEFAULT_NOTE = 'Обновлено без примечания'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_DEFS = [
  {
    key:         'seller_rate',
    title:       'Продавец',
    shortTitle:  'Продавец',
    description: 'Получает процент от стоимости заказов, которые оформили продавцы команды.',
    Icon:        ShoppingBag,
    accent:      'emerald',
  },
  {
    key:         'manager_team_rate',
    title:       'Менеджер команды',
    shortTitle:  'Менеджер',
    description: 'Получает процент с заказов продавцов своей команды.',
    Icon:        Users2,
    accent:      'violet',
  },
  {
    key:         'manager_personal_rate',
    title:       'Личные заказы менеджера',
    shortTitle:  'Менеджер (лично)',
    description: 'Применяется только если менеджер сам оформил заказ.',
    Icon:        User,
    accent:      'sky',
    isPersonal:  true,   // separate order type — shown below the main 3 in sim
  },
  {
    key:         'team_lead_pool_rate',
    title:       'Руководитель группы',
    shortTitle:  'Руководитель',
    description: 'Получает остаточный доход после распределения между продавцом и менеджером.',
    Icon:        Award,
    accent:      'amber',
    isPool:      true,   // gets remainder when no fixed rate set
  },
]

// Roles shown in the main revenue flow (excludes manager_personal which is a different order type)
const FLOW_ROLES = ['seller_rate', 'manager_team_rate', 'team_lead_pool_rate']

// Tailwind class maps (explicit to survive Tailwind purge)
const A = {
  bg:       { emerald:'bg-emerald-50',  violet:'bg-violet-50',  sky:'bg-sky-50',  amber:'bg-amber-50',  slate:'bg-slate-50'  },
  text:     { emerald:'text-emerald-600',violet:'text-violet-600',sky:'text-sky-600',amber:'text-amber-600',slate:'text-slate-500'},
  ring:     { emerald:'ring-emerald-200',violet:'ring-violet-200',sky:'ring-sky-200',amber:'ring-amber-200',slate:'ring-slate-200'},
  bar:      { emerald:'bg-emerald-400', violet:'bg-violet-400', sky:'bg-sky-400', amber:'bg-amber-400', slate:'bg-slate-300' },
  softBtn:  {
    emerald:'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
    violet: 'bg-violet-50  hover:bg-violet-100  text-violet-700  ring-1 ring-violet-200',
    sky:    'bg-sky-50     hover:bg-sky-100     text-sky-700     ring-1 ring-sky-200',
    amber:  'bg-amber-50   hover:bg-amber-100   text-amber-700   ring-1 ring-amber-200',
  },
  primBtn:  {
    emerald:'bg-emerald-600 hover:bg-emerald-700 text-white',
    violet: 'bg-violet-600  hover:bg-violet-700  text-white',
    sky:    'bg-sky-600     hover:bg-sky-700     text-white',
    amber:  'bg-amber-500   hover:bg-amber-600   text-white',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt2(n) {
  // format a float to at most 2 decimal places, trim trailing zeros
  return Number(n.toFixed(2)).toString()
}

function fmtSom(n) {
  if (!isFinite(n) || n == null) return '—'
  return fmt2(n) + ' с'
}

function pctLabel(rate) {
  if (rate == null) return '—'
  return (rate * 100).toFixed(2).replace(/\.?0+$/, '') + '%'
}

// Build distribution from rates for a given net revenue amount
function calcDistribution({ netRevenue, companyRate, sellerRate, managerRate, poolRate }) {
  const nr = Math.max(0, netRevenue)
  const company  = nr * (companyRate  ?? 0)
  const seller   = nr * (sellerRate   ?? 0)
  const manager  = nr * (managerRate  ?? 0)
  // pool: if poolRate is explicitly set, use it; otherwise get remainder
  const poolFixed = poolRate != null ? nr * poolRate : null
  const remainder = Math.max(0, nr - company - seller - manager)
  const pool      = poolFixed !== null ? poolFixed : remainder

  return { company, seller, manager, pool, remainder }
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfigRuleModal
// ─────────────────────────────────────────────────────────────────────────────

function ConfigRuleModal({ open, onClose, commType, scopeId, existingConfig }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const role  = ROLE_DEFS.find(r => r.key === commType)

  // rate stored as decimal (0.10), displayed/entered as percentage (10)
  const [rate,          setRate]          = useState(
    existingConfig ? String(+(existingConfig.rate * 100).toFixed(4)) : ''
  )
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [notes,         setNotes]         = useState('')

  const isEdit  = !!existingConfig
  const rateNum = parseFloat(rate)   // % value entered by user

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async () => {
      if (isNaN(rateNum) || rateNum <= 0 || rateNum > 100)
        throw new Error('Введите значение от 0 до 100%')
      if (!effectiveFrom)
        throw new Error('Укажите дату вступления в силу')
      if (!notes.trim())
        throw new Error('Укажите причину изменения')

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
        rate:            rateNum / 100,   // convert % → decimal for API
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

  const handleClose = () => { reset(); setRate(''); setEffectiveFrom(''); setNotes(''); onClose() }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? `Изменить правило — ${role?.title}` : `Настроить — ${role?.title}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button variant="primary" onClick={() => mutate()} loading={isPending}>
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

      {role && (
        <div className={`rounded-xl px-4 py-3 mb-5 ${A.bg[role.accent]}`}>
          <p className={`text-xs font-semibold ${A.text[role.accent]}`}>{role.title}</p>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{role.description}</p>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="input-label">Процент комиссии *</label>
          <div className="relative mt-1">
            <input
              type="number" min="0" max="100" step="0.01"
              value={rate} onChange={e => setRate(e.target.value)}
              className="input pr-8" placeholder="10"
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
            type="datetime-local" value={effectiveFrom}
            onChange={e => setEffectiveFrom(e.target.value)} className="input mt-1"
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
            value={notes} onChange={e => setNotes(e.target.value)}
            className="input resize-none mt-1" rows={2}
            placeholder="Например: обновление по итогам квартала"
          />
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DisableRuleModal
// ─────────────────────────────────────────────────────────────────────────────

function DisableRuleModal({ open, onClose, config, scopeId, roleTitle }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [effectiveTo, setEffectiveTo] = useState('')
  const [notes,       setNotes]       = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!effectiveTo) throw new Error('Укажите дату отключения')
      return disableConfig(config.id, {
        effective_to: new Date(effectiveTo).toISOString(),
        notes:        notes.trim() || DEFAULT_NOTE,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.people.teamConfigs(scopeId) })
      toast.success('Правило отключено')
      reset(); setEffectiveTo(''); setNotes('')
      onClose()
    },
  })

  const handleClose = () => { reset(); setEffectiveTo(''); setNotes(''); onClose() }

  return (
    <Modal
      open={open} onClose={handleClose}
      title={`Отключить правило — ${roleTitle}`}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button variant="danger" onClick={() => mutate()} loading={isPending}>Отключить</Button>
        </>
      }
    >
      {error && <Alert variant="error" className="mb-4">{error.message}</Alert>}
      <div className="space-y-4">
        <Alert variant="warning">
          Правило будет деактивировано. Новые начисления прекратятся с указанной даты.
          Исторические расчёты не изменятся.
        </Alert>
        <div>
          <label className="input-label">Дата отключения *</label>
          <input
            type="datetime-local" value={effectiveTo}
            onChange={e => setEffectiveTo(e.target.value)} className="input mt-1"
          />
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RevenueSimulator — live distribution calculator
// ─────────────────────────────────────────────────────────────────────────────

function RevenueSimulator({ companyRate, sellerRate, managerRate, poolRate }) {
  const [netRevenue, setNetRevenue] = useState('1000')

  const nr = parseFloat(netRevenue) || 0
  const dist = useMemo(() =>
    calcDistribution({ netRevenue: nr, companyRate, sellerRate, managerRate, poolRate }),
    [nr, companyRate, sellerRate, managerRate, poolRate]
  )

  // Build bar segments (only visible roles: company, seller, manager, pool)
  const segments = [
    { label: 'Компания',       amount: dist.company,  pct: companyRate,  accent: 'slate',   barColor: 'bg-slate-400'   },
    { label: 'Продавец',       amount: dist.seller,   pct: sellerRate,   accent: 'emerald', barColor: 'bg-emerald-400' },
    { label: 'Менеджер',       amount: dist.manager,  pct: managerRate,  accent: 'violet',  barColor: 'bg-violet-400'  },
    { label: 'Руководитель',   amount: dist.pool,     pct: poolRate,     accent: 'amber',   barColor: 'bg-amber-400', isPool: poolRate == null },
  ]

  const totalMapped = dist.company + dist.seller + dist.manager + dist.pool
  const unaccounted = Math.max(0, nr - totalMapped)

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 space-y-4 text-white">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Calculator size={15} className="text-slate-400" />
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Симулятор распределения</p>
      </div>

      {/* Input */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-[10px] text-slate-400 uppercase tracking-wide">Чистая выручка (сом)</label>
          <input
            type="number"
            min="0"
            step="100"
            value={netRevenue}
            onChange={e => setNetRevenue(e.target.value)}
            className="mt-1 w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-lg font-bold text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
            placeholder="1000"
          />
        </div>
        <div className="text-right pt-5">
          <p className="text-[10px] text-slate-500">= 100%</p>
          <p className="text-xl font-black text-white">{fmt2(nr)} с</p>
        </div>
      </div>

      {/* Stacked bar */}
      {nr > 0 && (
        <div className="w-full h-3 rounded-full bg-white/10 overflow-hidden flex">
          {segments.map((s, i) => {
            const widthPct = nr > 0 ? Math.max(0, (s.amount / nr) * 100) : 0
            return widthPct > 0.3 ? (
              <div
                key={i}
                className={`h-full ${s.barColor} transition-all duration-300`}
                style={{ width: `${widthPct}%` }}
              />
            ) : null
          })}
          {unaccounted > 0.5 && (
            <div
              className="h-full bg-white/20"
              style={{ width: `${Math.min(100, (unaccounted / nr) * 100)}%` }}
            />
          )}
        </div>
      )}

      {/* Breakdown rows */}
      <div className="space-y-2">
        {segments.map((s, i) => {
          const isUnconfigured = s.pct == null && !s.isPool
          return (
            <div key={i} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.barColor}`} />
                <span className="text-sm text-slate-200">{s.label}</span>
                {s.isPool && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">
                    остаток
                  </span>
                )}
                {isUnconfigured && (
                  <span className="text-[10px] text-slate-500">не настроено</span>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <span className="text-xs text-slate-400 mr-2">
                  {s.isPool && s.pct == null ? '—' : pctLabel(s.pct)}
                </span>
                <span className={`text-sm font-bold ${isUnconfigured && !s.isPool ? 'text-slate-600' : 'text-white'}`}>
                  {fmtSom(s.amount)}
                </span>
              </div>
            </div>
          )
        })}
        {/* Unaccounted remainder notice */}
        {unaccounted > 0.5 && (
          <div className="flex items-center gap-2 pt-1 border-t border-white/10">
            <Info size={11} className="text-slate-500 flex-shrink-0" />
            <p className="text-[10px] text-slate-500">
              {fmtSom(unaccounted)} не распределено — настройте правила для всех участников.
            </p>
          </div>
        )}
      </div>

      {/* Company note */}
      {companyRate == null && (
        <div className="flex items-start gap-2 pt-1 border-t border-white/10">
          <Info size={11} className="text-slate-500 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Доля компании — глобальная настройка. Задаётся в разделе Финансовая модель → Настройки.
          </p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RoleConfigCard — compact card for each team role
// ─────────────────────────────────────────────────────────────────────────────

function RoleConfigCard({ role, activeConfig, scopeId }) {
  const [showEdit,    setShowEdit]    = useState(false)
  const [showDisable, setShowDisable] = useState(false)

  const { key, title, description, Icon, accent, isPool, isPersonal } = role
  const isConfigured = !!activeConfig

  return (
    <>
      <div className={`bg-white rounded-2xl border p-4 flex flex-col gap-3 transition-shadow hover:shadow-sm ${
        isConfigured ? `border-transparent ring-1 ${A.ring[accent]}` : 'border-slate-200'
      }`}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${A.bg[accent]}`}>
              <Icon size={14} className={A.text[accent]} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800 leading-tight">{title}</p>
              {isPersonal && (
                <p className="text-[10px] text-slate-400 leading-tight">отдельный тип заказа</p>
              )}
            </div>
          </div>
          {isConfigured ? (
            <div className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${A.bg[accent]} ${A.text[accent]}`}>
              Активно
            </div>
          ) : (
            <div className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">
              Не настроено
            </div>
          )}
        </div>

        {/* Description */}
        <p className="text-[11px] text-slate-400 leading-relaxed">{description}</p>

        {/* Rate display */}
        <div className="flex items-end justify-between gap-2 mt-auto">
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Текущее правило</p>
            {isConfigured ? (
              <p className={`text-2xl font-black ${A.text[accent]} tracking-tight leading-none mt-0.5`}>
                {fmtPct(activeConfig.rate)}
              </p>
            ) : (
              <p className="text-lg font-bold text-slate-300 leading-none mt-0.5">
                {isPool ? 'Остаток' : '—'}
              </p>
            )}
            {isConfigured && (
              <p className="text-[10px] text-slate-400 mt-1">
                С {fmtDate(activeConfig.effective_from)}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowEdit(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors min-h-[32px] ${
              isConfigured ? A.softBtn[accent] : A.primBtn[accent]
            }`}
          >
            <Edit2 size={11} />
            {isConfigured ? 'Изменить' : 'Настроить'}
          </button>
          {isConfigured && (
            <button
              onClick={() => setShowDisable(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-500 bg-rose-50 hover:bg-rose-100 transition-colors min-h-[32px]"
            >
              Отключить
            </button>
          )}
        </div>
      </div>

      <ConfigRuleModal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        commType={key}
        scopeId={scopeId}
        existingConfig={isConfigured ? activeConfig : null}
      />
      {isConfigured && (
        <DisableRuleModal
          open={showDisable}
          onClose={() => setShowDisable(false)}
          config={activeConfig}
          scopeId={scopeId}
          roleTitle={title}
        />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CompanyReadOnlyCard — global setting, not editable here
// ─────────────────────────────────────────────────────────────────────────────

function CompanyReadOnlyCard({ companyRate }) {
  return (
    <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-200">
            <Building2 size={14} className="text-slate-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-700 leading-tight">Компания</p>
            <p className="text-[10px] text-slate-400 leading-tight">глобальная настройка</p>
          </div>
        </div>
        <div className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-500">
          Только чтение
        </div>
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        Доля компании не является командной настройкой.
        Она применяется ко всем заказам и устанавливается владельцем глобально.
      </p>

      <div>
        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Текущее правило</p>
        <p className="text-2xl font-black text-slate-500 tracking-tight leading-none mt-0.5">
          {companyRate != null ? pctLabel(companyRate) : '—'}
        </p>
        {companyRate == null && (
          <p className="text-[10px] text-slate-400 mt-0.5">Не задана</p>
        )}
      </div>

      <a
        href="/owner/finance"
        className="flex items-center gap-1.5 self-start px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-500 bg-slate-200 hover:bg-slate-300 transition-colors min-h-[32px]"
      >
        <ExternalLink size={11} />
        Финансовая модель → Настройки
      </a>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HistoryPanel
// ─────────────────────────────────────────────────────────────────────────────

function HistoryPanel({ configs = [] }) {
  const [open, setOpen] = useState(false)
  const history = configs.filter(c => !isConfigActive(c))
  if (history.length === 0) return null

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors select-none min-h-[36px]"
      >
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        <History size={13} />
        История правил ({history.length})
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {history.map((cfg, i) => {
            const role = ROLE_DEFS.find(r => r.key === cfg.commission_type)
            return (
              <div key={cfg.id ?? i}
                className="flex items-center justify-between gap-3 bg-slate-50 rounded-xl px-3 py-2.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Badge
                    variant={role ? { emerald:'emerald',violet:'violet',sky:'sky',amber:'amber' }[role.accent] ?? 'slate' : 'slate'}
                    size="sm"
                  >
                    {role?.title ?? cfg.commission_type}
                  </Badge>
                  <span className="text-xs text-slate-400 truncate">
                    {fmtDate(cfg.effective_from)} — {cfg.effective_to ? fmtDate(cfg.effective_to) : 'сейчас'}
                  </span>
                </div>
                <span className="text-sm font-bold text-slate-500 flex-shrink-0">
                  {fmtPct(cfg.rate)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TeamFinancialModelSection
 *
 * Props:
 *   configs   {Array}   all CommissionConfig rows for this team (active + history)
 *   scopeId   {string}  teamId
 *   loading   {bool}
 */
export default function TeamFinancialModelSection({ configs = [], scopeId, loading }) {
  // Fetch global configs to get company_rate (no new API — uses existing hr endpoint,
  // results cached if HrDashboard was visited, network call if not)
  const { data: globalConfigs = [] } = useConfigs()

  // Index active team configs by commission_type
  const activeByType = useMemo(() => {
    const m = {}
    configs.filter(isConfigActive).forEach(c => { m[c.commission_type] = c })
    return m
  }, [configs])

  // Find active global company_rate
  const activeCompanyConfig = useMemo(() =>
    globalConfigs.find(c => c.commission_type === 'company_rate' && isConfigActive(c)),
    [globalConfigs]
  )
  const companyRate = activeCompanyConfig?.rate ?? null

  // Rates for simulator
  const sellerRate  = activeByType['seller_rate']?.rate  ?? null
  const managerRate = activeByType['manager_team_rate']?.rate ?? null
  const poolRate    = activeByType['team_lead_pool_rate']?.rate ?? null

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-48 bg-slate-800 rounded-2xl animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4, 5].map(i => <CardSkeleton key={i} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-slate-800">Финансовая модель команды</h2>
        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
          Настройте распределение выручки между участниками команды.
          Доля компании — глобальная настройка и здесь не редактируется.
        </p>
      </div>

      {/* Revenue Distribution Simulator — always visible */}
      <RevenueSimulator
        companyRate={companyRate}
        sellerRate={sellerRate}
        managerRate={managerRate}
        poolRate={poolRate}
      />

      {/* Role configuration cards — always visible, show unconfigured state when empty */}
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Правила начисления — редактирование
        </p>

        {/* Main 3: seller, manager_team, team_lead */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ROLE_DEFS.filter(r => !r.isPersonal).map(role => (
            <RoleConfigCard
              key={role.key}
              role={role}
              activeConfig={activeByType[role.key] ?? null}
              scopeId={scopeId}
            />
          ))}
          {/* Company card occupies the 4th slot in the 2×2 grid */}
          <CompanyReadOnlyCard companyRate={companyRate} />
        </div>

        {/* Personal manager orders — separate section */}
        <div className="mt-3">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Личные заказы менеджера
          </p>
          <div className="max-w-sm">
            {ROLE_DEFS.filter(r => r.isPersonal).map(role => (
              <RoleConfigCard
                key={role.key}
                role={role}
                activeConfig={activeByType[role.key] ?? null}
                scopeId={scopeId}
              />
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
            Применяется только когда заказ оформлен самим менеджером, не продавцом команды.
          </p>
        </div>
      </div>

      {/* History */}
      <HistoryPanel configs={configs} />
    </div>
  )
}
