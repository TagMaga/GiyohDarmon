import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Phone, Plus, Trash2 } from 'lucide-react'
import Sheet, { SheetTitle } from './Sheet'
import { C, avatarStyle, initialsOf, chipStyle } from './theme'
import { fmt } from '../statusConfig'
import { KEYS } from '../../../shared/queryKeys'
import { useToast } from '../../../shared/components/ToastProvider'
import {
  fetchCashSettlement, fetchCourierTariffs, createCourierTariff, deleteCourierTariff,
  updateCourierOrderIntake, setCourierAccountActive,
} from '../api'

const DELIVERY_TYPES = [['normal', 'Обычная'], ['fast', 'Срочная']]

export function CourierDetailSheet({ courierId, couriers, open, onClose }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [tariffTab, setTariffTab] = useState('normal')
  const [tariffFormOpen, setTariffFormOpen] = useState(false)
  const [form, setForm] = useState({ amount_from: '', amount_to: '', tariff_type: 'fixed', tariff_value: '' })

  const courier = couriers.find((c) => (c.courier_id ?? c.id) === courierId)

  useEffect(() => { if (open) { setTariffFormOpen(false); setForm({ amount_from: '', amount_to: '', tariff_type: 'fixed', tariff_value: '' }) } }, [open, courierId])

  const { data: settlementRows = [] } = useQuery({
    queryKey: KEYS.dispatcher.cashSettlement({ courier_id: courierId }),
    queryFn: () => fetchCashSettlement({ courier_id: courierId }),
    enabled: !!courierId && open,
    staleTime: 30_000,
  })
  const settlement = Array.isArray(settlementRows) ? settlementRows.find((r) => r.courier_id === courierId) : null

  const { data: tariffs = [], refetch: refetchTariffs } = useQuery({
    queryKey: ['dispatcher', 'courierTariffs', courierId],
    queryFn: () => fetchCourierTariffs(courierId),
    enabled: !!courierId && open,
    staleTime: 30_000,
  })

  const { mutate: toggleIntake } = useMutation({
    mutationFn: () => updateCourierOrderIntake(courierId, { enabled: courier?.order_intake_enabled === false }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers }); toast.success('Обновлено') },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })
  const { mutate: toggleActive } = useMutation({
    mutationFn: () => setCourierAccountActive(courierId, courier?.is_active === false),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers }); toast.success('Обновлено') },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })
  const { mutate: addTariff, isPending: addingTariff } = useMutation({
    mutationFn: () => createCourierTariff(courierId, {
      delivery_type: tariffTab,
      amount_from: parseFloat(form.amount_from) || 0,
      amount_to: form.amount_to.trim() !== '' ? parseFloat(form.amount_to) : null,
      tariff_type: form.tariff_type,
      tariff_value: parseFloat(form.tariff_value) || 0,
    }),
    onSuccess: () => { refetchTariffs(); setForm({ amount_from: '', amount_to: '', tariff_type: 'fixed', tariff_value: '' }) },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })
  const { mutate: removeTariff } = useMutation({
    mutationFn: (ruleId) => deleteCourierTariff(courierId, ruleId),
    onSuccess: () => refetchTariffs(),
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  if (!open || !courier) return null

  const name = courier.full_name ?? 'Курьер'
  const phone = courier.phone ?? ''
  const online = courier.is_online || courier.online
  const intakeEnabled = courier.order_intake_enabled !== false
  const accountActive = courier.is_active !== false
  const visibleTariffs = tariffs.filter((t) => t.delivery_type === tariffTab)

  return (
    <Sheet open={open} onClose={onClose} maxHeight="86%" zIndex={42}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 52, height: 52, borderRadius: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, fontWeight: 800, flexShrink: 0, ...avatarStyle(name) }}>{initialsOf(name)}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>{name}</div>
          <div style={{ fontSize: 12, color: C.text4 }}>{(courier.city_names ?? []).join(', ') || '—'} · {phone}</div>
        </div>
        <span style={{ padding: '4px 11px', borderRadius: 99, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', background: online ? C.greenBg : C.border2, color: online ? C.green : C.text3 }}>{online ? 'онлайн' : 'офлайн'}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginBottom: 16 }}>
        <StatBox label="Активных заказов" value={Number(courier.active_orders ?? 0)} />
        <StatBox label="Доставлено всего" value={fmt(settlement?.delivered ?? 0)} color={C.green} />
        <StatBox label="Успех доставки" value={settlement?.success_rate != null ? `${Math.round(settlement.success_rate)}%` : '—'} />
        <StatBox label="К сдаче" value={`${fmt(courier.cash_owed ?? 0)} c`} color={C.red} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px 10px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: C.text3 }}>Тарифы доставки</div>
        <button onClick={() => setTariffFormOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 9, border: `1px solid ${C.border}`, background: '#fff', color: C.violetDk, fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={12} />{tariffFormOpen ? 'Скрыть' : 'Изменить'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {DELIVERY_TYPES.map(([v, l]) => (
          <button key={v} onClick={() => setTariffTab(v)} style={{ padding: '6px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, ...chipStyle(tariffTab === v) }}>{l}</button>
        ))}
      </div>

      {tariffFormOpen && (
        <div style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 13, padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input placeholder="Сумма от" type="number" value={form.amount_from} onChange={(e) => setForm((p) => ({ ...p, amount_from: e.target.value }))} style={miniInput} />
            <input placeholder="Сумма до (∞)" type="number" value={form.amount_to} onChange={(e) => setForm((p) => ({ ...p, amount_to: e.target.value }))} style={miniInput} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <select value={form.tariff_type} onChange={(e) => setForm((p) => ({ ...p, tariff_type: e.target.value }))} style={miniInput}>
              <option value="fixed">Фикс. (c)</option>
              <option value="percent">Процент (%)</option>
            </select>
            <input placeholder="Значение" type="number" value={form.tariff_value} onChange={(e) => setForm((p) => ({ ...p, tariff_value: e.target.value }))} style={miniInput} />
          </div>
          <button onClick={() => addTariff()} disabled={addingTariff} style={{ width: '100%', padding: 9, border: 'none', borderRadius: 10, background: C.violet, color: '#fff', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: addingTariff ? 0.6 : 1 }}>
            {addingTariff ? '...' : 'Добавить тариф'}
          </button>
        </div>
      )}

      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, padding: '6px 14px', marginBottom: 16 }}>
        {visibleTariffs.length === 0 ? (
          <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 11.5, color: C.text3 }}>Тарифов нет</div>
        ) : visibleTariffs.map((tf, i) => (
          <div key={tf.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: i < visibleTariffs.length - 1 ? `1px solid ${C.border2}` : 'none' }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{tf.amount_from}–{tf.amount_to != null ? tf.amount_to : '∞'} c</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{tf.tariff_type === 'percent' ? `${tf.tariff_value}%` : `${tf.tariff_value} c`}</div>
              <button onClick={() => removeTariff(tf.id)} style={{ border: 'none', background: 'transparent', color: C.red, cursor: 'pointer', display: 'flex' }}><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: C.text3, padding: '0 2px 10px' }}>Настройки</div>
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
        <ToggleRow label="Приём заказов" sub="Может получать новые назначения" checked={intakeEnabled} onToggle={() => toggleIntake()} border />
        <ToggleRow label="Аккаунт активен" sub="Доступ к приложению" checked={accountActive} onToggle={() => toggleActive()} />
      </div>

      <div style={{ display: 'flex', gap: 9 }}>
        <a href={`tel:${phone}`} style={{ flex: 1, padding: 13, borderRadius: 13, background: C.greenBg, color: C.green, fontSize: 13.5, fontWeight: 700, textAlign: 'center' }}>Позвонить</a>
        <button onClick={onClose} style={{ flex: 1, padding: 13, borderRadius: 13, border: `1px solid ${C.border}`, background: '#fff', color: C.text2, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Закрыть</button>
      </div>
    </Sheet>
  )
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 13px' }}>
      <div style={{ fontSize: 10.5, color: C.text3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, marginTop: 2, color: color ?? C.text1 }}>{value}</div>
    </div>
  )
}

function ToggleRow({ label, sub, checked, onToggle, border }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 14px', borderBottom: border ? `1px solid ${C.border2}` : 'none' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 11, color: C.text3 }}>{sub}</div>
      </div>
      <button onClick={onToggle} style={{ border: 'none', cursor: 'pointer', width: 44, height: 26, borderRadius: 99, padding: 3, display: 'flex', background: checked ? '#10B981' : '#D6D3CB', justifyContent: checked ? 'flex-end' : 'flex-start' }}>
        <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
      </button>
    </div>
  )
}

const miniInput = {
  width: '100%', border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10,
  padding: '9px 10px', fontFamily: 'inherit', fontSize: 12.5, outline: 'none', boxSizing: 'border-box',
}

export function FleetSheet({ open, onClose, couriers, onSelect }) {
  if (!open) return null
  return (
    <Sheet open={open} onClose={onClose} zIndex={40}>
      <SheetTitle>Флот курьеров</SheetTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {couriers.map((c) => {
          const id = c.courier_id ?? c.id
          const name = c.full_name ?? 'Курьер'
          const active = Number(c.active_orders ?? 0)
          const loadPct = Math.min(100, Math.round((active / 6) * 100))
          const online = c.is_online || c.online
          return (
            <button key={id} onClick={() => onSelect(id)} style={{ textAlign: 'left', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, padding: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0, ...avatarStyle(name) }}>{initialsOf(name)}</div>
                <div style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{name}</div>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: online ? '#10B981' : '#D6D3CB' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.text4, marginBottom: 5 }}>
                <span>Нагрузка</span><span>{active}/6</span>
              </div>
              <div style={{ height: 5, background: C.border, borderRadius: 99, overflow: 'hidden', marginBottom: 10 }}>
                <div style={{ height: '100%', borderRadius: 99, width: `${loadPct}%`, background: active >= 5 ? '#EF4444' : active >= 3 ? '#F59E0B' : '#10B981' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <a href={`tel:${c.phone}`} onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: C.green, padding: '5px 10px', borderRadius: 9, background: C.greenBg }}>
                  <Phone size={11} />Позвонить
                </a>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.green }}>{fmt(c.cash_owed ?? 0)} c</span>
              </div>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
