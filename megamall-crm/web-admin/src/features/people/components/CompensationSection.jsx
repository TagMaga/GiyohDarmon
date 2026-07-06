import { useState }                    from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Badge      from '../../../shared/components/Badge'
import Button     from '../../../shared/components/Button'
import Alert      from '../../../shared/components/Alert'
import Modal      from '../../../shared/components/Modal'
import EmptyState from '../../../shared/components/EmptyState'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { useToast }     from '../../../shared/components/ToastProvider'
import { KEYS }         from '../../../shared/queryKeys'
import { createConfig, disableConfig, setEmployeeCompensation } from '../api'
import {
  fmtPct, fmtDate, fmtMoney, isConfigActive,
  COMMISSION_TYPE_LABEL, COMMISSION_TYPE_BADGE,
  SCOPE_LABEL, SCOPE_BADGE,
} from '../utils/peopleHelpers'
import { Plus, FileText, DollarSign, Briefcase } from 'lucide-react'
import { useEmployeeCompensation, useEmployeeCompensationHistory } from '../hooks/useEmployeeCompensation'

const ALL_TYPES = [
  'seller_rate', 'manager_team_rate', 'manager_personal_rate',
  'team_lead_pool_rate', 'company_rate',
]
const DEFAULT_NOTE = 'Обновлено без примечания'

const COMP_KIND_LABEL = {
  percent: 'Процент',
  fixed:   'Фиксированная',
  mixed:   'Смешанная',
  none:    'Не назначено',
}

// ── AddConfigModal ─────────────────────────────────────────────────────────────

function AddConfigModal({ open, onClose, scope, scopeId }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [commType,      setCommType]      = useState('seller_rate')
  const [rate,          setRate]          = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [notes,         setNotes]         = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      const rateNum = parseFloat(rate)
      if (isNaN(rateNum) || rateNum <= 0 || rateNum > 100)
        throw new Error('Введите значение от 0 до 100%')
      if (!effectiveFrom) throw new Error('Дата начала действия обязательна')
      if (!notes.trim())  throw new Error('Укажите причину изменения')
      return createConfig({
        scope,
        ...(scope === 'employee' ? { user_id: scopeId } : {}),
        ...(scope === 'team'     ? { team_id: scopeId } : {}),
        commission_type: commType,
        rate:            rateNum / 100,
        effective_from:  new Date(effectiveFrom).toISOString(),
        notes:           notes.trim(),
      })
    },
    onSuccess: () => {
      if (scope === 'employee') qc.invalidateQueries({ queryKey: KEYS.people.employeeConfigs(scopeId) })
      if (scope === 'team')     qc.invalidateQueries({ queryKey: KEYS.people.teamConfigs(scopeId) })
      toast.success('Правило начисления создано')
      reset(); setRate(''); setEffectiveFrom(''); setNotes(''); setCommType('seller_rate')
      onClose()
    },
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новое правило начисления"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Отмена</Button>
          <Button variant="primary" onClick={() => mutate()} loading={isPending}>Создать</Button>
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
          <label className="input-label">Тип начисления *</label>
          <select value={commType} onChange={e => setCommType(e.target.value)} className="input mt-1">
            {ALL_TYPES.map(t => (
              <option key={t} value={t}>{COMMISSION_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="input-label">Комиссия (%) *</label>
          <div className="relative mt-1">
            <input type="number" min="0" max="100" step="0.01" value={rate}
              onChange={e => setRate(e.target.value)} className="input pr-8" placeholder="10" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400 pointer-events-none">%</span>
          </div>
        </div>
        <div>
          <label className="input-label">Действует с *</label>
          <input type="datetime-local" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} className="input mt-1" />
        </div>
        <div>
          <label className="input-label">Причина изменения *</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input resize-none mt-1" rows={2} placeholder="Пример: обновление по итогам квартала" />
        </div>
      </div>
    </Modal>
  )
}

// ── DisableModal ────────────────────────────────────────────────────────────────

function DisableModal({ open, onClose, config, scope, scopeId }) {
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
      if (scope === 'employee') qc.invalidateQueries({ queryKey: KEYS.people.employeeConfigs(scopeId) })
      if (scope === 'team')     qc.invalidateQueries({ queryKey: KEYS.people.teamConfigs(scopeId) })
      toast.success('Правило отключено')
      reset(); setEffectiveTo(''); setNotes('')
      onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Отключить правило"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Отмена</Button>
          <Button variant="danger" onClick={() => mutate()} loading={isPending}>Отключить</Button>
        </>
      }
    >
      {error && <Alert variant="error" className="mb-4">{error.message}</Alert>}
      <div className="space-y-4">
        <Alert variant="warning">
          Правило будет деактивировано. Новые начисления по этому правилу прекратятся с указанной даты.
        </Alert>
        <div>
          <label className="input-label">Дата отключения *</label>
          <input type="datetime-local" value={effectiveTo} onChange={e => setEffectiveTo(e.target.value)} className="input mt-1" />
        </div>
      </div>
    </Modal>
  )
}

// ── SetSalaryModal ─────────────────────────────────────────────────────────────

function SetSalaryModal({ open, onClose, scopeId, current }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [kind,          setKind]          = useState(current?.compensation_type ?? 'fixed')
  const [fixedSalary,   setFixedSalary]   = useState(current?.fixed_salary != null ? String(current.fixed_salary) : '')
  const [commRate,      setCommRate]      = useState(current?.commission_rate != null ? String(current.commission_rate * 100) : '')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [notes,         setNotes]         = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!effectiveFrom) throw new Error('Укажите дату начала')

      const body = {
        compensation_type: kind,
        effective_from:    new Date(effectiveFrom).toISOString(),
        notes:             notes.trim() || DEFAULT_NOTE,
      }

      if (kind === 'fixed' || kind === 'mixed') {
        const s = parseFloat(fixedSalary)
        if (isNaN(s) || s <= 0) throw new Error('Укажите корректную сумму фиксированной зарплаты')
        body.fixed_salary = s
      }
      if (kind === 'percent' || kind === 'mixed') {
        const r = parseFloat(commRate)
        if (isNaN(r) || r <= 0 || r > 100) throw new Error('Укажите процент от 0 до 100')
        body.commission_rate = r / 100
      }

      return setEmployeeCompensation(scopeId, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.people.employeeSalary(scopeId) })
      qc.invalidateQueries({ queryKey: KEYS.people.employeeSalaryHistory(scopeId) })
      toast.success('Компенсация обновлена')
      reset(); setEffectiveFrom(''); setNotes('')
      onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Настроить компенсацию" size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Отмена</Button>
          <Button variant="primary" onClick={() => mutate()} loading={isPending}>Сохранить</Button>
        </>
      }
    >
      {error && <Alert variant="error" className="mb-4">{error.response?.data?.error?.message ?? error.message}</Alert>}
      <div className="space-y-4">
        <div>
          <label className="input-label">Тип компенсации *</label>
          <select value={kind} onChange={e => setKind(e.target.value)} className="input mt-1">
            <option value="percent">Процент от заказов</option>
            <option value="fixed">Фиксированная зарплата</option>
            <option value="mixed">Смешанная (фикс + процент)</option>
            <option value="none">Не назначено</option>
          </select>
        </div>

        {(kind === 'fixed' || kind === 'mixed') && (
          <div>
            <label className="input-label">Фиксированная зарплата (смн/мес) *</label>
            <div className="relative mt-1">
              <input type="number" min="0" step="0.01" value={fixedSalary}
                onChange={e => setFixedSalary(e.target.value)} className="input pr-16" placeholder="3000" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 pointer-events-none">TJS/мес</span>
            </div>
          </div>
        )}

        {(kind === 'percent' || kind === 'mixed') && (
          <div>
            <label className="input-label">Процент комиссии *</label>
            <div className="relative mt-1">
              <input type="number" min="0" max="100" step="0.01" value={commRate}
                onChange={e => setCommRate(e.target.value)} className="input pr-8" placeholder="5" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400 pointer-events-none">%</span>
            </div>
          </div>
        )}

        <div>
          <label className="input-label">Действует с *</label>
          <input type="datetime-local" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} className="input mt-1" />
        </div>
        <div>
          <label className="input-label">Причина изменения *</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input resize-none mt-1" rows={2}
            placeholder="Пример: оформление, изменение условий" />
        </div>
      </div>
    </Modal>
  )
}

// ── SalaryCard ─────────────────────────────────────────────────────────────────

function SalaryCard({ salary, onEdit }) {
  if (!salary) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-7 text-center space-y-3">
        <Briefcase size={22} className="mx-auto text-slate-300" />
        <div>
          <p className="text-sm font-semibold text-slate-600">Компенсация не назначена</p>
          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
            Укажите тип компенсации: фиксированная зарплата, процент или смешанная схема.
          </p>
        </div>
        <button onClick={onEdit}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors min-h-[36px]">
          <DollarSign size={13} /> Назначить компенсацию
        </button>
      </div>
    )
  }

  const kindLabel = COMP_KIND_LABEL[salary.compensation_type] ?? salary.compensation_type
  const kindBadge = {
    percent: 'indigo',
    fixed:   'emerald',
    mixed:   'violet',
    none:    'slate',
  }[salary.compensation_type] ?? 'slate'

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={kindBadge}>{kindLabel}</Badge>
          {salary.is_active && <Badge variant="emerald" size="sm">Активна</Badge>}
        </div>
        <button onClick={onEdit}
          className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold min-h-[32px] px-2">
          Изменить
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {salary.fixed_salary != null && (
          <div>
            <p className="text-slate-400">Фиксированная</p>
            <p className="font-bold text-slate-900 mt-0.5">{fmtMoney(salary.fixed_salary)}/мес</p>
          </div>
        )}
        {salary.commission_rate != null && (
          <div>
            <p className="text-slate-400">Процент</p>
            <p className="font-bold text-indigo-700 mt-0.5">{fmtPct(salary.commission_rate)}</p>
          </div>
        )}
        <div>
          <p className="text-slate-400">С</p>
          <p className="font-semibold text-slate-700 mt-0.5">{fmtDate(salary.effective_from)}</p>
        </div>
        <div>
          <p className="text-slate-400">Валюта</p>
          <p className="font-semibold text-slate-700 mt-0.5">{salary.currency}</p>
        </div>
      </div>

      {salary.notes && (
        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-2 py-1">{salary.notes}</p>
      )}
    </div>
  )
}

// ── EmptyRulesState ────────────────────────────────────────────────────────────

function EmptyRulesState({ scope, onAdd, readOnly }) {
  if (scope === 'team') {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-7 text-center space-y-3">
        <FileText size={22} className="mx-auto text-slate-300" />
        <div>
          <p className="text-sm font-semibold text-slate-600">Правила не настроены</p>
          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
            Для этой команды ещё не настроены правила начисления.
          </p>
        </div>
        {!readOnly && (
          <button onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors min-h-[36px]">
            <Plus size={13} /> Создать правило
          </button>
        )}
      </div>
    )
  }
  return (
    <EmptyState icon={<FileText size={18} />} title="Нет правил начисления"
      description="Для этого сотрудника правила ещё не созданы." />
  )
}

// ── Main CompensationSection ───────────────────────────────────────────────────

/**
 * CompensationSection — reusable block for employee or team profile.
 *
 * Props:
 *   configs     {Array}           commission config rows for this entity
 *   scope       {'employee'|'team'}
 *   scopeId     {string}          userId or teamId
 *   loading     {bool}
 *   readOnly    {bool}            hides add/disable buttons (e.g. for couriers)
 *   courierNote {bool}            shows the delivery tariff note for couriers
 *   userRole    {string}          employee role, used to decide which sections to show
 */
export default function CompensationSection({
  configs    = [],
  scope,
  scopeId,
  loading,
  readOnly    = false,
  courierNote = false,
  userRole    = '',
}) {
  const [showAdd,      setShowAdd]      = useState(false)
  const [disableItem,  setDisableItem]  = useState(null)
  const [showSalary,   setShowSalary]   = useState(false)

  // Fixed salary data (only fetched for employee scope)
  const salaryEnabled = scope === 'employee' && !!scopeId
  const { data: salaryData, isLoading: salaryLoading } = useEmployeeCompensation(
    salaryEnabled ? scopeId : null
  )
  const { data: salaryHistory = [] } = useEmployeeCompensationHistory(
    salaryEnabled ? scopeId : null
  )

  if (loading || salaryLoading) {
    return <div className="space-y-2">{[1, 2].map(i => <CardSkeleton key={i} />)}</div>
  }

  const active  = configs.filter(isConfigActive)
  const history = configs.filter(c => !isConfigActive(c))

  // Determine which sections to show based on role
  const showFixedSalary = scope === 'employee' && !courierNote
  const showCommissions = !courierNote

  return (
    <div className="space-y-5">
      {/* ── Courier: delivery tariff note ───────────────────────────────── */}
      {courierNote && (
        <Alert variant="info">
          Курьеры получают оплату по <strong>тарифу доставки</strong>.
          Тариф настраивается в разделе Финансовая модель → Тариф доставки.
        </Alert>
      )}

      {/* ── Fixed salary section ─────────────────────────────────────────── */}
      {showFixedSalary && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Схема компенсации
            </p>
          </div>

          <SalaryCard salary={salaryData} onEdit={() => setShowSalary(true)} />

          {/* Salary history */}
          {salaryHistory.filter(h => !h.is_active).length > 0 && (
            <details className="group mt-2">
              <summary className="text-xs font-semibold text-slate-400 cursor-pointer hover:text-slate-600 select-none">
                История компенсаций ({salaryHistory.filter(h => !h.is_active).length})
              </summary>
              <div className="space-y-2 mt-2">
                {salaryHistory.filter(h => !h.is_active).map((h, i) => (
                  <div key={h.id ?? i} className="card p-3 opacity-60 space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <Badge variant="slate" size="sm">{COMP_KIND_LABEL[h.compensation_type] ?? h.compensation_type}</Badge>
                      {h.fixed_salary != null && <span className="font-bold">{fmtMoney(h.fixed_salary)}/мес</span>}
                    </div>
                    <p className="text-slate-400">{fmtDate(h.effective_from)} — {h.effective_to ? fmtDate(h.effective_to) : 'сейчас'}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── Commission rules section ─────────────────────────────────────── */}
      {showCommissions && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Правила начисления
            </p>
            {!readOnly && active.length > 0 && (
              <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setShowAdd(true)}>
                Добавить
              </Button>
            )}
          </div>

          {active.length === 0 ? (
            <EmptyRulesState scope={scope} readOnly={readOnly} onAdd={() => setShowAdd(true)} />
          ) : (
            <div className="space-y-2">
              {active.map((cfg, i) => (
                <div key={cfg.id ?? i} className="card p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={COMMISSION_TYPE_BADGE[cfg.commission_type] ?? 'slate'} size="sm">
                        {COMMISSION_TYPE_LABEL[cfg.commission_type] ?? cfg.commission_type}
                      </Badge>
                      <Badge variant={SCOPE_BADGE[cfg.scope] ?? 'slate'} size="sm">
                        {SCOPE_LABEL[cfg.scope] ?? cfg.scope}
                      </Badge>
                    </div>
                    <p className="text-base font-bold text-indigo-700 flex-shrink-0">{fmtPct(cfg.rate)}</p>
                  </div>
                  <p className="text-xs text-slate-400">С {fmtDate(cfg.effective_from)}</p>
                  {cfg.notes && (
                    <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-2 py-1">{cfg.notes}</p>
                  )}
                  {!readOnly && (
                    <Button variant="secondary" size="sm" onClick={() => setDisableItem(cfg)}>
                      Отключить
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <details className="group mt-2">
              <summary className="text-xs font-semibold text-slate-400 cursor-pointer hover:text-slate-600 select-none">
                История правил ({history.length})
              </summary>
              <div className="space-y-2 mt-2">
                {history.map((cfg, i) => (
                  <div key={cfg.id ?? i} className="card p-3 opacity-60 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <Badge variant={COMMISSION_TYPE_BADGE[cfg.commission_type] ?? 'slate'} size="sm">
                        {COMMISSION_TYPE_LABEL[cfg.commission_type] ?? cfg.commission_type}
                      </Badge>
                      <span className="text-sm font-bold text-slate-600">{fmtPct(cfg.rate)}</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {fmtDate(cfg.effective_from)} — {cfg.effective_to ? fmtDate(cfg.effective_to) : 'сейчас'}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <AddConfigModal open={showAdd} onClose={() => setShowAdd(false)} scope={scope} scopeId={scopeId} />
      <DisableModal open={!!disableItem} onClose={() => setDisableItem(null)} config={disableItem} scope={scope} scopeId={scopeId} />
      <SetSalaryModal open={showSalary} onClose={() => setShowSalary(false)} scopeId={scopeId} current={salaryData} />
    </div>
  )
}
