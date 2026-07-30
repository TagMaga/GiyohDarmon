import { useMemo, useState } from 'react'
import { Archive, Package, RotateCcw, Search } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Alert from '../../../shared/components/Alert'
import Badge from '../../../shared/components/Badge'
import Button from '../../../shared/components/Button'
import EmptyState from '../../../shared/components/EmptyState'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import { updateProduct } from '../api'
import { aggregateStocks, MAIN_WAREHOUSE_ID } from './InventoryFilters'
import {
  getAvailableQty,
  getId,
  getProductImageSrcSet,
  getProductImageVariant,
  getProductName,
  getProductSku,
  getQuantity,
  getReservedQty,
  isProductActive,
} from '../utils/warehouseHelpers'

export default function ProductArchivePanel({
  products = [],
  inventory = [],
  distribution,
  loading = false,
  error,
}) {
  const [search, setSearch] = useState('')
  const qc = useQueryClient()
  const toast = useToast()

  const normalizedDistribution = useMemo(() => {
    if (distribution) return distribution
    return {
      locations: [{ id: MAIN_WAREHOUSE_ID, type: 'main', name: 'Главный склад' }],
      items: inventory.map((inv) => ({
        product_id: inv.product_id ?? inv.ProductID,
        warehouse_id: MAIN_WAREHOUSE_ID,
        quantity: getQuantity(inv),
        reserved_quantity: getReservedQty(inv),
        blocked_quantity: inv.blocked_quantity ?? inv.BlockedQuantity ?? 0,
        available_quantity: getAvailableQty(inv),
      })),
    }
  }, [distribution, inventory])

  const rows = useMemo(() => {
    const locationById = new Map(
      (normalizedDistribution.locations ?? []).map((location) => [location.id, location]),
    )
    const stocksByProduct = new Map()
    for (const item of normalizedDistribution.items ?? []) {
      if (!stocksByProduct.has(item.product_id)) stocksByProduct.set(item.product_id, [])
      stocksByProduct.get(item.product_id).push({
        ...item,
        location: locationById.get(item.warehouse_id) ?? {
          id: item.warehouse_id,
          name: 'Склад',
          type: 'courier',
        },
      })
    }

    const q = search.trim().toLowerCase()
    return products
      .filter((product) => !isProductActive(product))
      .filter((product) => !q ||
        getProductName(product).toLowerCase().includes(q) ||
        getProductSku(product).toLowerCase().includes(q))
      .map((product) => {
        const stocks = stocksByProduct.get(getId(product)) ?? []
        return { product, stocks, metrics: aggregateStocks(stocks) }
      })
  }, [normalizedDistribution, products, search])

  const restoreMutation = useMutation({
    mutationFn: (productId) => updateProduct(productId, { is_active: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.warehouse.products })
      qc.invalidateQueries({ queryKey: KEYS.seller.products })
      toast.success('Товар восстановлен из архива')
    },
  })

  const errMsg = error?.response?.data?.error?.message ??
    error?.message ??
    restoreMutation.error?.response?.data?.error?.message ??
    restoreMutation.error?.message

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-[40px] min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
            <Search size={17} className="text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по названию или SKU…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </label>
          <Badge variant="slate">{rows.length} в архиве</Badge>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Архивные товары недоступны для новых заказов. Их остатки, движения, фотографии и история сохранены.
        </p>
      </section>

      {errMsg && <Alert variant="error" title="Ошибка">{errMsg}</Alert>}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Загрузка архива…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Archive size={22} />}
          title={search ? 'В архиве ничего не найдено' : 'Архив пуст'}
          description={search ? 'Измените поисковый запрос.' : 'Архивированные товары появятся здесь.'}
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)] lg:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Товар</th>
                  <th className="px-4 py-3 text-right">Всего</th>
                  <th className="px-4 py-3 text-right">Главный склад</th>
                  <th className="px-4 py-3 text-right">У курьеров</th>
                  <th className="px-4 py-3 text-right">Резерв</th>
                  <th className="px-4 py-3 text-right">В передаче</th>
                  <th className="px-4 py-3 text-right">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ product, metrics }) => (
                  <tr key={getId(product)} className="hover:bg-slate-50">
                    <td className="px-4 py-3"><ProductIdentity product={product} /></td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-950">{metrics.quantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{metrics.mainQuantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{metrics.courierQuantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-amber-700">{metrics.reserved}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-indigo-700">{metrics.blocked}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<RotateCcw size={14} />}
                        loading={restoreMutation.isPending && restoreMutation.variables === getId(product)}
                        onClick={() => restoreMutation.mutate(getId(product))}
                      >
                        Восстановить
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 lg:hidden">
            {rows.map(({ product, metrics }) => (
              <article key={getId(product)} className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
                <ProductIdentity product={product} />
                <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-2.5 text-center">
                  <Metric label="Всего" value={metrics.quantity} />
                  <Metric label="Склад" value={metrics.mainQuantity} />
                  <Metric label="Курьеры" value={metrics.courierQuantity} />
                  <Metric label="Резерв" value={metrics.reserved} />
                </div>
                <Button
                  className="mt-3"
                  fullWidth
                  icon={<RotateCcw size={14} />}
                  loading={restoreMutation.isPending && restoreMutation.variables === getId(product)}
                  onClick={() => restoreMutation.mutate(getId(product))}
                >
                  Восстановить
                </Button>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ProductIdentity({ product }) {
  const image = getProductImageVariant(product, 'thumbnail')
  return (
    <div className="flex min-w-0 items-center gap-3">
      {image ? (
        <img
          src={image}
          srcSet={getProductImageSrcSet(product)}
          sizes="44px"
          loading="lazy"
          alt={getProductName(product)}
          className="h-11 w-11 flex-shrink-0 rounded-lg border border-slate-200 object-cover"
        />
      ) : (
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
          <Package size={18} />
        </div>
      )}
      <span className="min-w-0">
        <span className="block truncate font-bold text-slate-900">{getProductName(product)}</span>
        <span className="block font-mono text-xs text-slate-400">{getProductSku(product)}</span>
      </span>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <p className="font-bold tabular-nums text-slate-950">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase text-slate-400">{label}</p>
    </div>
  )
}
