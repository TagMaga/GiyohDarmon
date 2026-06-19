import { useState }        from 'react'
import { useMutation }     from '@tanstack/react-query'
import Badge   from '../../../shared/components/Badge'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import { fetchPreview }    from '../api'
import {
  fmtMoney, fmtPct,
  ORDER_TYPE_LABEL, ALL_ORDER_TYPES,
  COMMISSION_TYPE_LABEL, COMMISSION_TYPE_BADGE,
  SCOPE_LABEL, SCOPE_BADGE,
} from '../utils/hrHelpers'
import { Calculator } from 'lucide-react'

/**
 * PreviewCalculator — standalone panel (no modal wrapper).
 * Shown when tab === 'preview'.
 */
export default function PreviewCalculator() {
  const [orderTotal, setOrderTotal] = useState('')
  const [orderType,  setOrderType]  = useState('standard')
  const [result,     setResult]     = useState(null)

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => {
      const total = parseFloat(orderTotal)
      if (isNaN(total) || total <= 0) throw new Error('Введите сумму заказа > 0')
      return fetchPreview({ order_total: total, order_type: orderType })
    },
    onSuccess: (data) => setResult(data),
  })

  return (
    <div className="space-y-5 max-w-lg">
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 bg-violet-100 rounded-xl flex items-center justify-center">
            <Calculator size={18} className="text-violet-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">Калькулятор комиссий</p>
            <p className="text-xs text-slate-400">Предпросмотр начислений по сумме заказа</p>
          </div>
        </div>

        {error && <Alert variant="error" className="mb-4">{error.response?.data?.error?.message ?? error.message}</Alert>}

        <div className="space-y-4">
          <div>
            <label className="input-label">Сумма заказа (сом) *</label>
            <input
              type="number" min="0.01" step="0.01"
              value={orderTotal}
              onChange={e => { setOrderTotal(e.target.value); setResult(null) }}
              className="input mt-1"
              placeholder="1500.00"
            />
          </div>
          <div>
            <label className="input-label">Тип заказа</label>
            <select value={orderType} onChange={e => { setOrderType(e.target.value); setResult(null) }} className="input mt-1">
              {ALL_ORDER_TYPES.map(t => <option key={t} value={t}>{ORDER_TYPE_LABEL[t] ?? t}</option>)}
            </select>
          </div>
          <Button variant="primary" onClick={() => mutate()} loading={isPending} className="w-full">
            Рассчитать
          </Button>
        </div>
      </div>

      {result && <PreviewResult result={result} />}
    </div>
  )
}

function PreviewResult({ result }) {
  const { delivery_fee, commissions = [], total_commissions } = result

  return (
    <div className="card p-5 space-y-4">
      <p className="text-sm font-bold text-slate-900">Результат расчёта</p>

      {delivery_fee != null && (
        <div className="flex justify-between items-center py-2 border-b border-slate-100">
          <span className="text-sm text-slate-600">Тариф доставки</span>
          <span className="text-sm font-bold text-sky-700">{fmtMoney(delivery_fee)}</span>
        </div>
      )}

      {commissions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400 uppercase tracking-wide">Комиссии</p>
          {commissions.map((c, i) => (
            <div key={i} className="rounded-xl bg-slate-50 px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  <Badge variant={COMMISSION_TYPE_BADGE[c.commission_type] ?? 'slate'} size="sm">
                    {COMMISSION_TYPE_LABEL[c.commission_type] ?? c.commission_type}
                  </Badge>
                  {c.scope && <Badge variant={SCOPE_BADGE[c.scope] ?? 'slate'} size="sm">{SCOPE_LABEL[c.scope] ?? c.scope}</Badge>}
                </div>
                <span className="font-bold text-indigo-700">{fmtMoney(c.amount)}</span>
              </div>
              <div className="flex gap-3 text-xs text-slate-400">
                {c.rate != null && <span>Ставка: {fmtPct(c.rate)}</span>}
                {c.base_amount != null && <span>База: {fmtMoney(c.base_amount)}</span>}
              </div>
              {c.notes && <p className="text-xs text-slate-500">{c.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {total_commissions != null && (
        <div className="flex justify-between items-center pt-2 border-t border-slate-200">
          <span className="text-sm font-semibold text-slate-700">Итого комиссий</span>
          <span className="text-base font-bold text-indigo-700">{fmtMoney(total_commissions)}</span>
        </div>
      )}
    </div>
  )
}
