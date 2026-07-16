import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Phone } from 'lucide-react'
import { C, avatarStyle, initialsOf, chipStyle } from './theme'
import { fmt } from '../statusConfig'
import { updateCourierOrderIntake } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { useToast } from '../../../shared/components/ToastProvider'

const FILTERS = [
  { value: '', label: 'Все' },
  { value: 'online', label: 'Онлайн' },
  { value: 'offline', label: 'Оффлайн' },
]

export default function CouriersTab({ couriers, cashOwed, loading, onOpenCourierDetail, onCouriersChanged }) {
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    if (filter === 'online') return couriers.filter((c) => c.is_online || c.online)
    if (filter === 'offline') return couriers.filter((c) => !(c.is_online || c.online))
    return couriers
  }, [couriers, filter])

  const onlineCount = couriers.filter((c) => c.is_online || c.online).length
  const activeTotal = couriers.reduce((s, c) => s + Number(c.active_orders ?? 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, padding: '0 18px 12px' }}>
        <SummaryCard value={`${onlineCount}/${couriers.length}`} label="Онлайн" />
        <SummaryCard value={fmt(activeTotal)} label="Заказов в пути" />
        <SummaryCard value={fmt(cashOwed)} label="К сдаче, сом" color={C.green} />
      </div>

      <div className="dm-scroll" style={{ display: 'flex', gap: 7, padding: '0 18px 14px', overflowX: 'auto' }}>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            style={{ flexShrink: 0, padding: '7px 13px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', ...chipStyle(filter === f.value) }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 18px' }}>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} style={{ height: 150, borderRadius: 16, background: C.border2 }} />)
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: C.text3, fontSize: 13 }}>Нет курьеров</div>
        ) : (
          filtered.map((c) => (
            <CourierCard key={c.courier_id ?? c.id} courier={c} onOpenDetail={onOpenCourierDetail} onChanged={onCouriersChanged} />
          ))
        )}
      </div>
    </div>
  )
}

function SummaryCard({ value, label, color }) {
  return (
    <div style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '11px 13px' }}>
      <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1, color: color ?? C.text1 }}>{value}</div>
      <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: C.text3, marginTop: 4 }}>{label}</div>
    </div>
  )
}

function CourierCard({ courier, onOpenDetail, onChanged }) {
  const toast = useToast()
  const qc = useQueryClient()
  const id = courier.courier_id ?? courier.id
  const name = courier.full_name ?? courier.courier?.full_name ?? 'Курьер'
  const phone = courier.phone ?? courier.courier?.phone ?? ''
  const zone = Array.isArray(courier.city_names) && courier.city_names.length ? courier.city_names.join(', ') : '—'
  const active = Number(courier.active_orders ?? 0)
  const delivered = Number(courier.delivered ?? 0)
  const cash = Number(courier.cash_owed ?? 0)
  const online = courier.is_online || courier.online
  const intakeEnabled = courier.order_intake_enabled !== false
  const loadPct = Math.min(100, Math.round((active / 6) * 100))
  const loadColor = active >= 5 ? '#EF4444' : active >= 3 ? '#F59E0B' : '#10B981'

  const { mutate: toggleIntake, isPending } = useMutation({
    mutationFn: () => updateCourierOrderIntake(id, { enabled: !intakeEnabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers })
      onChanged?.()
      toast.success(intakeEnabled ? 'Приём заказов выключен' : 'Приём заказов включён')
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 14 }}>
      <div onClick={() => onOpenDetail(id)} style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12, cursor: 'pointer' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, ...avatarStyle(name) }}>{initialsOf(name)}</div>
          <span style={{ position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: '50%', border: '2px solid #fff', background: online ? '#10B981' : '#D6D3CB' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{name}</div>
          <div style={{ fontSize: 11.5, color: C.text3 }}>{zone} · {phone}</div>
        </div>
        <ChevronRight size={16} color="#C4C4BA" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.text4, marginBottom: 5 }}>
        <span>Нагрузка · {active}/6</span>
        <span>{online ? 'Онлайн' : 'Оффлайн'}</span>
      </div>
      <div style={{ height: 6, background: C.border2, borderRadius: 99, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ height: '100%', borderRadius: 99, width: `${loadPct}%`, background: loadColor }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <Stat label="Активных" value={active} />
        <Stat label="Доставил" value={delivered} color={C.green} />
        <Stat label="К сдаче" value={fmt(cash)} color={cash > 0 ? C.red : C.text1} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => toggleIntake()}
          disabled={isPending}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8, borderRadius: 10,
            border: 'none', cursor: isPending ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700,
            background: intakeEnabled ? C.greenBg : C.border2, color: intakeEnabled ? C.green : C.text3, opacity: isPending ? 0.6 : 1,
          }}
        >
          <span style={{ width: 22, height: 13, borderRadius: 99, padding: 2, display: 'flex', background: intakeEnabled ? '#10B981' : '#D6D3CB', justifyContent: intakeEnabled ? 'flex-end' : 'flex-start' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#fff' }} />
          </span>
          Приём
        </button>
        <a href={`tel:${phone}`} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: C.green, padding: '8px 13px', borderRadius: 10, background: C.greenBg }}>
          <Phone size={12} />Звонок
        </a>
      </div>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: C.cardAlt, borderRadius: 11, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: C.text3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: color ?? C.text1 }}>{value}</div>
    </div>
  )
}
