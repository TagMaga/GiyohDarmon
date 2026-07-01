/**
 * FinanceSummaryKpis — 10 KPI tiles from FinanceSummaryResponse.
 *
 * All monetary values come straight from the backend (orders.*, expenses.*) —
 * no client-side commission-split math here. team_payouts/company_gross are
 * summed from the real financial_events ledger server-side; net_profit already
 * subtracts product cost and every business-expense category.
 *
 * Grid: 2-col on mobile, up to 5-col on desktop.
 *
 * Props:
 *   summary  {object|null}  FinanceSummaryResponse from /finance/summary
 *   loading  {bool}
 */

const fmtMoney = (v) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

function SummaryTile({ item }) {
  return (
    <div
      className={`rounded-2xl border bg-gradient-to-br ${item.panel} px-3.5 py-4 md:px-6 md:py-6 min-h-[104px] md:min-h-[140px] shadow-sm ${
        item.result
          ? 'border-rose-300 ring-4 ring-rose-100 shadow-lg shadow-rose-100'
          : 'border-white/70'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${item.dot}`} />
        <p className="text-[10px] md:text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">
          {item.label}
        </p>
      </div>
      <p className={`mt-4 md:mt-4 font-bold leading-tight tabular-nums ${item.result ? 'text-[22px] md:text-[36px]' : 'text-[20px] md:text-[32px]'} ${item.tone}`}>
        {item.value}
      </p>
    </div>
  )
}

export default function FinanceSummaryKpis({ summary, loading = false }) {
  if (loading) {
    return (
      <section className="rounded-2xl md:rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 md:gap-4 p-3 md:p-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-white/70 bg-slate-50 px-3.5 py-4 md:px-6 md:py-6 min-h-[104px] md:min-h-[140px] shadow-sm animate-pulse">
              <div className="h-3 w-28 rounded-full bg-slate-200" />
              <div className="mt-5 h-9 w-32 rounded-xl bg-slate-200" />
            </div>
          ))}
        </div>
      </section>
    )
  }

  const orders   = summary?.orders   ?? {}
  const expenses = summary?.expenses ?? {}

  const cards = [
    {
      label: 'Продажи товаров',
      value: `${fmtMoney(orders.total_sales)} TJS`,
      dot: 'bg-sky-500',
      tone: 'text-sky-950',
      panel: 'from-sky-50 to-cyan-100',
    },
    {
      label: 'Доставка курьерам',
      value: `${fmtMoney(orders.courier_payout)} TJS`,
      dot: 'bg-violet-500',
      tone: 'text-violet-950',
      panel: 'from-violet-50 to-fuchsia-100',
    },
    {
      label: 'Выплаты команде',
      value: `${fmtMoney(orders.team_payouts)} TJS`,
      dot: 'bg-amber-500',
      tone: 'text-amber-950',
      panel: 'from-amber-50 to-yellow-100',
    },
    {
      label: 'Себестоимость товара',
      value: `${fmtMoney(orders.product_cost)} TJS`,
      dot: 'bg-emerald-500',
      tone: 'text-emerald-950',
      panel: 'from-emerald-50 to-teal-100',
    },
    {
      label: 'Зарплаты',
      value: `${fmtMoney(expenses.salaries)} TJS`,
      dot: 'bg-cyan-500',
      tone: 'text-cyan-950',
      panel: 'from-cyan-50 to-sky-100',
    },
    {
      label: 'Аренда',
      value: `${fmtMoney(expenses.rent)} TJS`,
      dot: 'bg-teal-500',
      tone: 'text-teal-950',
      panel: 'from-teal-50 to-emerald-100',
    },
    {
      label: 'Маркетинг',
      value: `${fmtMoney(expenses.marketing)} TJS`,
      dot: 'bg-fuchsia-500',
      tone: 'text-fuchsia-950',
      panel: 'from-fuchsia-50 to-pink-100',
    },
    {
      label: 'Налоги',
      value: `${fmtMoney(expenses.taxes)} TJS`,
      dot: 'bg-slate-500',
      tone: 'text-slate-950',
      panel: 'from-slate-50 to-gray-100',
    },
    {
      label: 'Прочие расходы',
      value: `${fmtMoney(expenses.other_business_expenses)} TJS`,
      dot: 'bg-orange-500',
      tone: 'text-orange-950',
      panel: 'from-orange-50 to-amber-100',
    },
    {
      label: 'Чистая прибыль',
      value: `${fmtMoney(expenses.net_profit)} TJS`,
      dot: 'bg-rose-500',
      tone: 'text-rose-950',
      panel: 'from-rose-50 to-orange-100',
      result: true,
    },
  ]

  return (
    <section className="rounded-2xl md:rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 md:gap-4 p-3 md:p-4">
        {cards.map((item) => <SummaryTile key={item.label} item={item} />)}
      </div>
    </section>
  )
}
