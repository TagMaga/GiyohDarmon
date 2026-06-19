import Badge      from '../../../shared/components/Badge'
import EmptyState  from '../../../shared/components/EmptyState'
import { TableRowSkeleton } from '../../../shared/components/Skeleton'
import { CardSkeleton }     from '../../../shared/components/Skeleton'
import { Package } from 'lucide-react'
import {
  getId, getProductName, getProductSku,
  getSalePrice, getPurchasePrice, isProductActive,
  fmtMoney,
} from '../utils/warehouseHelpers'

// ── Mobile card list ───────────────────────────────────────────────────────────

export function ProductCardList({ products, loading }) {
  if (loading) return (
    <div className="space-y-3">{[1,2,3,4].map(i => <CardSkeleton key={i} />)}</div>
  )
  if (!products.length) return (
    <EmptyState icon={<Package size={22} />} title="Нет товаров" description="Каталог пуст" />
  )

  return (
    <div className="space-y-3">
      {products.map((p, i) => {
        const id     = getId(p) ?? i
        const active = isProductActive(p)
        return (
          <div key={id} className="card p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{getProductName(p)}</p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{getProductSku(p)}</p>
              </div>
              <Badge variant={active ? 'emerald' : 'slate'} size="sm">
                {active ? 'Активен' : 'Неактивен'}
              </Badge>
            </div>
            <div className="flex gap-4 flex-wrap">
              {getSalePrice(p) != null && (
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">Цена продажи</p>
                  <p className="text-sm font-bold text-indigo-700">{fmtMoney(getSalePrice(p))}</p>
                </div>
              )}
              {getPurchasePrice(p) != null && (
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">Закупка</p>
                  <p className="text-sm font-semibold text-slate-600">{fmtMoney(getPurchasePrice(p))}</p>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Desktop table ──────────────────────────────────────────────────────────────

const TH = ({ children, right }) => (
  <th className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
    {children}
  </th>
)

export function ProductTable({ products, loading }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <TH>Название</TH>
            <TH>Артикул</TH>
            <TH right>Цена продажи</TH>
            <TH right>Закупочная</TH>
            <TH>Статус</TH>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading && [1,2,3,4,5].map(i => <TableRowSkeleton key={i} cols={5} />)}

          {!loading && products.length === 0 && (
            <tr><td colSpan={5} className="py-0">
              <EmptyState icon={<Package size={22} />} title="Нет товаров" description="Каталог пуст" />
            </td></tr>
          )}

          {!loading && products.map((p, i) => {
            const id     = getId(p) ?? i
            const active = isProductActive(p)
            return (
              <tr key={id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-900 max-w-[240px]">
                  <span className="truncate block">{getProductName(p)}</span>
                </td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{getProductSku(p)}</td>
                <td className="px-4 py-3 text-right font-semibold text-indigo-700 tabular-nums">
                  {getSalePrice(p) != null ? fmtMoney(getSalePrice(p)) : '—'}
                </td>
                <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                  {getPurchasePrice(p) != null ? fmtMoney(getPurchasePrice(p)) : '—'}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={active ? 'emerald' : 'slate'}>
                    {active ? 'Активен' : 'Неактивен'}
                  </Badge>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
