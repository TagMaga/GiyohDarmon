import { Check, Truck, AlertTriangle, X, ChevronRight } from 'lucide-react'

const AVATAR_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6']
function avatarColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
function initials(name = '') {
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? (p[0][0] ?? '?').toUpperCase() : (p[0][0] + p[1][0]).toUpperCase()
}

/**
 * Sticky action bar at the bottom of the workspace.
 *
 * Quick-assign mode: shown when pendingCourierId is set + order is assign-able.
 * Normal mode: status-based contextual buttons.
 *
 * Inline actions (no dialog): confirm, quick_assign, quick_reassign
 * Modal actions (require input): assign, reassign, cancel, schedule, issue, resolve, comment
 */
export default function DispatcherStickyBar({
  order,
  pendingCourierId,
  pendingCourierName,
  onAction,        // opens a modal
  onInlineAction,  // fires mutation directly — (key, data?) => void
  isPending = false,
}) {
  if (!order) return null

  const status = order.status
  const isAssignable  = status === 'confirmed'
  const isReassignable = ['assigned', 'in_delivery', 'issue'].includes(status)
  const canQuickAssign = pendingCourierId && (isAssignable || isReassignable)

  /* ── Quick-assign strip ─────────────────────────────────────────────────── */
  if (canQuickAssign) {
    const actionLabel = isReassignable ? 'Переназначить' : 'Назначить'
    const color = avatarColor(pendingCourierName ?? '')
    return (
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 bg-indigo-600 border-t border-indigo-500 animate-fade-in">
        {/* Courier avatar */}
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 ring-2 ring-white/30"
          style={{ background: color }}
        >
          {initials(pendingCourierName ?? '?')}
        </div>

        {/* Label */}
        <div className="flex-1 min-w-0">
          <span className="text-xs font-bold text-white">{pendingCourierName ?? 'Курьер'}</span>
          <span className="text-white/60 text-xs ml-1.5">готов к назначению</span>
        </div>

        {/* Assign CTA */}
        <button
          onClick={() => onInlineAction(isReassignable ? 'quick_reassign' : 'quick_assign', { courierId: pendingCourierId })}
          disabled={isPending}
          className="flex items-center gap-1 px-3 py-1.5 bg-white text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-50 active:bg-indigo-100 transition-colors disabled:opacity-50 flex-shrink-0"
        >
          {isPending ? 'Назначаем…' : actionLabel}
          {!isPending && <ChevronRight size={12} />}
        </button>

        {/* Cancel pending */}
        <button
          onClick={() => onInlineAction('cancel_pending')}
          className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-indigo-500 transition-colors flex-shrink-0"
          title="Отмена"
        >
          <X size={13} />
        </button>
      </div>
    )
  }

  /* ── Normal action bar ──────────────────────────────────────────────────── */
  const actions = NORMAL_ACTIONS[status] ?? []
  if (actions.length === 0) return null

  return (
    <div className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 border-t border-slate-100 bg-white overflow-x-auto">
      {actions.map(act => (
        <ActionBtn
          key={act.key}
          act={act}
          isPending={isPending}
          onClick={() => {
            if (act.inline) {
              onInlineAction(act.key)
            } else {
              onAction(act.key, order)
            }
          }}
        />
      ))}
    </div>
  )
}

function ActionBtn({ act, isPending, onClick }) {
  const cls = {
    primary:   'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800',
    success:   'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
    danger:    'border border-rose-200 text-rose-600 bg-rose-50 hover:bg-rose-100',
    secondary: 'border border-slate-200 text-slate-600 bg-white hover:bg-slate-50',
  }[act.variant] ?? 'border border-slate-200 text-slate-600 bg-white hover:bg-slate-50'

  return (
    <button
      onClick={onClick}
      disabled={isPending}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex-shrink-0 disabled:opacity-50 ${cls}`}
    >
      {act.Icon && <act.Icon size={12} />}
      {act.label}
    </button>
  )
}

// Per-status action definitions for the normal bar.
// inline:true = fires onInlineAction (no dialog); otherwise opens modal via onAction.
const NORMAL_ACTIONS = {
  new: [
    { key: 'confirm',  label: 'Подтвердить',   variant: 'success',   inline: true, Icon: Check },
    { key: 'cancel',   label: 'Отменить',       variant: 'danger',    inline: false },
    { key: 'comments', label: 'Комментарий',    variant: 'secondary', inline: false },
  ],
  confirmed: [
    { key: 'assign',    label: 'Назначить',      variant: 'primary',   inline: false, Icon: Truck },
    { key: 'schedule',  label: 'Запланировать',  variant: 'secondary', inline: false },
    { key: 'cancel',    label: 'Отменить',       variant: 'danger',    inline: false },
  ],
  assigned: [
    { key: 'reassign',  label: 'Переназначить',  variant: 'primary',   inline: false, Icon: Truck },
    { key: 'issue',     label: 'Проблема',       variant: 'danger',    inline: false, Icon: AlertTriangle },
    { key: 'unassign',  label: 'Снять курьера',  variant: 'secondary', inline: false },
    { key: 'comments',   label: 'Комментарий',    variant: 'secondary', inline: false },
  ],
  in_delivery: [
    { key: 'issue',     label: 'Проблема',       variant: 'danger',    inline: false, Icon: AlertTriangle },
    { key: 'unassign',  label: 'Снять курьера',  variant: 'secondary', inline: false },
    { key: 'return',    label: 'Возврат',        variant: 'secondary', inline: false },
    { key: 'comments',   label: 'Комментарий',    variant: 'secondary', inline: false },
  ],
  issue: [
    { key: 'resolve',   label: 'Решить',         variant: 'success',   inline: false, Icon: Check },
    { key: 'cancel',    label: 'Отменить',       variant: 'danger',    inline: false },
    { key: 'unassign',  label: 'Снять курьера',  variant: 'secondary', inline: false },
    { key: 'comments',   label: 'Комментарий',    variant: 'secondary', inline: false },
  ],
  delivered: [
    { key: 'comments',   label: 'Комментарий',    variant: 'secondary', inline: false },
  ],
  returned: [
    { key: 'comments',   label: 'Комментарий',    variant: 'secondary', inline: false },
  ],
  cancelled: [
    { key: 'comments',   label: 'Комментарий',    variant: 'secondary', inline: false },
  ],
}
