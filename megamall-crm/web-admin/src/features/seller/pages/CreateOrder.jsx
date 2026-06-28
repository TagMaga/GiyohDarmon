import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShoppingCart, Search, X, Package, AlertCircle } from 'lucide-react'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import { createOrder, createCustomer } from '../api'
import client from '../../../shared/api/client'
import useCustomers from '../hooks/useCustomers'
import useProducts from '../hooks/useProducts'
import useWarehouses from '../hooks/useWarehouses'
import useDeliverySettings from '../hooks/useDeliverySettings'
import useCities from '../hooks/useCities'
import PhoneSearchField from '../components/PhoneSearchField'
import CartItemRow from '../components/CartItemRow'
import CartTotalsBreakdown from '../components/CartTotalsBreakdown'
import DeliveryModeSelector from '../components/DeliveryModeSelector'
import PaymentModeSelector from '../components/PaymentModeSelector'
import OrderSuccessScreen from '../components/OrderSuccessScreen'
import PageHeader from '../../../shared/components/PageHeader'
import Alert from '../../../shared/components/Alert'
import { fmtAmount } from '../../../shared/orderStatusConfig'

// ── Draft ──────────────────────────────────────────────────────────────────────
const DRAFT_KEY = 'seller_create_order_draft_v2'

function normalizeDraft(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    phone:           typeof raw.phone === 'string'           ? raw.phone           : '',
    customerId:      raw.customerId ?? null,
    fullName:        typeof raw.fullName === 'string'        ? raw.fullName        : '',
    city:            typeof raw.city === 'string'            ? raw.city            : '',
    cityId:          typeof raw.cityId === 'string'          ? raw.cityId          : '',
    address:         typeof raw.address === 'string'         ? raw.address         : '',
    cartItems:       Array.isArray(raw.cartItems)            ? raw.cartItems       : [],
    deliveryMode:    raw.deliveryMode === 'fast' || raw.deliveryMode === 'express' ? 'fast' : 'normal',
    payMode:         typeof raw.payMode === 'string'         ? raw.payMode         : 'cod',
    prepayAmount:    raw.prepayAmount ?? '',
    prepayReceiver:  typeof raw.prepayReceiver === 'string'  ? raw.prepayReceiver  : '',
    prepayChatUrl:   typeof raw.prepayChatUrl === 'string'   ? raw.prepayChatUrl   : '',
    comment:         typeof raw.comment === 'string'         ? raw.comment         : '',
  }
}

const loadDraft = () => {
  try { const r = localStorage.getItem(DRAFT_KEY); return r ? normalizeDraft(JSON.parse(r)) : null } catch { return null }
}
const saveDraft = (f) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(f)) } catch {} }
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY) } catch {} }

const EMPTY_FORM = {
  phone: '', customerId: null, fullName: '', city: '', cityId: '', address: '',
  cartItems: [],
  deliveryMode: 'normal',
  payMode: 'cod',
  prepayAmount: '', prepayReceiver: '', prepayChatUrl: '', comment: '',
}

// ── Product search ─────────────────────────────────────────────────────────────
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto scrollbar-none">
          {filtered.map((p) => (
            <button key={p.id} type="button" onClick={() => { onAdd(p); setQ('') }}
              className="text-left rounded-xl border border-slate-200 hover:border-indigo-300
                         hover:bg-indigo-50 active:scale-[0.97] transition-all group overflow-hidden">
              {getProductImageUrl(p) ? (
                <img src={getProductImageUrl(p)} alt={p.name}
                  className="w-full h-24 object-cover" />
              ) : (
                <div className="w-full h-24 bg-slate-100 group-hover:bg-indigo-50 flex items-center justify-center transition-colors">
                  <Package size={22} className="text-slate-300 group-hover:text-indigo-400" />
                </div>
              )}
              <div className="p-2">
                <p className="text-[11px] font-semibold text-slate-800 leading-tight line-clamp-2">{p.name}</p>
                {(p.sale_price ?? p.base_price) != null && (
                  <p className="text-[11px] font-bold text-indigo-600 mt-0.5">
                    {fmtAmount(p.sale_price ?? p.base_price)} с
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Shared helpers ─────────────────────────────────────────────────────────────
export function calcProductTotal(items) {
  return items.reduce((acc, it) => acc + Math.max(0, Number(it.total_price) || 0), 0)
}
export function calcPayloadUnitPrice(item) {
  const quantity = Number(item.quantity) || 0
  if (quantity <= 0) return 0
  const fallbackTotal = (Number(item.unit_price) || 0) * quantity
  const lineTotal = Number.isFinite(Number(item.total_price)) ? Number(item.total_price) : fallbackTotal
  return Math.max(0, lineTotal) / quantity
}
export function calcTotalOrderAmount(productTotal, deliveryFee) {
  return productTotal + deliveryFee
}
export function calcAmountToCollect(productTotal, deliveryFee, prepaymentAmount) {
  return Math.max(0, productTotal + deliveryFee - prepaymentAmount)
}
export function getProductImageUrl(product) {
  if (!product) return ''
  const images = Array.isArray(product.images) ? product.images : (Array.isArray(product.Images) ? product.Images : [])
  const primary = images.find((img) => img.is_primary ?? img.IsPrimary) ?? images[0]
  return product.product_image_url ?? product.ProductImageURL ?? product.image_url ?? product.ImageURL ?? primary?.image_url ?? primary?.ImageURL ?? ''
}
export function getPaymentLabel(prepaymentAmount, totalOrderAmount) {
  if (prepaymentAmount <= 0) return 'Оплата при получении'
  if (prepaymentAmount >= totalOrderAmount) return 'Полная предоплата'
  return 'Частичная предоплата'
}
export function formatDeliveryFee(fee) {
  return fee <= 0 ? 'Бесплатно' : `${fee.toLocaleString('ru-RU')} с`
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function CreateOrder() {
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [form, setForm] = useState(() => loadDraft() ?? EMPTY_FORM)
  const [success, setSuccess] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [proofFile, setProofFile] = useState(null)
  const uploadedProofUrl = useRef(null)

  const handleProofFileChange = useCallback((file) => {
    setProofFile(file)
    uploadedProofUrl.current = null  // clear cache when file changes
  }, [])

  const { data: customersRaw = [] } = useCustomers()
  const { data: productsRaw = [], isLoading: prodLoading } = useProducts()
  const { data: warehousesRaw = [], isLoading: whLoading, error: whError } = useWarehouses()
  const { data: deliverySettings } = useDeliverySettings()
  const { data: cities = [] } = useCities()

  const customers  = Array.isArray(customersRaw)  ? customersRaw  : []
  const products   = Array.isArray(productsRaw)   ? productsRaw   : []
  const warehouses = Array.isArray(warehousesRaw) ? warehousesRaw : []

  const globalNormalFee = deliverySettings?.normal_fee ?? 0
  const globalFastFee   = deliverySettings?.fast_fee   ?? 0

  const autoWarehouse = useMemo(
    () => warehouses.find((w) => w.is_active === true) ?? warehouses[0] ?? null,
    [warehouses]
  )

  useEffect(() => { saveDraft(form) }, [form])
  useEffect(() => {
    if (submitError) {
      document.getElementById('submit-error-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [submitError])
  const setField = useCallback((key, val) => setForm((p) => ({ ...p, [key]: val })), [])

  const safeCart = (prev) => (Array.isArray(prev.cartItems) ? prev.cartItems : [])

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

  const handleSelectCustomer = (c) => {
    setForm((prev) => ({
      ...prev, customerId: c.id, fullName: c.full_name ?? '',
      phone: c.phone ?? prev.phone, city: c.city ?? '', address: c.address ?? '',
    }))
  }

  // ── Calculations ─────────────────────────────────────────────────────────────
  const cartItems = Array.isArray(form.cartItems) ? form.cartItems : []
  useEffect(() => {
    if (products.length === 0 || cartItems.length === 0) return
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
  }, [products, cartItems.length])
  const firstProductId    = cartItems[0]?.product_id ?? null
  const cartItems0Product = useMemo(
    () => firstProductId ? products.find((p) => p.id === firstProductId) ?? null : null,
    [firstProductId, products]
  )
  const normalFee   = cartItems0Product?.normal_delivery_fee  ?? cartItems0Product?.NormalDeliveryFee  ?? globalNormalFee
  const fastFee     = cartItems0Product?.express_delivery_fee ?? cartItems0Product?.ExpressDeliveryFee ?? globalFastFee
  const deliveryFee = form.deliveryMode === 'fast' ? fastFee : normalFee

  const productTotal    = useMemo(() => calcProductTotal(cartItems), [cartItems])
  const totalOrderAmount = useMemo(() => calcTotalOrderAmount(productTotal, deliveryFee), [productTotal, deliveryFee])
  const prepayAmt        = form.payMode === 'prepayment' ? Number(form.prepayAmount) || 0 : 0
  const amountToCollect  = useMemo(() => calcAmountToCollect(productTotal, deliveryFee, prepayAmt), [productTotal, deliveryFee, prepayAmt])
  const paymentLabel     = useMemo(() => getPaymentLabel(prepayAmt, totalOrderAmount), [prepayAmt, totalOrderAmount])

  // ── Submit ───────────────────────────────────────────────────────────────────
  const submitMut = useMutation({
    onMutate: () => { setSubmitError(null) },
    mutationFn: async () => {
      if (!autoWarehouse) throw new Error('Склад не найден. Обратитесь к администратору.')

      let cid = form.customerId
      if (!cid) {
        const newCust = await createCustomer({
          full_name: form.fullName.trim(),
          phone: form.phone.trim(),
          city: form.city || undefined,
          address: form.address.trim() || undefined,
          source: 'phone',
        })
        cid = newCust.id
      }

      // Upload proof file if attached — reuse cached URL on retry
      let proofUrl = undefined
      if (proofFile && form.payMode === 'prepayment') {
        if (!uploadedProofUrl.current) {
          const fd = new FormData()
          fd.append('file', proofFile)
          const uploadRes = await client.post('/uploads', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          uploadedProofUrl.current = uploadRes.data?.data?.url ?? uploadRes.data?.url
        }
        proofUrl = uploadedProofUrl.current
      }

      const noteParts = []
      if (form.comment.trim()) noteParts.push(form.comment.trim())
      const notes = noteParts.length > 0 ? noteParts.join(' | ') : undefined

      const prepayRequired = form.payMode === 'prepayment'

      const order = await createOrder({
        customer_id:   cid,
        warehouse_id:  autoWarehouse.id,
        city_id:       form.cityId,
        order_type:    'seller_order',
        delivery_method: form.deliveryMode,
        items: cartItems.map((it) => ({
          product_id: it.product_id,
          quantity:   it.quantity,
          unit_price: calcPayloadUnitPrice(it),
        })),
        city:             form.city || undefined,
        delivery_address: form.address.trim() || undefined,
        notes:            notes ?? null,
        prepayment_required: prepayRequired,
        prepayment_amount:   prepayRequired ? prepayAmt : 0,
        prepayment_receiver: prepayRequired && form.prepayReceiver ? form.prepayReceiver : undefined,
        prepayment_comment:  prepayRequired && form.comment.trim() ? form.comment.trim() : undefined,
        payment_proof_url:   proofUrl ?? undefined,
        customer_chat_url:   prepayRequired && form.prepayChatUrl ? form.prepayChatUrl : undefined,
      })

      return { order }
    },
    onSuccess: ({ order }) => {
      clearDraft()
      setProofFile(null)
      uploadedProofUrl.current = null
      qc.invalidateQueries({ queryKey: KEYS.seller.orders })
      setSuccess({
        order,
        cartItems,
        productTotal,
        deliveryFee,
        totalOrderAmount,
        prepayAmt,
        paymentLabel,
        amountToCollect,
        deliveryMode: form.deliveryMode,
        payMode: form.payMode,
        fullName: form.fullName,
        phone: form.phone,
        city: form.city,
        address: form.address,
      })
    },
    onError: (err) => {
      let msg = err?.response?.data?.error?.message ?? err?.response?.data?.error ?? err?.message ?? 'Ошибка создания заказа'
      if (typeof msg === 'string') {
        msg = msg.replace(
          /insufficient stock for product ([0-9a-f-]{36}): available (\d+), needed (\d+)/i,
          (_, id, avail, needed) => {
            const name = products.find((p) => p.id === id)?.name ?? id
            return avail === '0'
              ? `Товар «${name}» закончился на складе`
              : `Недостаточно товара «${name}»: есть ${avail}, нужно ${needed}`
          }
        )
      }
      setSubmitError(msg)
    },
  })

  const handleCreateAnother = () => {
    setSuccess(null)
    setForm(EMPTY_FORM)
    setProofFile(null)
    uploadedProofUrl.current = null
    clearDraft()
  }

  const handleClear = () => {
    setForm(EMPTY_FORM)
    setProofFile(null)
    setSubmitError(null)
    uploadedProofUrl.current = null
    clearDraft()
    navigate('/seller')
  }

  // ── Validation ───────────────────────────────────────────────────────────────
  const canSubmit = (() => {
    if (!form.phone.trim()) return false
    if (!form.fullName.trim()) return false
    if (cartItems.length === 0) return false
    if (cartItems.some((i) => calcPayloadUnitPrice(i) <= 0)) return false
    if (form.payMode === 'prepayment') {
      if (prepayAmt <= 0) return false
      if (prepayAmt > totalOrderAmount) return false
    }
    return true
  })()

  if (success) {
    return (
      <div className="page-container">
        <OrderSuccessScreen
          order={success.order}
          cartItems={success.cartItems}
          subtotal={success.productTotal}
          deliveryExtra={success.deliveryFee}
          deliveryMode={success.deliveryMode}
          displayTotal={success.totalOrderAmount}
          prepayAmount={success.prepayAmt}
          payMode={success.payMode}
          prepayWarning={false}
          fullName={success.fullName}
          phone={success.phone}
          city={success.city}
          address={success.address}
          onCreateAnother={handleCreateAnother}
        />
      </div>
    )
  }

  const noWarehouse = !whLoading && !autoWarehouse

  return (
    <div className="page-container pb-8">
      <PageHeader title="Новый заказ" subtitle="Быстрое оформление" />

      {whError && (
        <Alert variant="error" title="Ошибка загрузки склада"
          description={whError?.response?.data?.error ?? whError?.message ?? String(whError)} />
      )}
      {noWarehouse && !whError && (
        <Alert variant="error" title="Склад не найден"
          description="Обратитесь к администратору — активный склад не настроен." />
      )}

      <div className="max-w-xl mx-auto space-y-5">

        {/* ── 1. Customer ── */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold">1</span>
            Клиент
          </h3>
          <PhoneSearchField
            phone={form.phone}
            onChange={(v) => setField('phone', v)}
            customers={customers}
            selectedId={form.customerId}
            onSelect={handleSelectCustomer}
            onClearSelection={() => setField('customerId', null)}
          />
          <div className="space-y-2">
            <label className="input-label">Имя клиента *</label>
            <input type="text" value={form.fullName} onChange={(e) => setField('fullName', e.target.value)}
              placeholder="Фамилия Имя" className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="input-label">Город доставки</label>
              <select
                value={form.cityId}
                onChange={(e) => {
                  const id = e.target.value
                  const name = cities.find((c) => c.id === id)?.name ?? ''
                  setForm((p) => ({ ...p, cityId: id, city: name }))
                }}
                className="input"
              >
                <option value="">Выберите город</option>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="input-label">Адрес</label>
              <input type="text" value={form.address} onChange={(e) => setField('address', e.target.value)}
                placeholder="ул. Рудаки, 12" className="input" />
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
          <ProductSearch products={products} loading={prodLoading} onAdd={addToCart} />
          {cartItems.length > 0 && (
            <div className="border border-slate-100 rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Корзина</span>
              </div>
              <div className="px-3 divide-y divide-slate-50">
                {cartItems.map((item, idx) => (
                  <CartItemRow key={item.product_id} item={item}
                    onChange={(updated) => updateCartItem(idx, updated)}
                    onRemove={() => removeCartItem(idx)} />
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
          />
        </div>

        {/* ── 4. Payment ── */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-4">
            <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold">4</span>
            Оплата
          </h3>
          <PaymentModeSelector
            mode={form.payMode}
            onChange={(v) => setField('payMode', v)}
            prepayAmount={form.prepayAmount}
            onPrepayChange={(v) => setField('prepayAmount', v)}
            prepayReceiver={form.prepayReceiver}
            onReceiverChange={(v) => setField('prepayReceiver', v)}
            totalOrderAmount={totalOrderAmount}
            onFileChange={handleProofFileChange}
            proofFile={proofFile}
            chatUrl={form.prepayChatUrl}
            onChatUrlChange={(v) => setField('prepayChatUrl', v)}
          />
        </div>

        {/* ── Comment ── */}
        <div className="card p-5 space-y-2">
          <label className="input-label">Комментарий</label>
          <textarea value={form.comment} onChange={(e) => setField('comment', e.target.value)}
            rows={2} placeholder="Особые пожелания…" className="input resize-none" />
        </div>

        {cartItems.length > 0 && (
          <CartTotalsBreakdown
            items={cartItems}
            productTotal={productTotal}
            deliveryFee={deliveryFee}
            prepaymentAmount={prepayAmt}
            totalPayment={totalOrderAmount}
            amountToCollect={amountToCollect}
          />
        )}

        {submitError && (
          <div id="submit-error-anchor">
            <Alert variant="error" title="Ошибка">{submitError}</Alert>
          </div>
        )}

        <div>
          {!canSubmit && cartItems.length === 0 && (
            <p className="text-[10px] text-slate-400 mb-1 flex items-center gap-1">
              <AlertCircle size={10} /> Добавьте хотя бы один товар
            </p>
          )}
          {!canSubmit && cartItems.length > 0 && form.payMode === 'prepayment' && prepayAmt > totalOrderAmount && (
            <p className="text-[10px] text-rose-500 mb-1 flex items-center gap-1">
              <AlertCircle size={10} /> Предоплата не может быть больше итога заказа
            </p>
          )}
          <div className="flex gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="btn btn-md flex items-center justify-center gap-2 border border-slate-300 text-slate-600 bg-white hover:bg-slate-50"
          >
            <X size={16} />
            Отмена
          </button>
          <button
            type="button"
            onClick={() => submitMut.mutate()}
            disabled={!canSubmit || submitMut.isPending || noWarehouse}
            className="btn btn-primary btn-md flex-1 flex items-center justify-center gap-2
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitMut.isPending ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Оформляем…
              </>
            ) : (
              <>
                <ShoppingCart size={16} />
                Оформить заказ
              </>
            )}
          </button>
          </div>
        </div>
      </div>
    </div>
  )
}
