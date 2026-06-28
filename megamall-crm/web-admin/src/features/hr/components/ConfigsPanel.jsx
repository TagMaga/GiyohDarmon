import { useState }                    from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Badge   from '../../../shared/components/Badge'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import Modal   from '../../../shared/components/Modal'
import EmptyState from '../../../shared/components/EmptyState'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { useToast } from '../../../shared/components/ToastProvider'
import { createConfig, disableConfig } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import {
  fmtPct, fmtDate, isConfigActive,
  COMMISSION_TYPE_LABEL, COMMISSION_TYPE_BADGE,
  SCOPE_LABEL, SCOPE_BADGE,
  teamName, userName,
} from '../utils/hrHelpers'
import { Settings, Plus } from 'lucide-react'

const ALL_SCOPES = ['global', 'team', 'employee']
const ALL_TYPES  = ['seller_rate','manager_team_rate','manager_personal_rate','team_lead_pool_rate','company_rate']
const DEFAULT_NOTE = 'Обновлено без примечания'

// ── Create config modal ───────────────────────────────────────────────────────

function CreateConfigModal({ open, onClose, teams, users }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [scope,          setScope]          = useState('global')
  const [teamId,         setTeamId]         = useState('')
  const [userId,         setUserId]         = useState('')
  const [commType,       setCommType]       = useState('seller_rate')
  const [rate,           setRate]           = useState('')
  const [effectiveFrom,  setEffectiveFrom]  = useState('')
  const [notes,          setNotes]          = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      const rateNum = parseFloat(rate)   // user enters %, e.g. 10 meaning 10%
      if (isNaN(rateNum) || rateNum <= 0 || rateNum > 100) throw new Error('Введите значение от 0 до 100%')
      if (!effectiveFrom) throw new Error('Дата начала обязательна')
      if (!notes.trim())  throw new Error('Причина обязательна')
      return createConfig({
        scope,
        team_id: scope === 'team'     ? teamId   || undefined : undefined,
        user_id: scope === 'employee' ? userId   || undefined : undefined,
        commission_type:  commType,
        rate:             rateNum / 100,  // convert % → decimal for API
        effective_from:   new Date(effectiveFrom).toISOString(),
        notes:            notes.trim(),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.hr.configs })
      toast.success('Конфигурация создана')
      reset(); setScope('global'); setTeamId(''); setUserId(''); setCommType('seller_rate')
      setRate(''); setEffectiveFrom(''); setNotes(''); onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Новая конфигурация ставки" size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={isPending}>Отмена</Button>
        <Button variant="primary" onClick={() => mutate()} loading={isPending}>Создать</Button>
      </>}
    >
      {error && <Alert variant="error" className="mb-4">{error.response?.data?.error?.message ?? error.message}</Alert>}
      <div className="space-y-4">
        <div><label className="input-label">Область применения *</label>
          <select value={scope} onChange={e => setScope(e.target.value)} className="input mt-1">
            {ALL_SCOPES.map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
          </select>
        </div>
        {scope === 'team' && (
          <div><label className="input-label">Команда *</label>
            <select value={teamId} onChange={e => setTeamId(e.target.value)} className="input mt-1">
              <option value="">Выберите команду…</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        {scope === 'employee' && (
          <div><label className="input-label">Сотрудник *</label>
            <select value={userId} onChange={e => setUserId(e.target.value)} className="input mt-1">
              <option value="">Выберите сотрудника…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name ?? u.FullName ?? u.id}</option>)}
            </select>
          </div>
        )}
        <div><label className="input-label">Тип комиссии *</label>
          <select value={commType} onChange={e => setCommType(e.target.value)} className="input mt-1">
            {ALL_TYPES.map(t => <option key={t} value={t}>{COMMISSION_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
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
          <p className="text-xs text-slate-400 mt-1">Введите процент. Например: 10 = 10%</p>
        </div>
        <div><label className="input-label">Действует с *</label>
          <input type="datetime-local" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} className="input mt-1" />
        </div>
        <div><label className="input-label">Причина *</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input resize-none mt-1" rows={2} placeholder="Изменение ставки по итогам квартала…" />
        </div>
      </div>
    </Modal>
  )
}

// ── Disable config modal ──────────────────────────────────────────────────────

function DisableModal({ open, onClose, config }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [effectiveTo, setEffectiveTo] = useState('')
  const [notes,       setNotes]       = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!effectiveTo) throw new Error('Укажите дату отключения')
      return disableConfig(config.id, { effective_to: new Date(effectiveTo).toISOString(), notes: notes.trim() || DEFAULT_NOTE })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.hr.configs })
      qc.invalidateQueries({ queryKey: KEYS.hr.history })
      toast.success('Конфигурация отключена')
      reset(); setEffectiveTo(''); setNotes(''); onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Отключить конфигурацию"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={isPending}>Отмена</Button>
        <Button variant="danger" onClick={() => mutate()} loading={isPending}>Отключить</Button>
      </>}
    >
      {error && <Alert variant="error" className="mb-4">{error.message}</Alert>}
      <div className="space-y-4">
        <Alert variant="warning">Конфигурация будет деактивирована с указанной даты.</Alert>
        <div><label className="input-label">Дата отключения *</label>
          <input type="datetime-local" value={effectiveTo} onChange={e => setEffectiveTo(e.target.value)} className="input mt-1" />
        </div>
      </div>
    </Modal>
  )
}

// ── Main ConfigsPanel ─────────────────────────────────────────────────────────

export default function ConfigsPanel({ configs, teams, users, teamMap, userMap, loading }) {
  const [showCreate,   setShowCreate]   = useState(false)
  const [disableItem,  setDisableItem]  = useState(null)
  const [scopeFilter,  setScopeFilter]  = useState('')
  const [typeFilter,   setTypeFilter]   = useState('')

  const filtered = configs.filter(c => {
    if (scopeFilter && c.scope !== scopeFilter) return false
    if (typeFilter  && c.commission_type !== typeFilter) return false
    return true
  })

  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <CardSkeleton key={i} />)}</div>

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)} className="input sm:w-44">
          <option value="">Все области</option>
          {ALL_SCOPES.map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input flex-1">
          <option value="">Все типы</option>
          {ALL_TYPES.map(t => <option key={t} value={t}>{COMMISSION_TYPE_LABEL[t]}</option>)}
        </select>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setShowCreate(true)} className="sm:flex-shrink-0">
          Добавить
        </Button>
      </div>

      {/* Config list */}
      {filtered.length === 0 && <EmptyState icon={<Settings size={22} />} title="Конфигурации не найдены" />}

      <div className="space-y-3">
        {filtered.map((cfg, i) => {
          const active = isConfigActive(cfg)
          return (
            <div key={cfg.id ?? i} className={`card p-4 space-y-2 ${active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={COMMISSION_TYPE_BADGE[cfg.commission_type] ?? 'slate'} size="sm">
                    {COMMISSION_TYPE_LABEL[cfg.commission_type] ?? cfg.commission_type}
                  </Badge>
                  <Badge variant={SCOPE_BADGE[cfg.scope] ?? 'slate'} size="sm">{SCOPE_LABEL[cfg.scope] ?? cfg.scope}</Badge>
                  <Badge variant={active ? 'emerald' : 'slate'} size="sm">{active ? 'Активна' : 'Архив'}</Badge>
                </div>
                <p className="text-lg font-bold text-indigo-700 flex-shrink-0">{fmtPct(cfg.rate)}</p>
              </div>

              {cfg.scope === 'team'     && cfg.team_id && <p className="text-xs text-slate-500">Команда: <span className="font-medium">{teamName(teamMap, cfg.team_id)}</span></p>}
              {cfg.scope === 'employee' && cfg.user_id && <p className="text-xs text-slate-500">Сотрудник: <span className="font-medium">{userName(userMap, cfg.user_id)}</span></p>}

              <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                <span>С {fmtDate(cfg.effective_from)}</span>
                {cfg.effective_to && <span>по {fmtDate(cfg.effective_to)}</span>}
              </div>

              {cfg.notes && <p className="text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-1.5">{cfg.notes}</p>}

              {active && (
                <Button variant="secondary" size="sm" onClick={() => setDisableItem(cfg)}>Отключить</Button>
              )}
            </div>
          )
        })}
      </div>

      <CreateConfigModal open={showCreate}    onClose={() => setShowCreate(false)}  teams={teams} users={users} />
      <DisableModal      open={!!disableItem} onClose={() => setDisableItem(null)}  config={disableItem} />
    </div>
  )
}
