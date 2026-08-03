import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShoppingCart, ArrowLeft, Check, Wallet } from 'lucide-react'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import { fetchOrder, updateOrder, addPrepayment } from '../api'
import { uploadToMedia } from '../../../shared/api/mediaUpload'
import useProducts from '../hooks/useProducts'
import useDeliverySettings from '../hooks/useDeliverySettings'
import useCities from '../hooks/useCities'
import CartItemRow from '../components/CartItemRow'
import CartTotalsBreakdown from '../components/CartTotalsBreakdown'
import DeliveryModeSelector from '../components/DeliveryModeSelector'
import Alert from '../../../shared/components/Alert'
import {
  fmtAmount, isOrderEditable,
  PREPAYMENT_STATUS_LABELS, PREPAYMENT_STATUS_BADGE,
} from '../../../shared/orderStatusConfig'
import { Search, X, Package } from 'lucide-react'

const PREPAY_BADGE_CLASS = {
  amber:   'bg-amber-50 text-amber-700 border-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rose:    'bg-rose-50 text-rose-700 border-rose-200',
}

// ── Add prepayment (seller/manager/team lead, any time after order creation) ──
function AddPrepaymentCard({ orderId, prepaymentAmount, prepaymentStatus, onAdded }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [proofFile, setProofFile] = useState(null)
  const [error, setError] = useState(null)

  const mut = useMutation({
    mutationFn: async () => {
      const value = Number(amount)
      if (!value || value <= 0) throw new Error('Введите сумму предоплаты')
      let mediaAssetId = null
      if (proofFile) {
        const asset = await uploadToMedia(proofFile, 'prepayment_proof')
        mediaAssetId = asset?.id ?? null
      }
      return addPrepayment(orderId, value, mediaAssetId)
    },
    onSuccess: () => {
      toast.success('Предоплата добавлена, отправлена диспетчеру на проверку')
      setAmount('')
      setProofFile(null)
      setError(null)
      onAdded?.()
    },
    onError: (err) => {
      const msg = err?.response?.data?.error?.message
        ?? err?.response?.data?.error
        ?? err?.message
        ?? 'Не удалось добавить предоплату'
      setError(String(msg))
    },
  })

  const statusLabel = prepaymentStatus ? PREPAYMENT_STATUS_LABELS[prepaymentStatus] : null
  const statusColor = prepaymentStatus ? PREPAYMENT_STATUS_BADGE[prepaymentStatus] : null

  return (
    <div className="card p-5 space-y-3">
      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
        <Wallet size={15} className="text-amber-500" />
        Предоплата
        {statusLabel && (
          <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full border ${PREPAY_BADGE_CLASS[statusColor]}`}>
            {statusLabel}
          </span>
        )}
      </h3>

      {prepaymentAmount > 0 && (
        <p className="text-xs text-slate-500">
          Уже внесено: <b className="text-slate-700">{fmtAmount(prepaymentAmount)} с</b>
        </p>
      )}

      <div className="space-y-1">
        <label className="input-label">Сумма новой предоплаты</label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0.01"
            step="0.01"
            className="input pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none
                       [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">с</span>
        </div>
      </div>

      <div className="space-y-1">
        <label className="input-label">Подтверждение оплаты (необязательно)</label>
        <div className="flex gap-2">
          <label className="flex-1 cursor-pointer">
            <span className="block text-center text-xs font-semibold py-2.5 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 text-amber-700 hover:bg-amber-50 transition-colors">
              📎 Прикрепить файл / фото
            </span>
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        {proofFile && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-amber-200 mt-1">
            {proofFile.type?.startsWith('image/') ? (
              <img src={URL.createObjectURL(proofFile)} alt="proof"
                className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-amber-200" />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 text-amber-700 text-xs font-bold">
                PDF
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-slate-700 truncate">{proofFile.name}</p>
              <p className="text-[10px] text-slate-400">{(proofFile.size / 1024).toFixed(0)} KB</p>
            </div>
            <button type="button" onClick={() => setProofFile(null)}
              className="text-slate-400 hover:text-rose-500 text-xs font-bold px-1">✕</button>
          </div>
        )}
      </div>

      {error && <Alert variant="error" title="Ошибка">{error}</Alert>}

      <button
        type="button"
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !amount}
        className="w-full flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-xl
                   bg-amber-500 text-white hover:bg-amber-600 active:scale-[0.98] transition-all
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {mut.isPending ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Добавляем…
          </>
        ) : (
          'Добавить предоплату'
        )}
      </button>
    </div>
  )
}

// ── Product search (same as CreateOrder) ──────────────────────────────────────
function ProductSearch({ products, loading, onAdd }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return products.slice(0, 12)
    return products.filter((p) =>
      p.name?.toLowerCase().includes(query) ||
      p.sku?.toLowerCase().includes(query) ||
      p.article?.toLowerCase().includes(query)
    ).slice(0, 12)
  }, [q, products])

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск товара…" className="input pl-9 pr-9" />
        {q && (
          <button type="button" onClick={() => setQ('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>
      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[72px] rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      )}
      {!loading && filtered.length === 0 && q.length > 0 && (
        <p className="text-xs text-slate-400 text-center py-3">Товары не найдены</p>
      )}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-52 overflow-y-auto scrollbar-none">
          {filtered.map((p) => (
            <button key={p.id} type="button" onClick={() => { onAdd(p); setQ('') }}
              className="text-left p-3 rounded-xl border border-slate-200 hover:border-indigo-300
                         hover:bg-indigo-50 active:scale-[0.97] transition-all group">
              {getProductImageUrl(p) ? (
                <img src={getProductImageUrl(p)} alt={p.name}
                  className="w-10 h-10 rounded-lg object-cover mb-1.5 flex-shrink-0" />
              ) : (
                <div className="w-6 h-6 rounded-lg bg-slate-100 group-hover:bg-indigo-100
                                flex items-center justify-center mb-1.5 transition-colors">
                  <Package size={11} className="text-slate-400 group-hover:text-indigo-500" />
                </div>
              )}
              <p className="text-[11px] font-semibold text-slate-800 leading-tight line-clamp-2">{p.name}</p>
              {(p.sale_price ?? p.base_price) != null && (
                <p className="text-[10px] font-medium text-indigo-600 mt-0.5">
                  {fmtAmount(p.sale_price ?? p.base_price)}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Helpers (same as CreateOrder) ─────────────────────────────────────────────
function calcProductTotal(items) {
  return items.reduce((acc, it) => acc + Math.max(0, Number(it.total_price) || 0), 0)
}
function calcPayloadUnitPrice(item) {
  const quantity = Number(item.quantity) || 0
  if (quantity <= 0) return 0
  const fallbackTotal = (Number(item.unit_price) || 0) * quantity
  const lineTotal = Number.isFinite(Number(item.total_price)) ? Number(item.total_price) : fallbackTotal
  return Math.max(0, lineTotal) / quantity
}
function getProductImageUrl(product) {
  if (!product) return ''
  const direct = product.product_image_url ?? product.ProductImageURL ?? product.image_url ?? product.ImageURL ?? product.image ?? product.Image
  if (direct) return direct
  const images = Array.isArray(product.images) ? product.images : (Array.isArray(product.Images) ? product.Images : [])
  const primary = images.find((img) => img.is_primary ?? img.IsPrimary) ?? images[0]
  return primary?.image_url ?? primary?.ImageURL ?? primary?.url ?? primary?.URL ?? ''
}
function formatDeliveryFee(fee) {
  return fee <= 0 ? 'Бесплатно' : `${fee.toLocaleString('ru-RU')} с`
}

// ── Map order data → form state ───────────────────────────────────────────────
function orderToForm(order) {
  return {
    customerId:   order.customer_id ?? order.customer?.id ?? null,
    fullName:     order.customer?.full_name ?? '',
    phone:        order.customer?.phone ?? '',
    cityId:       order.city_id ?? '',
    city:         order.city ?? '',
    address:      order.delivery_address ?? '',
    comment:      order.notes ?? '',
    deliveryMode: order.delivery_method ?? 'normal',
    cartItems: (order.items ?? []).map((item) => ({
      product_id:  item.product_id,
      name:        item.product_name ?? item.name ?? '',
      sku:         item.sku ?? '',
      product_image_url: item.product_image_url ?? item.ProductImageURL ?? '',
      quantity:    item.quantity,
      unit_price:  item.unit_price,
      total_price: item.total_price ?? (item.quantity * item.unit_price),
    })),
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function EditOrder() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()

  // Use order passed via navigate state if available, otherwise fetch
  const stateOrder = location.state?.order ?? null

  const { data: fetchedOrder, isLoading: orderLoading, refetch: refetchOrder } = useQuery({
    queryKey: ['seller', 'order', id],
    queryFn:  () => fetchOrder(id),
    staleTime: 0,
  })

  // fetchedOrder takes priority once loaded so a prepayment added on this
  // page (which refetches the order) is reflected immediately — stateOrder
  // is only a fast first paint, not a source of truth thereafter.
  const order = fetchedOrder ?? stateOrder
  const [form, setForm] = useState(null)
  const [submitError, setSubmitError] = useState(null)

  // Pre-fill form once order is available
  useEffect(() => {
    if (order && !form) {
      setForm(orderToForm(order))
    }
  }, [order, form])

  const { data: productsRaw = [], isLoading: prodLoading } = useProducts()
  const { data: deliverySettings } = useDeliverySettings()
  const { data: cities = [] } = useCities()

  const products = Array.isArray(productsRaw) ? productsRaw : []
  const globalNormalFee = deliverySettings?.normal_fee ?? 0
  const globalFastFee   = deliverySettings?.fast_fee   ?? 0

  const setField = useCallback((key, val) => setForm((p) => ({ ...p, [key]: val })), [])

  const safeCart = (prev) => (Array.isArray(prev?.cartItems) ? prev.cartItems : [])

  const addToCart = useCallback((product) => {
    setForm((prev) => {
      const cart = safeCart(prev)
      const existing = cart.findIndex((i) => i.product_id === product.id)
      if (existing >= 0) {
        return { ...prev, cartItems: cart.map((item, idx) =>
          idx === existing
            ? { ...item, quantity: item.quantity + 1, total_price: item.unit_price * (item.quantity + 1) }
            : item
        )}
      }
      const unitPrice = Number(product.sale_price ?? product.base_price ?? 0)
      const productImageUrl = getProductImageUrl(product)
      return { ...prev, cartItems: [...cart, {
        product_id: product.id, name: product.name, sku: product.sku ?? '',
        product_image_url: productImageUrl,
        quantity: 1, unit_price: unitPrice, total_price: unitPrice,
      }]}
    })
  }, [])

  const updateCartItem = useCallback((idx, updated) => {
    setForm((prev) => {
      const items = [...safeCart(prev)]
      items[idx] = updated
      return { ...prev, cartItems: items }
    })
  }, [])

  const removeCartItem = useCallback((idx) => {
    setForm((prev) => ({ ...prev, cartItems: safeCart(prev).filter((_, i) => i !== idx) }))
  }, [])

  // Calculations
  const cartItems = form ? safeCart(form) : []
  useEffect(() => {
    if (!form || products.length === 0 || cartItems.length === 0) return
    setForm((prev) => {
      const cart = safeCart(prev)
      let changed = false
      const nextCart = cart.map((item) => {
        if (item.product_image_url) return item
        const product = products.find((p) => p.id === item.product_id)
        const productImageUrl = getProductImageUrl(product)
        if (!productImageUrl) return item
        changed = true
        return { ...item, product_image_url: productImageUrl }
      })
      return changed ? { ...prev, cartItems: nextCart } : prev
    })
  }, [form, products, cartItems.length])
  const firstProductId = cartItems[0]?.product_id ?? null
  const firstProduct = useMemo(
    () => firstProductId ? products.find((p) => p.id === firstProductId) ?? null : null,
    [firstProductId, products]
  )
  const normalFee    = firstProduct?.normal_delivery_fee ?? firstProduct?.NormalDeliveryFee ?? globalNormalFee
  const fastFee      = firstProduct?.express_delivery_fee ?? firstProduct?.ExpressDeliveryFee ?? globalFastFee
  const deliveryFee  = form?.deliveryMode === 'fast' ? fastFee : normalFee
  const productTotal = useMemo(() => calcProductTotal(cartItems), [cartItems])
  const totalAmount  = productTotal + deliveryFee

  // Block editing once the order has been delivered
  const isTerminal = order && !isOrderEditable(order.status)

  const submitMut = useMutation({
    onMutate: () => { setSubmitError(null) },
    mutationFn: async () => {
      if (isTerminal) throw new Error('Этот заказ больше нельзя редактировать')

      return updateOrder(id, {
        city_id:          form.cityId || undefined,
        delivery_address: form.address.trim() || undefined,
        delivery_method:  form.deliveryMode,
        notes:            form.comment.trim() || undefined,
        items: cartItems.map((it) => ({
          product_id: it.product_id,
          quantity:   it.quantity,
          unit_price: calcPayloadUnitPrice(it),
        })),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.seller.orders })
      qc.invalidateQueries({ queryKey: ['seller', 'order', id] })
      // Manager's and team lead's order lists are built on useOwnerOrders,
      // keyed under this prefix regardless of their filter params.
      qc.invalidateQueries({ queryKey: ['orders', 'list'] })
      toast.success('Заказ успешно обновлён')
      navigate(-1)
    },
    onError: (err) => {
      const msg = err?.response?.data?.error?.message
        ?? err?.response?.data?.error
        ?? err?.message
        ?? 'Ошибка при сохранении'
      setSubmitError(String(msg))
    },
  })

  const canSubmit = (() => {
    if (!form) return false
    if (isTerminal) return false
    if (cartItems.length === 0) return false
    if (cartItems.some((i) => calcPayloadUnitPrice(i) < 0)) return false
    if (productTotal < 1) return false
    return true
  })()

  // Loading state
  if (!order && orderLoading) {
    return (
      <div className="page-container">
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-24 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="page-container">
        <Alert variant="error" title="Заказ не найден" description={`ID: ${id}`} />
      </div>
    )
  }

  return (
    <div className="page-container pb-32">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
        >
          <ArrowLeft size={16} className="text-slate-600" />
        </button>
        <div>
          <h1 className="text-xl font-black text-slate-900">Редактировать заказ</h1>
          <p className="text-xs text-slate-400 mt-0.5 font-mono">
            {order.order_number ?? id}
          </p>
        </div>
      </div>

      {/* Terminal status warning */}
      {isTerminal && (
        <Alert variant="error" title="Нельзя редактировать">
          {order.status === 'in_delivery'
            ? 'Этот заказ уже находится в доставке и больше не может быть изменён.'
            : `Этот заказ больше нельзя редактировать — статус: ${order.status}`}
        </Alert>
      )}

      {!form ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">

          {/* ── 1. Customer (read-only) ── */}
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold">1</span>
              Клиент
            </h3>
            <div
              className="rounded-xl px-4 py-3 space-y-1"
              style={{ background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.7)' }}
            >
              <p className="text-sm font-semibold text-slate-800">{form.fullName || '—'}</p>
              <p className="text-xs text-slate-400">{form.phone || '—'}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="input-label">Город доставки</label>
                <select
                  value={form.cityId}
                  onChange={(e) => {
                    const cid = e.target.value
                    const name = cities.find((c) => c.id === cid)?.name ?? ''
                    setForm((p) => ({ ...p, cityId: cid, city: name }))
                  }}
                  className="input"
                  disabled={isTerminal}
                >
                  <option value="">Выберите город</option>
                  {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="input-label">Адрес</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setField('address', e.target.value)}
                  placeholder="ул. Рудаки, 12"
                  className="input"
                  disabled={isTerminal}
                />
              </div>
            </div>
          </div>

          {/* ── 2. Products ── */}
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold">2</span>
              Товары
              {cartItems.length > 0 && (
                <span className="ml-auto text-[10px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                  {cartItems.length} поз.
                </span>
              )}
            </h3>
            {!isTerminal && (
              <ProductSearch products={products} loading={prodLoading} onAdd={addToCart} />
            )}
            {cartItems.length > 0 && (
              <div className="border border-slate-100 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Корзина</span>
                </div>
                <div className="px-3 divide-y divide-slate-50">
                  {cartItems.map((item, idx) => (
                    <CartItemRow
                      key={item.product_id + '-' + idx}
                      item={item}
                      onChange={isTerminal ? undefined : (updated) => updateCartItem(idx, updated)}
                      onRemove={isTerminal ? undefined : () => removeCartItem(idx)}
                      readOnly={isTerminal}
                    />
                  ))}
                </div>
              </div>
            )}
            {cartItems.length === 0 && (
              <div className="flex items-center gap-2 px-3 py-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl">
                <ShoppingCart size={14} className="text-slate-300 flex-shrink-0" />
                <p className="text-xs text-slate-400">Выберите товары из списка выше</p>
              </div>
            )}
          </div>

          {/* ── 3. Delivery ── */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-4">
              <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold">3</span>
              Доставка
            </h3>
            <DeliveryModeSelector
              mode={form.deliveryMode}
              onChange={(v) => setField('deliveryMode', v)}
              fastFee={fastFee}
              normalFee={normalFee}
              disabled={isTerminal}
            />
          </div>

          {/* ── Comment ── */}
          <div className="card p-5 space-y-2">
            <label className="input-label">Комментарий</label>
            <textarea
              value={form.comment}
              onChange={(e) => setField('comment', e.target.value)}
              rows={2}
              placeholder="Особые пожелания…"
              className="input resize-none"
              disabled={isTerminal}
            />
          </div>

          {/* ── Add prepayment — available any time after creation, as long as
              the order hasn't reached a terminal status (mirrors backend's
              AddPrepayment/IsTerminal check: delivered/returned/cancelled) ── */}
          {!['delivered', 'returned', 'cancelled'].includes(order.status) && (
            <AddPrepaymentCard
              orderId={id}
              prepaymentAmount={order.prepayment_amount ?? order.PrepaymentAmount ?? 0}
              prepaymentStatus={order.prepayment_status ?? order.PrepaymentStatus}
              onAdded={() => {
                refetchOrder()
                qc.invalidateQueries({ queryKey: KEYS.seller.orders })
                qc.invalidateQueries({ queryKey: ['orders', 'list'] })
              }}
            />
          )}

          {cartItems.length > 0 && (
            <CartTotalsBreakdown
              items={cartItems}
              productTotal={productTotal}
              deliveryFee={deliveryFee}
              prepaymentAmount={order?.prepayment_amount ?? order?.PrepaymentAmount ?? 0}
              totalPayment={totalAmount}
            />
          )}

          {submitError && (
            <Alert variant="error" title="Ошибка">{submitError}</Alert>
          )}

          {/* ── Save — flows at the end of the page, right after the totals ── */}
          <div
            style={{
              background: '#fff', border: '1px solid #E7E5DE',
              borderRadius: 20, padding: '14px 18px 16px', marginTop: 14,
              boxShadow: '0 -8px 24px rgba(20,20,20,.05), 0 10px 28px rgba(20,20,20,.10)',
            }}
          >
            <button
              type="button"
              onClick={() => submitMut.mutate()}
              disabled={!canSubmit || submitMut.isPending}
              className="w-full flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg,#6366F1,#4F46E5)', color: '#fff', border: 'none',
                fontFamily: 'inherit', fontSize: 15, fontWeight: 700, padding: 15, borderRadius: 14,
                cursor: 'pointer', boxShadow: '0 8px 20px rgba(99,102,241,.38)',
              }}
            >
              {submitMut.isPending ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Сохраняем…
                </>
              ) : (
                <>
                  <Check size={18} />
                  Сохранить изменения
                </>
              )}
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
