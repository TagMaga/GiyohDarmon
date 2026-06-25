import { useMemo, useState } from 'react'
import { Download, Package, PackagePlus, Pencil, Search } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import Badge from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import Alert from '../../../shared/components/Alert'
import ProductModal from '../components/ProductModal'
import ProductDrawer from '../components/ProductDrawer'
import ReceivingModal from '../components/ReceivingModal'
import WriteoffModal from '../components/WriteoffModal'
import TransferModal from '../components/TransferModal'
import useWarehouseData from '../hooks/useWarehouseData'
import {
  fmtMoney,
  getCategoryName,
  getId,
  getProductBarcode,
  getProductCategoryId,
  getProductImage,
  getProductName,
  getProductSku,
  getPurchasePrice,
  getSalePrice,
  isUUID,
  isProductActive,
} from '../utils/warehouseHelpers'

export default function WarehouseProductsPage() {
  const data = useWarehouseData()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [editingProduct, setEditingProduct] = useState(null)
  const [drawerProduct, setDrawerProduct] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [receiveProduct, setReceiveProduct] = useState(undefined)
  const [writeoffProduct, setWriteoffProduct] = useState(null)
  const [transferProduct, setTransferProduct] = useState(null)
  const validCategories = data.categories.filter((c) => isUUID(getId(c)))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.products.filter((p) => {
      if (categoryFilter && getProductCategoryId(p) !== categoryFilter) return false
      if (!q) return true
      return (
        getProductName(p).toLowerCase().includes(q) ||
        getProductSku(p).toLowerCase().includes(q) ||
        getProductBarcode(p).toLowerCase().includes(q)
      )
    })
  }, [categoryFilter, data.products, search])

  return (
    <div className="animate-fade-in p-6">
      <PageHeader
        title="Товары"
        subtitle="Карточки товаров, SKU, штрихкоды, категории, цены и изображения."
        icon={<Package size={20} />}
        action={<Button variant="primary" icon={<PackagePlus size={15} />} onClick={() => setShowCreate(true)}>Добавить товар</Button>}
      />

      {data.error && (
        <Alert variant="error" title="Ошибка загрузки данных" className="mb-5">
          {data.error?.response?.data?.error?.message ?? data.error?.message}
        </Alert>
      )}

      <section className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)] md:grid-cols-[1fr_220px]">
        <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
          <Search size={17} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию, SKU или штрихкоду…" className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" />
        </label>
        <select className="input py-2" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">Все категории</option>
          {validCategories.map((c) => <option key={getId(c)} value={getId(c)}>{getCategoryName(c)}</option>)}
        </select>
      </section>

      {filtered.length === 0 ? (
        <EmptyState icon={<Package size={22} />} title="Товары не найдены" description="Создайте товар или измените фильтры поиска." action={<Button variant="primary" onClick={() => setShowCreate(true)}>Добавить товар</Button>} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)] lg:block">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 text-left">Товар</th>
                  <th className="px-3 py-2.5 text-left">Штрихкод</th>
                  <th className="px-3 py-2.5 text-left">Категория</th>
                  <th className="px-3 py-2.5 text-right">Закупка</th>
                  <th className="px-3 py-2.5 text-right">Продажа</th>
                  <th className="px-3 py-2.5 text-left">Статус</th>
                  <th className="px-3 py-2.5 text-right">Операции</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <tr key={getId(p)} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <button className="flex items-center gap-3 text-left" onClick={() => setDrawerProduct(p)}>
                        <ProductThumb product={p} />
                        <span>
                          <span className="block font-bold text-slate-900">{getProductName(p)}</span>
                          <span className="block font-mono text-xs text-slate-400">{getProductSku(p)}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{getProductBarcode(p)}</td>
                    <td className="px-3 py-2.5 text-slate-500">{getCategoryName(data.categoryMap[getProductCategoryId(p)])}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-600">{fmtMoney(getPurchasePrice(p))}</td>
                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-indigo-700">{fmtMoney(getSalePrice(p))}</td>
                    <td className="px-3 py-2.5"><Badge variant={isProductActive(p) ? 'emerald' : 'slate'}>{isProductActive(p) ? 'Активен' : 'Неактивен'}</Badge></td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <IconButton title="Приход" icon={<Download size={15} />} onClick={() => setReceiveProduct(p)} />
                        <IconButton title="Изменить" icon={<Pencil size={15} />} onClick={() => setEditingProduct(p)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 lg:hidden">
            {filtered.map((p) => (
              <article key={getId(p)} className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
                <button onClick={() => setDrawerProduct(p)} className="flex w-full items-start gap-3 text-left">
                  <ProductThumb product={p} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-950">{getProductName(p)}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-400">{getProductSku(p)}</p>
                      </div>
                      <Badge variant={isProductActive(p) ? 'emerald' : 'slate'}>{isProductActive(p) ? 'Активен' : 'Неактивен'}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{getCategoryName(data.categoryMap[getProductCategoryId(p)])} · {getProductBarcode(p)}</p>
                  </div>
                </button>
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2.5">
                  <Metric label="Закупка" value={fmtMoney(getPurchasePrice(p))} />
                  <Metric label="Продажа" value={fmtMoney(getSalePrice(p))} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button size="sm" icon={<Download size={14} />} onClick={() => setReceiveProduct(p)}>Приход</Button>
                  <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEditingProduct(p)}>Изменить</Button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <ProductModal open={showCreate} onClose={() => setShowCreate(false)} categories={data.categories} suppliers={data.suppliers} />
      <ProductModal open={Boolean(editingProduct)} onClose={() => setEditingProduct(null)} product={editingProduct} categories={data.categories} suppliers={data.suppliers} />
      <ProductDrawer
        product={drawerProduct}
        inventory={data.inventory}
        movements={data.movements}
        categoryMap={data.categoryMap}
        warehouseMap={data.warehouseMap}
        onClose={() => setDrawerProduct(null)}
        onReceive={setReceiveProduct}
        onWriteoff={setWriteoffProduct}
        onTransfer={setTransferProduct}
        onEdit={setEditingProduct}
      />
      <ReceivingModal open={receiveProduct !== undefined} onClose={() => setReceiveProduct(undefined)} initialProduct={receiveProduct} products={data.products} warehouses={data.warehouses} inventory={data.inventory} />
      <WriteoffModal open={Boolean(writeoffProduct)} onClose={() => setWriteoffProduct(null)} products={writeoffProduct ? [writeoffProduct] : data.products} warehouses={data.warehouses} inventory={data.inventory} />
      <TransferModal open={Boolean(transferProduct)} onClose={() => setTransferProduct(null)} products={transferProduct ? [transferProduct] : data.products} warehouses={data.warehouses} inventory={data.inventory} />
    </div>
  )
}

function ProductThumb({ product }) {
  const image = getProductImage(product)
  if (image) return <img src={image} alt={getProductName(product)} className="h-10 w-10 flex-shrink-0 rounded-lg border border-slate-200 object-cover" />
  return <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400"><Package size={16} /></div>
}

function IconButton({ title, icon, onClick }) {
  return (
    <button title={title} onClick={onClick} className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
      {icon}
    </button>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  )
}
