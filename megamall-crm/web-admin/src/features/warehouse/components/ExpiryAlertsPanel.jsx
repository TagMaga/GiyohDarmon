import { AlertTriangle, Clock, Package } from 'lucide-react'
import Badge from '../../../shared/components/Badge'
import useExpiryAlerts from '../hooks/useExpiryAlerts'
import { EXPIRY_STATUS_BADGE, EXPIRY_STATUS_LABEL, fmtExpiryDate } from '../utils/warehouseHelpers'

// ExpiryAlertsCards renders the two red summary tiles ("Скоро истекает" /
// "Просрочено") for a dashboard header row.
export function ExpiryAlertsCards({ meta, loading, onClick }) {
  const items = [
    { label: 'Скоро истекает', batches: meta.expiring_count, units: meta.expiring_units },
    { label: 'Просрочено', batches: meta.expired_count, units: meta.expired_units },
  ]
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => {
        const hasIssue = item.batches > 0
        return (
          <button
            key={item.label}
            type="button"
            onClick={onClick}
            disabled={!hasIssue}
            className={[
              'rounded-xl border p-3 text-left transition-colors',
              hasIssue
                ? 'border-rose-200 bg-rose-50 hover:bg-rose-100'
                : 'border-slate-200 bg-white',
            ].join(' ')}
          >
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={13} className={hasIssue ? 'text-rose-600' : 'text-slate-300'} />
              <p className={`text-[11px] font-bold uppercase tracking-wide ${hasIssue ? 'text-rose-700' : 'text-slate-400'}`}>{item.label}</p>
            </div>
            <p className={`mt-1.5 text-lg font-bold tabular-nums ${hasIssue ? 'text-rose-800' : 'text-slate-950'}`}>
              {loading ? '—' : `${item.batches} парт. / ${item.units} шт.`}
            </p>
          </button>
        )
      })}
    </div>
  )
}

// ExpiryAlertsList renders the problem-batch list itself, reused by both the
// dashboard "Требует внимания" panel and the notification bell dropdown.
export function ExpiryAlertsList({ alerts, loading, error, onOpenProduct, compact = false }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />)}
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-700">
        <AlertTriangle size={14} /> Не удалось загрузить предупреждения о сроках годности.
      </div>
    )
  }
  if (!alerts.length) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-200 px-4 py-5 text-left">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
          <Package size={18} />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-800">Просроченных партий нет</p>
          <p className="mt-0.5 text-xs text-slate-400">Предупреждения появятся здесь за 14 дней до истечения срока.</p>
        </div>
      </div>
    )
  }
  return (
    <div className={compact ? 'divide-y divide-slate-100' : 'overflow-hidden rounded-lg border border-slate-200'}>
      {alerts.map((a) => (
        <button
          key={a.batch_id}
          type="button"
          onClick={() => onOpenProduct?.(a)}
          className={[
            'grid w-full gap-2 px-3 py-2.5 text-left transition-colors hover:bg-rose-50/60',
            compact ? '' : 'border-b border-slate-100 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center',
          ].join(' ')}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-950">{a.product_name}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-slate-400">{a.sku}{a.invoice_no ? ` · накл. ${a.invoice_no}` : ''}</p>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-slate-500 sm:mt-0 sm:justify-end">
            <span className="flex items-center gap-1"><Clock size={11} /> {fmtExpiryDate(a.expiry_date)}</span>
            <span>Ост. <b className="text-slate-800">{a.remaining_quantity}</b></span>
          </div>
          <div className="mt-1 sm:mt-0 sm:text-right">
            <Badge variant={EXPIRY_STATUS_BADGE[a.status] ?? 'rose'} dot>{EXPIRY_STATUS_LABEL[a.status] ?? a.status}</Badge>
          </div>
        </button>
      ))}
    </div>
  )
}

// ExpiryAlertsPanel is the full dashboard section ("Требует внимания —
// сроки годности"): cards + list, wired to useExpiryAlerts itself.
export default function ExpiryAlertsPanel({ onOpenProduct }) {
  const { alerts, meta, isLoading, isError, error } = useExpiryAlerts()

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-slate-950">Сроки годности</h2>
        <p className="mt-1 text-xs text-slate-400">Партии, которые скоро истекают или уже просрочены.</p>
      </div>
      <ExpiryAlertsCards meta={meta} loading={isLoading} />
      <div className="mt-3">
        <ExpiryAlertsList alerts={alerts} loading={isLoading} error={isError ? error : null} onOpenProduct={onOpenProduct} />
      </div>
    </section>
  )
}
