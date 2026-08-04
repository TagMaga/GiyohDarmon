import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import Sheet, { SheetTitle, SheetPrimaryButton } from './Sheet'
import { C, avatarStyle, initialsOf, chipStyle, statusPill } from './theme'
import { fmt, STATUS_LABELS } from '../statusConfig'
import { KEYS } from '../../../shared/queryKeys'
import { useToast } from '../../../shared/components/ToastProvider'
import { getOrderId, formatOrderLabel } from '../utils/orderHelpers'
import { toLocalYMD, addDaysYMD, appWallClockToDate } from '../../../shared/utils/date'
import {
  fetchCouriersOverview, assignCourier, reassignCourier, unassignCourier, cancelOrder, scheduleOrder,
  forceOrderStatus,
} from '../api'

const invalidateBoard = (qc) => {
  qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
  qc.invalidateQueries({ queryKey: KEYS.dispatcher.newOrders })
  qc.invalidateQueries({ queryKey: KEYS.dispatcher.cancelled })
  qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers })
}

// ── Assign / reassign courier sheet ──────────────────────────────────────────
export function AssignSheet({ open, mode, order, onClose }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [pick, setPick] = useState('')

  useEffect(() => { if (open) setPick('') }, [open])

  const { data } = useQuery({
    queryKey: KEYS.dispatcher.couriers,
    queryFn: fetchCouriersOverview,
    enabled: open,
    staleTime: 20_000,
  })
  const couriers = Array.isArray(data) ? data : (data?.couriers ?? data?.data ?? [])

  const mutFn = mode === 'reassign' ? reassignCourier : assignCourier
  const { mutate, isPending } = useMutation({
    mutationFn: () => mutFn(getOrderId(order), { courier_id: pick }),
    onSuccess: () => {
      invalidateBoard(qc)
      toast.success(mode === 'reassign' ? 'Курьер переназначен' : 'Курьер назначен')
      onClose()
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  if (!open) return null

  return (
    <Sheet open={open} onClose={onClose} zIndex={46}>
      <SheetTitle sub={`Заказ #${order ? formatOrderLabel(order) : ''} · выберите курьера`}>
        {mode === 'reassign' ? 'Переназначить курьера' : 'Назначить курьера'}
      </SheetTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 16 }}>
        {couriers.length === 0 && <div style={{ fontSize: 12.5, color: C.text3 }}>Нет доступных курьеров</div>}
        {couriers.map((c) => {
          const id = c.courier_id ?? c.id
          const name = c.full_name ?? c.courier?.full_name ?? 'Курьер'
          const active = Number(c.active_orders ?? 0)
          const intakeEnabled = c.order_intake_enabled !== false
          const maxOrders = c.max_active_orders != null ? Number(c.max_active_orders) : null
          const atCapacity = maxOrders != null && active >= maxOrders
          const canPick = intakeEnabled && !atCapacity
          const selected = pick === id
          const loadPct = Math.min(100, Math.round((active / (maxOrders ?? 6)) * 100))
          return (
            <button
              key={id}
              onClick={() => canPick && setPick(id)}
              disabled={!canPick}
              style={{
                textAlign: 'left', background: '#fff', borderRadius: 14, padding: '12px 13px', cursor: canPick ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', border: `1px solid ${selected ? C.violet : C.border}`,
                boxShadow: selected ? '0 0 0 1px rgba(99,102,241,0.25)' : undefined, opacity: canPick ? 1 : 0.6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, flexShrink: 0, ...avatarStyle(name) }}>{initialsOf(name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800 }}>{name}</div>
                  <div style={{ fontSize: 11, color: C.text3 }}>
                    нагрузка {active}/{maxOrders ?? '∞'}
                    {!intakeEnabled ? ' · приём выключен' : atCapacity ? ' · лимит заказов исчерпан' : ''}
                  </div>
                </div>
                <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: selected ? C.violet : C.border2, color: selected ? '#fff' : C.text3 }}>
                  <Check size={13} />
                </span>
              </div>
              <div style={{ height: 5, background: C.border2, borderRadius: 99, overflow: 'hidden', marginTop: 10 }}>
                <div style={{ height: '100%', borderRadius: 99, width: `${loadPct}%`, background: atCapacity ? '#EF4444' : active >= Math.ceil((maxOrders ?? 6) * 0.6) ? '#F59E0B' : '#10B981' }} />
              </div>
            </button>
          )
        })}
      </div>
      <SheetPrimaryButton onClick={() => pick && mutate()} disabled={!pick || isPending} background={pick ? undefined : '#C9C7BF'}>
        {isPending ? '...' : pick ? (mode === 'reassign' ? 'Переназначить курьера' : 'Назначить курьера') : 'Выберите курьера'}
      </SheetPrimaryButton>
    </Sheet>
  )
}

// ── Unassign courier sheet ───────────────────────────────────────────────────
const UNASSIGN_REASONS = ['Курьер не может доставить', 'Поломка транспорта', 'Плохое самочувствие', 'Ошибка назначения']

export function UnassignSheet({ open, order, onClose }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (open) {
      setReason('')
      setComment('')
    }
  }, [open])

  const finalReason = comment.trim()
    ? (reason ? `${reason}: ${comment.trim()}` : comment.trim())
    : reason
  const { mutate, isPending } = useMutation({
    mutationFn: () => unassignCourier(getOrderId(order), { reason: finalReason }),
    onSuccess: () => {
      invalidateBoard(qc)
      toast.success('Курьер снят — заказ снова доступен')
      onClose()
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  if (!open) return null

  return (
    <Sheet open={open} onClose={onClose} maxHeight="80%" zIndex={46}>
      <SheetTitle sub={`Заказ #${order ? formatOrderLabel(order) : ''} вернётся в «Подтверждённые»`}>
        Снять курьера
      </SheetTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {UNASSIGN_REASONS.map((r) => (
          <button
            key={r}
            onClick={() => setReason(r)}
            style={{ padding: '9px 13px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, ...chipStyle(reason === r) }}
          >
            {r}
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={500}
        placeholder="Или укажите другую причину"
        rows={3}
        style={{ width: '100%', border: `1px solid ${C.border}`, background: '#fff', borderRadius: 13, padding: 12, fontFamily: 'inherit', fontSize: 13, outline: 'none', resize: 'none', marginBottom: 14 }}
      />
      <SheetPrimaryButton onClick={() => finalReason && mutate()} disabled={!finalReason || isPending}>
        {isPending ? '...' : 'Снять курьера'}
      </SheetPrimaryButton>
    </Sheet>
  )
}

// ── Cancel sheet ──────────────────────────────────────────────────────────────
const CANCEL_REASONS = ['Клиент отказался', 'Не дозвонились', 'Нет на складе', 'Дубликат', 'Ошибка заказа']

export function CancelSheet({ open, order, onClose }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')

  useEffect(() => { if (open) { setReason(''); setComment('') } }, [open])

  const { mutate, isPending } = useMutation({
    mutationFn: () => cancelOrder(getOrderId(order), { reason: comment.trim() || reason }),
    onSuccess: () => { invalidateBoard(qc); toast.success('Заказ отменён'); onClose() },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  if (!open) return null
  const canSubmit = reason || comment.trim()

  return (
    <Sheet open={open} onClose={onClose} maxHeight="80%" zIndex={46}>
      <SheetTitle sub="Укажите причину отмены">Отменить заказ #{order ? formatOrderLabel(order) : ''}</SheetTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {CANCEL_REASONS.map((r) => (
          <button key={r} onClick={() => setReason(r)} style={{ padding: '9px 13px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, ...chipStyle(reason === r, C.red) }}>{r}</button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Комментарий (необязательно)"
        rows={3}
        style={{ width: '100%', border: `1px solid ${C.border}`, background: '#fff', borderRadius: 13, padding: 12, fontFamily: 'inherit', fontSize: 13, outline: 'none', resize: 'none', marginBottom: 14 }}
      />
      <SheetPrimaryButton onClick={() => canSubmit && mutate()} disabled={!canSubmit || isPending} background={C.red}>
        {isPending ? '...' : 'Отменить заказ'}
      </SheetPrimaryButton>
    </Sheet>
  )
}

// ── Force status sheet ───────────────────────────────────────────────────────
// Mobile twin of the desktop ForceStatusModal: the recovery path for an order
// stuck in (or wrongly moved to) the wrong status. Every status is offered —
// all of them are restorable, and the backend re-validates and guards the
// financial and inventory side effects against double-firing. A reason is
// mandatory and lands on the order timeline + audit log.
const FORCE_STATUSES = ['new', 'confirmed', 'assigned', 'in_delivery', 'delivered', 'returned', 'cancelled']

// Statuses whose first entry moves stock and fires the financial events.
const SETTLING_STATUSES = new Set(['delivered', 'cancelled', 'returned'])

export function ForceStatusSheet({ open, order, onClose }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [status, setStatus] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => { if (open) { setStatus(''); setReason('') } }, [open])

  const { mutate, isPending } = useMutation({
    mutationFn: () => forceOrderStatus(getOrderId(order), { status, reason: reason.trim() }),
    onSuccess: () => {
      // Broad key — the history list this is usually opened from lives under
      // ['dispatcher', 'orderHistory', params] and must refresh too.
      qc.invalidateQueries({ queryKey: ['dispatcher'] })
      toast.success('Статус изменён вручную')
      onClose()
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  if (!open) return null

  const current = order?.status
  const canSubmit = !!status && status !== current && reason.trim().length >= 3
  const touchesSettlement = SETTLING_STATUSES.has(status) || SETTLING_STATUSES.has(current)

  return (
    <Sheet open={open} onClose={onClose} zIndex={41}>
      <SheetTitle sub={`Заказ #${order ? formatOrderLabel(order) : ''} · сейчас: ${STATUS_LABELS[current] ?? current ?? '—'}`}>
        Изменить статус вручную
      </SheetTitle>

      <div style={{ background: C.amberBg, color: C.amber, borderRadius: 13, padding: '11px 13px', fontSize: 12, fontWeight: 600, lineHeight: 1.45, marginBottom: 14 }}>
        Это принудительное изменение в обход обычных правил перехода.
        Используйте только для исправления зависших или ошибочных заказов —
        действие фиксируется в истории заказа с указанной причиной.
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: C.text3, padding: '0 4px 8px' }}>Новый статус</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {FORCE_STATUSES.map((s) => {
          const isCurrent = s === current
          const pill = statusPill(s)
          const active = status === s
          return (
            <button
              key={s}
              onClick={() => !isCurrent && setStatus(s)}
              disabled={isCurrent}
              style={{
                padding: '9px 13px', borderRadius: 11, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700,
                cursor: isCurrent ? 'not-allowed' : 'pointer', opacity: isCurrent ? 0.45 : 1,
                ...chipStyle(active, pill.color),
              }}
            >
              {STATUS_LABELS[s] ?? s}{isCurrent ? ' · текущий' : ''}
            </button>
          )
        })}
      </div>

      {touchesSettlement && (
        <div style={{ background: C.redBg, color: C.red, borderRadius: 13, padding: '11px 13px', fontSize: 12, fontWeight: 600, lineHeight: 1.45, marginBottom: 14 }}>
          Затрагивается статус доставлен / отменён / возврат: изменение
          влияет на складские остатки и финансовые начисления по заказу.
        </div>
      )}

      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        placeholder="Причина изменения статуса (обязательно)"
        rows={3}
        style={{ width: '100%', border: `1px solid ${C.border}`, background: '#fff', borderRadius: 13, padding: 12, fontFamily: 'inherit', fontSize: 13, outline: 'none', resize: 'none', marginBottom: 14 }}
      />

      <SheetPrimaryButton onClick={() => canSubmit && mutate()} disabled={!canSubmit || isPending} background={C.red}>
        {isPending ? '...' : 'Применить'}
      </SheetPrimaryButton>
    </Sheet>
  )
}

// ── Schedule sheet ────────────────────────────────────────────────────────────
const SCHED_DATES = [['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['day2', 'Послезавтра']]
const SCHED_TIMES = ['09:00–12:00', '12:00–15:00', '15:00–18:00', '18:00–21:00']

export function ScheduleSheet({ open, order, onClose }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [date, setDate] = useState('today')
  const [time, setTime] = useState('12:00–15:00')

  useEffect(() => { if (open) { setDate('today'); setTime('12:00–15:00') } }, [open])

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const dayOffset = date === 'today' ? 0 : date === 'tomorrow' ? 1 : 2
      const [hh, mm] = time.split('–')[0].split(':')
      // "Сегодня 09:00" means 09:00 in Dushanbe. Resolve the day and the
      // wall clock in that timezone — `new Date()` + setHours() would use the
      // browser's, so a browser on UTC scheduled the window 5h late.
      const ymd = addDaysYMD(toLocalYMD(new Date()), dayOffset)
      const at = appWallClockToDate(`${ymd}T${hh}:${mm}`)
      return scheduleOrder(getOrderId(order), { scheduled_at: at.toISOString(), comment: `Окно: ${time}` })
    },
    onSuccess: () => { invalidateBoard(qc); toast.success('Доставка запланирована'); onClose() },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
  })

  if (!open) return null

  return (
    <Sheet open={open} onClose={onClose} maxHeight="80%" zIndex={46}>
      <SheetTitle sub={`Заказ #${order ? formatOrderLabel(order) : ''}`}>Запланировать доставку</SheetTitle>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.text3, padding: '0 4px 8px' }}>Дата</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {SCHED_DATES.map(([v, l]) => (
          <button key={v} onClick={() => setDate(v)} style={{ padding: '10px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, ...chipStyle(date === v) }}>{l}</button>
        ))}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.text3, padding: '0 4px 8px' }}>Время</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {SCHED_TIMES.map((t) => (
          <button key={t} onClick={() => setTime(t)} style={{ padding: '10px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, ...chipStyle(time === t) }}>{t}</button>
        ))}
      </div>
      <SheetPrimaryButton onClick={() => mutate()} disabled={isPending}>
        {isPending ? '...' : 'Запланировать'}
      </SheetPrimaryButton>
    </Sheet>
  )
}
