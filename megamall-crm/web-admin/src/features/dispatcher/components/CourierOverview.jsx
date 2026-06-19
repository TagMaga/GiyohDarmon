import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Truck, Phone, Package, CheckCircle2, AlertCircle, ToggleLeft, ToggleRight, UserCheck, UserX } from 'lucide-react'
import { KEYS } from '../../../shared/queryKeys'
import { fetchCouriersOverview, updateCourierOrderIntake } from '../api'
import { useToast } from '../../../shared/components/ToastProvider'
import Badge      from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import Alert      from '../../../shared/components/Alert'
import { CardSkeleton } from '../../../shared/components/Skeleton'

/**
 * CourierOverview — displays courier workload tiles.
 */
export default function CourierOverview() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: KEYS.dispatcher.couriers,
    queryFn:  fetchCouriersOverview,
    staleTime: 30_000,
  })

  if (isPending) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
    )
  }

  if (isError) {
    return (
      <Alert variant="error" title="Не удалось загрузить курьеров">
        {error?.response?.data?.error?.message ?? error?.message}
      </Alert>
    )
  }

  const couriers = Array.isArray(data)
    ? data
    : (data?.couriers ?? data?.data ?? [])

  if (couriers.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<Truck size={24} />}
          title="Нет курьеров"
          description="Курьеры появятся здесь после назначения на заказы."
        />
      </div>
    )
  }

  const notAccepting = couriers.filter((c) => c.order_intake_enabled === false).length
  const working = Math.max(0, couriers.length - notAccepting)
  const busy = couriers.filter((c) => Number(c.active_orders ?? 0) > 0).length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CourierMetric icon={<Truck size={16} />} label="Курьеров всего" value={couriers.length} />
        <CourierMetric icon={<UserCheck size={16} />} label="Принимают" value={working} tone="emerald" />
        <CourierMetric icon={<Package size={16} />} label="На заказах" value={busy} tone="amber" />
        <CourierMetric icon={<UserX size={16} />} label="Не принимают" value={notAccepting} tone={notAccepting > 0 ? 'rose' : 'slate'} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {couriers.map((c) => <CourierCard key={c.courier_id ?? c.id} courier={c} />)}
      </div>
    </div>
  )
}

function CourierMetric({ icon, label, value, tone = 'slate' }) {
  const tones = {
    emerald: 'border-emerald-100 bg-emerald-50/60 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50/60 text-amber-700',
    rose: 'border-rose-100 bg-rose-50/60 text-rose-700',
    slate: 'border-slate-100 bg-white text-slate-700',
  }

  return (
    <div className={`card p-3 border ${tones[tone] ?? tones.slate}`}>
      <div className="flex items-center gap-2 text-xs font-semibold">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  )
}

function stat(label, value, icon) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-slate-400">{icon}</div>
      <div>
        <p className="text-[10px] text-slate-400 leading-none">{label}</p>
        <p className="text-sm font-semibold text-slate-800 mt-0.5">{value ?? '0'}</p>
      </div>
    </div>
  )
}

function CourierCard({ courier }) {
  const qc = useQueryClient()
  const toast = useToast()
  const name     = courier.full_name ?? courier.courier?.full_name ?? 'Курьер'
  const phone    = courier.phone     ?? courier.courier?.phone     ?? ''
  const active   = courier.active_orders ?? 0
  const cashOwed = courier.cash_owed ?? 0
  const intakeEnabled = courier.order_intake_enabled !== false
  const courierId = courier.courier_id ?? courier.id

  const intakeMutation = useMutation({
    mutationFn: ({ enabled, reason }) => updateCourierOrderIntake(courierId, { enabled, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers })
      toast.success('Приём заказов обновлён')
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Не удалось обновить приём заказов')
    },
  })

  const employeeActive = courier.is_active !== false
  const employeeStatusVariant = employeeActive ? 'emerald' : 'rose'
  const employeeStatusLabel = employeeActive ? 'Активен' : 'Заблокирован'
  const workloadLabel = active > 0 ? 'На заказах' : 'Свободен'

  function toggleIntake() {
    const next = !intakeEnabled
    if (!next && active > 0) {
      const ok = window.confirm(`У курьера есть ${active} активных заказов. Он сможет завершить их, но не сможет брать новые. Продолжить?`)
      if (!ok) return
    }
    const reason = next ? '' : (window.prompt('Причина отключения приёма заказов (необязательно)', courier.order_intake_reason ?? '') ?? '')
    intakeMutation.mutate({ enabled: next, reason })
  }

  return (
    <div className={`card p-4 space-y-3 ${intakeEnabled ? '' : 'border-rose-100 bg-rose-50/30'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800 leading-tight">{name}</p>
          {phone && (
            <div className="flex items-center gap-1 mt-0.5">
              <Phone size={11} className="text-slate-400" />
              <span className="text-xs text-slate-500">{phone}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Badge variant={employeeStatusVariant} dot>{employeeStatusLabel}</Badge>
          <Badge variant={active > 0 ? 'amber' : 'slate'}>{workloadLabel}</Badge>
          <Badge variant={intakeEnabled ? 'emerald' : 'rose'} dot>
            {intakeEnabled ? 'Включён' : 'Выключен'}
          </Badge>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        {stat('Активных', active, <Package size={13} />)}
        {stat('Назначено', courier.assigned_orders ?? 0, <CheckCircle2 size={13} />)}
        {stat('В доставке', courier.in_delivery ?? 0, <Truck size={13} />)}
        {stat('К сдаче (сом)', cashOwed > 0
          ? Number(cashOwed).toLocaleString('ru-RU')
          : '—',
          <AlertCircle size={13} />)}
      </div>

      <div className="pt-2 border-t border-slate-100 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <StatusLine label="Статус сотрудника" value={employeeStatusLabel} tone={employeeActive ? 'emerald' : 'rose'} />
          <StatusLine label="Приём заказов" value={intakeEnabled ? 'Включён' : 'Выключен'} tone={intakeEnabled ? 'emerald' : 'rose'} />
        </div>
        {!intakeEnabled && (
          <div className="rounded-xl border border-rose-100 bg-white/70 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-rose-400">Причина</p>
            <p className="text-xs font-medium text-slate-700 mt-0.5">
              {courier.order_intake_reason?.trim() || 'Не указана'}
            </p>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-400">Операционный доступ к новым заказам</div>
          <button
            type="button"
            onClick={toggleIntake}
            disabled={intakeMutation.isPending}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors min-h-[40px] ${
              intakeEnabled
                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            } disabled:opacity-60`}
          >
            {intakeEnabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
            {intakeMutation.isPending ? 'Сохраняем...' : intakeEnabled ? 'Выключить' : 'Включить'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusLine({ label, value, tone }) {
  const color = tone === 'rose' ? 'text-rose-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-slate-700'

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">{label}</p>
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
    </div>
  )
}
