/**
 * RevenueBreakdownCard — owner profit formula for delivered orders.
 *
 * Shows:
 *   - Total sales
 *   - Courier delivery salary
 *   - Team payouts
 *   - Product cost
 *   - Gross profit
 *   - Visual stacked bar
 *
 * Props:
 *   revenue  {object}  FinanceRevenueSummary
 *   orders   {object}  FinanceOrdersSummary
 *   loading  {bool}
 */
import { Package, Truck, Users2, Wallet } from 'lucide-react'
import { fmtMoney }          from '../../hr/utils/hrHelpers'

function pct(part, total) {
  if (!total) return 0
  return Math.min((part / total) * 100, 100)
}

function PctBar({ deliveryPct, employeePct, productPct, profitPct }) {
  const rest = Math.max(0, 100 - deliveryPct - employeePct - productPct - profitPct)
  return (
    <div className="h-3 rounded-full overflow-hidden bg-slate-100 flex">
      <div
        className="h-full bg-sky-400 transition-all duration-500"
        style={{ width: `${deliveryPct}%` }}
        title={`Доставка ${deliveryPct.toFixed(1)}%`}
      />
      <div
        className="h-full bg-amber-400 transition-all duration-500"
        style={{ width: `${employeePct}%` }}
        title={`Команды ${employeePct.toFixed(1)}%`}
      />
      <div
        className="h-full bg-violet-500 transition-all duration-500"
        style={{ width: `${productPct}%` }}
        title={`Себестоимость ${productPct.toFixed(1)}%`}
      />
      <div
        className="h-full bg-emerald-500 transition-all duration-500"
        style={{ width: `${profitPct}%` }}
        title={`Валовая прибыль ${profitPct.toFixed(1)}%`}
      />
      {rest > 0.5 && (
        <div
          className="h-full bg-slate-200 transition-all duration-500"
          style={{ width: `${rest}%` }}
        />
      )}
    </div>
  )
}

function BreakdownRow({ icon, dotClass, label, pctValue, value, strong = false }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <div className="flex items-center gap-1.5">
          {icon}
          <span className={`text-xs ${strong ? 'text-slate-700 font-semibold' : 'text-slate-600 font-medium'}`}>{label}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {pctValue !== undefined && <span className="text-[11px] text-slate-400">{pctValue.toFixed(1)}%</span>}
        <span className={`text-sm font-bold tabular-nums ${strong ? 'text-emerald-700' : 'text-slate-900'}`}>{fmtMoney(value)}</span>
      </div>
    </div>
  )
}

export default function RevenueBreakdownCard({ revenue, orders, loading = false }) {
  if (loading) {
    return (
      <div className="card p-5 space-y-4">
        <div className="skeleton h-5 w-40 rounded" />
        <div className="skeleton h-3 w-full rounded-full" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex justify-between">
              <div className="skeleton h-4 w-32 rounded" />
              <div className="skeleton h-4 w-20 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const totalSales  = orders?.total_sales ?? 0
  const delivery    = orders?.delivery_fees ?? 0
  const netRevenue  = orders?.net_revenue ?? 0
  const employees   = revenue?.total_employee_payouts ?? 0
  const productCost = orders?.product_cost ?? 0
  const grossProfit = orders?.gross_profit ?? 0
  const deliveryPct = pct(delivery, totalSales)
  const employeePct = pct(employees, netRevenue)
  const productPct  = pct(productCost, totalSales)
  const profitPct   = pct(Math.max(grossProfit, 0), totalSales)

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Распределение выручки</h3>
        <span className="text-xs text-slate-400">формула прибыли</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900 tabular-nums">{fmtMoney(totalSales)}</span>
        <span className="text-xs text-slate-400">продажи</span>
      </div>

      <PctBar
        deliveryPct={deliveryPct}
        employeePct={pct(employees, totalSales)}
        productPct={productPct}
        profitPct={profitPct}
      />

      <div className="space-y-2.5">
        <BreakdownRow
          icon={<Truck size={12} className="text-slate-400" />}
          dotClass="bg-sky-400"
          label="Доставка"
          pctValue={deliveryPct}
          value={delivery}
        />
        <BreakdownRow
          icon={<Users2 size={12} className="text-slate-400" />}
          dotClass="bg-amber-400"
          label="Команды"
          pctValue={employeePct}
          value={employees}
        />
        <BreakdownRow
          icon={<Package size={12} className="text-slate-400" />}
          dotClass="bg-violet-500"
          label="Себестоимость"
          pctValue={productPct}
          value={productCost}
        />
        <div className="border-t border-slate-100 pt-2.5">
          <BreakdownRow
            icon={<Wallet size={12} className="text-emerald-500" />}
            dotClass="bg-emerald-500"
            label="Валовая прибыль"
            pctValue={profitPct}
            value={grossProfit}
            strong
          />
        </div>
      </div>
    </div>
  )
}
