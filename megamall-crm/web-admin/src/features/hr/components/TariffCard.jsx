import { useState }                    from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Badge   from '../../../shared/components/Badge'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import Modal   from '../../../shared/components/Modal'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { useToast } from '../../../shared/components/ToastProvider'
import { createTariff, deactivateTariff } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { fmtMoney, fmtDate, TARIFF_TYPE_LABEL, TARIFF_TYPE_BADGE } from '../utils/hrHelpers'
import { Truck, Plus, XCircle } from 'lucide-react'

// ── Deactivate modal ──────────────────────────────────────────────────────────

function DeactivateModal({ open, onClose, tariff }) {
  const qc    = useQueryClient()
  const toast = useToast()
  const [effectiveTo, setEffectiveTo] = useState('')
  const [notes,       setNotes]       = useState('')

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!effectiveTo) throw new Error('Укажите дату деактивации')
      if (!notes.trim()) throw new Error('Причина обязательна')
      return deactivateTariff(tariff.id, {
        effective_to: new Date(effectiveTo).toISOString(),
        notes: notes.trim(),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.hr.tariffActive })
      qc.invalidateQueries({ queryKey: KEYS.hr.tariffs })
      toast.success('Тариф деактивирован')
      reset(); setEffectiveTo(''); setNotes(''); onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Деактивировать тариф"
      description={tariff ? `«${tariff.name}»` : ''}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={isPending}>Отмена</Button>
        <Button variant="danger" onClick={() => mutate()} loading={isPending}>Деактивировать</Button>
      </>}
    >
      {error && <Alert variant="error" className="mb-4">{error.message}</Alert>}
      <div className="space-y-4">
        <Alert variant="warning">Тариф будет деактивирован с указанной даты.</Alert>
        <div>
          <label className="input-label">Дата деактивации *</label>
          <input type="datetime-local" value={effectiveTo} onChange={e => setEffectiveTo(e.target.value)} className="input mt-1" />
        </div>
        <div>
          <label className="input-label">Причина *</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input resize-none mt-1" rows={2} placeholder="Причина деактивации…" />
        </div>
      </div>
    </Modal>
  )
}

// ── Create tariff modal ───────────────────────────────────────────────────────

function CreateTariffModal({ open, onClose }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [name,          setName]          = useState('')
  const [type,          setType]          = useState('fixed')
  const [fixedFee,      setFixedFee]      = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [notes,         setNotes]         = useState('')
  // Tiered: one range row [{min,max,fee}]
  const [ranges, setRanges] = useState([{ min_amount: '0', max_amount: '', fee: '' }])

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!name.trim())    throw new Error('Название обязательно')
      if (!effectiveFrom)  throw new Error('Дата начала обязательна')
      if (!notes.trim())   throw new Error('Причина обязательна')
      const payload = {
        name: name.trim(),
        type,
        effective_from: new Date(effectiveFrom).toISOString(),
        notes: notes.trim(),
      }
      if (type === 'fixed') {
        const fee = parseFloat(fixedFee)
        if (isNaN(fee) || fee <= 0) throw new Error('Введите фиксированный тариф > 0')
        payload.fixed_fee = fee
      } else {
        const parsedRanges = ranges.map((r, i) => {
          const fee = parseFloat(r.fee)
          if (isNaN(fee) || fee <= 0) throw new Error(`Диапазон ${i+1}: тариф должен быть > 0`)
          return {
            min_amount: parseFloat(r.min_amount) || 0,
            max_amount: r.max_amount ? parseFloat(r.max_amount) : null,
            fee,
          }
        })
        payload.ranges = parsedRanges
      }
      return createTariff(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.hr.tariffActive })
      qc.invalidateQueries({ queryKey: KEYS.hr.tariffs })
      toast.success('Тариф создан')
      reset(); setName(''); setType('fixed'); setFixedFee(''); setEffectiveFrom(''); setNotes('')
      setRanges([{ min_amount: '0', max_amount: '', fee: '' }])
      onClose()
    },
  })

  const updateRange = (i, field, val) => setRanges(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))

  return (
    <Modal open={open} onClose={onClose} title="Создать тариф доставки" size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={isPending}>Отмена</Button>
        <Button variant="primary" onClick={() => mutate()} loading={isPending}>Создать</Button>
      </>}
    >
      {error && <Alert variant="error" className="mb-4">{error.response?.data?.error?.message ?? error.message}</Alert>}
      <div className="space-y-4">
        <div><label className="input-label">Название *</label>
          <input value={name} onChange={e => setName(e.target.value)} className="input mt-1" placeholder="Тариф 2025" />
        </div>
        <div><label className="input-label">Тип</label>
          <select value={type} onChange={e => setType(e.target.value)} className="input mt-1">
            <option value="fixed">Фиксированный</option>
            <option value="tiered">Ступенчатый</option>
          </select>
        </div>
        {type === 'fixed' && (
          <div><label className="input-label">Стоимость доставки (с) *</label>
            <input type="number" min="0.01" step="0.01" value={fixedFee} onChange={e => setFixedFee(e.target.value)} className="input mt-1" placeholder="15.00" />
          </div>
        )}
        {type === 'tiered' && (
          <div className="space-y-2">
            <label className="input-label">Диапазоны</label>
            {ranges.map((r, i) => (
              <div key={i} className="flex gap-2 items-center flex-wrap">
                <input type="number" placeholder="От" value={r.min_amount} onChange={e => updateRange(i, 'min_amount', e.target.value)} className="input w-24" />
                <input type="number" placeholder="До (пусто=∞)" value={r.max_amount} onChange={e => updateRange(i, 'max_amount', e.target.value)} className="input w-28" />
                <input type="number" placeholder="Тариф" value={r.fee} onChange={e => updateRange(i, 'fee', e.target.value)} className="input w-24" />
                {ranges.length > 1 && <button type="button" onClick={() => setRanges(p => p.filter((_, idx) => idx !== i))} className="text-rose-500 hover:text-rose-700 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"><XCircle size={16} /></button>}
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setRanges(p => [...p, { min_amount: '', max_amount: '', fee: '' }])}>+ Диапазон</Button>
          </div>
        )}
        <div><label className="input-label">Действует с *</label>
          <input type="datetime-local" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} className="input mt-1" />
        </div>
        <div><label className="input-label">Причина / Примечание *</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input resize-none mt-1" rows={2} placeholder="Изменение ценовой политики…" />
        </div>
      </div>
    </Modal>
  )
}

// ── Main TariffCard ───────────────────────────────────────────────────────────

export default function TariffCard({ activeTariff, tariffs, loading }) {
  const [showCreate,     setShowCreate]     = useState(false)
  const [deactivateItem, setDeactivateItem] = useState(null)

  if (loading) return <div className="space-y-3">{[1,2].map(i => <CardSkeleton key={i} />)}</div>

  return (
    <div className="space-y-5">
      {/* Active tariff hero card */}
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-sky-100 rounded-xl flex items-center justify-center">
              <Truck size={18} className="text-sky-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Активный тариф</p>
              <p className="text-xs text-slate-400">{activeTariff ? activeTariff.name : 'Не задан'}</p>
            </div>
          </div>
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
            Новый
          </Button>
        </div>

        {activeTariff ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Тип</p>
                <Badge variant={TARIFF_TYPE_BADGE[activeTariff.type] ?? 'slate'}>
                  {TARIFF_TYPE_LABEL[activeTariff.type] ?? activeTariff.type}
                </Badge>
              </div>
              {activeTariff.fixed_fee != null && (
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">Стоимость</p>
                  <p className="text-sm font-bold text-slate-900">{fmtMoney(activeTariff.fixed_fee)}</p>
                </div>
              )}
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">С</p>
                <p className="text-sm text-slate-700">{fmtDate(activeTariff.effective_from)}</p>
              </div>
            </div>

            {activeTariff.ranges?.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-slate-400 border-b border-slate-100">
                    <th className="text-left py-1">От</th><th className="text-left py-1">До</th><th className="text-right py-1">Тариф</th>
                  </tr></thead>
                  <tbody>{activeTariff.ranges.map(r => (
                    <tr key={r.id} className="border-b border-slate-50">
                      <td className="py-1">{fmtMoney(r.min_amount)}</td>
                      <td className="py-1">{r.max_amount != null ? fmtMoney(r.max_amount) : '∞'}</td>
                      <td className="py-1 text-right font-semibold">{fmtMoney(r.fee)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            {activeTariff.notes && (
              <p className="text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2">{activeTariff.notes}</p>
            )}

            <Button variant="danger" size="sm" onClick={() => setDeactivateItem(activeTariff)}>
              Деактивировать
            </Button>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Активный тариф не настроен. Создайте первый тариф.</p>
        )}
      </div>

      {/* History list */}
      {tariffs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Все тарифы</p>
          <div className="space-y-2">
            {tariffs.map((t, i) => (
              <div key={t.id ?? i} className="card p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{t.name}</p>
                  <p className="text-xs text-slate-400">{fmtDate(t.effective_from)} — {t.effective_to ? fmtDate(t.effective_to) : 'сейчас'}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant={t.is_active ? 'emerald' : 'slate'} size="sm">{t.is_active ? 'Активен' : 'Архив'}</Badge>
                  {t.fixed_fee != null && <span className="text-xs font-semibold text-slate-700">{fmtMoney(t.fixed_fee)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <CreateTariffModal open={showCreate}       onClose={() => setShowCreate(false)} />
      <DeactivateModal   open={!!deactivateItem} onClose={() => setDeactivateItem(null)} tariff={deactivateItem} />
    </div>
  )
}
