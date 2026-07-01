/**
 * RevenueBreakdownCard — owner profit formula for delivered orders.
 *
 * Shows:
 *   - Product sales
 *   - Client delivery charges
 *   - Courier delivery salary
 *   - Team payouts
 *   - Company income
 *   - Visual stacked bar
 *
 * Props:
 *   revenue  {object}  FinanceRevenueSummary
 *   orders   {object}  FinanceOrdersSummary
 *   loading  {bool}
 */
import { Package, Receipt, Truck, Users2, Wallet } from 'lucide-react'
import { fmtMoney }          from '../../hr/utils/hrHelpers'

function pct(part, total) {
  if (!total) return 0
  return Math.min((part / total) * 100, 100)
}

function fmtPct(v) {
  const r = Math.round(v)
  return Math.abs(v - r) < 0.05 ? `${r}` : v.toFixed(1)
}

function PctBar({ clientDeliveryPct, deliveryPct, employeePct, productPct, expensePct, profitPct }) {
  const rest = Math.max(0, 100 - clientDeliveryPct - deliveryPct - employeePct - productPct - expensePct - profitPct)
  return (
    <div className="h-3 rounded-full overflow-hidden bg-slate-100 flex">
      <div
        className="h-full bg-emerald-300 transition-all duration-500"
        style={{ width: `${clientDeliveryPct}%` }}
        title={`Доставка клиентов ${fmtPct(clientDeliveryPct)}%`}
      />
      <div
        className="h-full bg-sky-400 transition-all duration-500"
        style={{ width: `${deliveryPct}%` }}
        title={`Доставка ${fmtPct(deliveryPct)}%`}
      />
      <div
        className="h-full bg-amber-400 transition-all duration-500"
        style={{ width: `${employeePct}%` }}
        title={`Команды ${fmtPct(employeePct)}%`}
      />
      <div
        className="h-full bg-teal-400 transition-all duration-500"
        style={{ width: `${productPct}%` }}
        title={`Себестоимость ${fmtPct(productPct)}%`}
      />
      <div
        className="h-full bg-orange-400 transition-all duration-500"
        style={{ width: `${expensePct}%` }}
        title={`Прочие расходы ${fmtPct(expensePct)}%`}
      />
      <div
        className="h-full bg-emerald-500 transition-all duration-500"
        style={{ width: `${profitPct}%` }}
        title={`Доход компании ${fmtPct(profitPct)}%`}
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
        {pctValue !== undefined && <span className="text-[11px] text-slate-400">{fmtPct(pctValue)}%</span>}
        <span className={`text-sm font-bold tabular-nums ${strong ? 'text-emerald-700' : 'text-slate-900'}`}>{fmtMoney(value)}</span>
      </div>
    </div>
  )
}

export default function RevenueBreakdownCard({ revenue, orders, expenses, loading = false }) {
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

  const productSales = orders?.total_sales ?? 0
  const clientDelivery = orders?.client_delivery_fees ?? 0
  const clientTotal  = productSales + clientDelivery
  const delivery    = orders?.courier_payout ?? 0
  const commissionBase = orders?.commission_base ?? 0
  const employees   = orders?.team_payouts ?? 0
  const productCost = orders?.product_cost ?? 0
  const otherExpenses = expenses?.total_business_expenses ?? 0
  const netProfit = expenses?.net_profit ?? 0
  const clientDeliveryPct = pct(clientDelivery, clientTotal)
  const deliveryPct = pct(delivery, clientTotal)
  const employeePct = pct(employees, commissionBase)
  const productPct = pct(productCost, commissionBase)
  const expensePct = pct(otherExpenses, commissionBase)
  const profitPct   = pct(Math.max(netProfit, 0), commissionBase)

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Распределение выручки</h3>
        <span className="text-xs text-slate-400">формула прибыли</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900 tabular-nums">{fmtMoney(clientTotal)}</span>
        <span className="text-xs text-slate-400">к оплате клиентов</span>
      </div>

      <PctBar
        clientDeliveryPct={clientDeliveryPct}
        deliveryPct={deliveryPct}
        employeePct={employeePct}
        productPct={productPct}
        expensePct={expensePct}
        profitPct={profitPct}
      />

      <div className="space-y-2.5">
        <BreakdownRow
          icon={<Truck size={12} className="text-slate-400" />}
          dotClass="bg-sky-400"
          label="Доставка курьерам"
          pctValue={deliveryPct}
          value={delivery}
        />
        <div className="border-t border-slate-100 pt-2.5">
          <BreakdownRow
            icon={<Wallet size={12} className="text-emerald-500" />}
            dotClass="bg-emerald-500"
            label="Комиссионная база"
            value={commissionBase}
            strong
          />
        </div>
        <BreakdownRow
          icon={<Users2 size={12} className="text-slate-400" />}
          dotClass="bg-amber-400"
          label="Команды"
          pctValue={employeePct}
          value={employees}
        />
        <BreakdownRow
          icon={<Package size={12} className="text-slate-400" />}
          dotClass="bg-slate-300"
          label="Себестоимость"
          pctValue={productPct}
          value={productCost}
        />
        <BreakdownRow
          icon={<Receipt size={12} className="text-slate-400" />}
          dotClass="bg-orange-400"
          label="Расходы бизнеса"
          pctValue={expensePct}
          value={otherExpenses}
        />
        <div className="border-t border-slate-100 pt-2.5">
          <BreakdownRow
            icon={<Wallet size={12} className="text-emerald-500" />}
            dotClass="bg-emerald-500"
            label="Чистая прибыль"
            pctValue={profitPct}
            value={netProfit}
            strong
          />
        </div>
      </div>
    </div>
  )
}
