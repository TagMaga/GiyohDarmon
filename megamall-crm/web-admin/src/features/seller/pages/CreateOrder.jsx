import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShoppingCart, Search, X, Package, AlertCircle } from 'lucide-react'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import { createOrder, createCustomer } from '../api'
import client from '../../../shared/api/client'
import useProfile from '../../../shared/hooks/useProfile'
import useCustomers from '../hooks/useCustomers'
import useProducts from '../hooks/useProducts'
import useDeliverySettings from '../hooks/useDeliverySettings'
import useCities from '../hooks/useCities'
import PhoneSearchField from '../components/PhoneSearchField'
import CartItemRow from '../components/CartItemRow'
import CartTotalsBreakdown from '../components/CartTotalsBreakdown'
import DeliveryModeSelector from '../components/DeliveryModeSelector'
import PaymentModeSelector from '../components/PaymentModeSelector'
import OrderSuccessScreen from '../components/OrderSuccessScreen'
import Alert from '../../../shared/components/Alert'
import { fmtAmount } from '../../../shared/orderStatusConfig'
import { M } from '../components/mobileUi'

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
  prepayAmount: '', prepayReceiver: '', comment: '',
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
                  className="w-full aspect-square object-cover" />
              ) : (
                <div className="w-full aspect-square bg-slate-100 group-hover:bg-indigo-50 flex items-center justify-center transition-colors">
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
  const direct = product.product_image_url ?? product.ProductImageURL ?? product.image_url ?? product.ImageURL ?? product.image ?? product.Image
  if (direct) return direct
  const images = Array.isArray(product.images) ? product.images : (Array.isArray(product.Images) ? product.Images : [])
  const primary = images.find((img) => img.is_primary ?? img.IsPrimary) ?? images[0]
  return primary?.image_url ?? primary?.ImageURL ?? primary?.url ?? primary?.URL ?? ''
}
export function getPaymentLabel(prepaymentAmount, totalOrderAmount) {
  if (prepaymentAmount <= 0) return 'Оплата при получении'
  if (prepaymentAmount >= totalOrderAmount) return 'Полная предоплата'
  return 'Частичная предоплата'
}
export function formatDeliveryFee(fee) {
  return fee <= 0 ? 'Бесплатно' : `${fee.toLocaleString('ru-RU')} с`
}

const ORDER_TYPE_BY_ROLE = {
  manager: 'manager_personal_order',
  sales_team_lead: 'team_lead_personal_order',
  seller: 'seller_order',
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function CreateOrder() {
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { role } = useProfile()
  const orderType = ORDER_TYPE_BY_ROLE[role] ?? 'seller_order'

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
  const { data: deliverySettings } = useDeliverySettings()
  const { data: cities = [] } = useCities()

  const customers  = Array.isArray(customersRaw)  ? customersRaw  : []
  const products   = Array.isArray(productsRaw)   ? productsRaw   : []

  const globalNormalFee = deliverySettings?.normal_fee ?? 0
  const globalFastFee   = deliverySettings?.fast_fee   ?? 0

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
        city_id:       form.cityId,
        order_type:    orderType,
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
    if (!form.cityId) return false
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

  return (
    <>
    {/* ═══════════════════════════════════════════════════════════
        MOBILE LAYOUT — Seller Panel Redesign
    ═══════════════════════════════════════════════════════════ */}
    <div
      className="lg:hidden pb-8 min-h-screen"
      style={{
        background: M.bg,
        fontFamily: M.font,
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        paddingLeft: 16, paddingRight: 16,
        paddingBottom: '8rem',
      }}
    >
      <div className="max-w-xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3" style={{ padding: '8px 0 4px' }}>
          <div className="flex-1 min-w-0">
            <h1 style={{ fontSize: 20, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', margin: 0 }}>Новый заказ</h1>
            <div style={{ fontSize: 12, color: M.muted, fontWeight: 500, marginTop: 2 }}>Быстрое оформление</div>
          </div>
        </div>

        <div className="space-y-3">

        {/* ── 1. Customer ── */}
        <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 18, padding: 16, boxShadow: '0 2px 10px rgba(99,102,241,.07)' }} className="space-y-4">
          <div className="flex items-center gap-[9px]">
            <span className="flex items-center justify-center" style={{ width: 24, height: 24, borderRadius: 8, background: M.indigo, color: '#fff', fontSize: 12, fontWeight: 800 }}>1</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>Клиент</span>
            {form.customerId && (
              <span className="ml-auto inline-flex items-center gap-[5px]" style={{ fontSize: 11, fontWeight: 700, color: M.green, background: M.greenBg, padding: '3px 8px', borderRadius: 7 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2"><path d="M20 6 9 17l-5-5" /></svg>
                Найден
              </span>
            )}
          </div>
          <PhoneSearchField
            phone={form.phone}
            onChange={(v) => setField('phone', v)}
            customers={customers}
            selectedId={form.customerId}
            onSelect={handleSelectCustomer}
            onClearSelection={() => setField('customerId', null)}
          />
          <div className="space-y-2">
            <label className="input-label">Имя клиента</label>
            <input type="text" value={form.fullName} onChange={(e) => setField('fullName', e.target.value)}
              placeholder="Фамилия Имя" className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="input-label">Город доставки *</label>
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
        <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 18, padding: 16, boxShadow: '0 2px 10px rgba(139,92,246,.07)' }} className="space-y-4">
          <div className="flex items-center gap-[9px]">
            <span className="flex items-center justify-center" style={{ width: 24, height: 24, borderRadius: 8, background: '#8B5CF6', color: '#fff', fontSize: 12, fontWeight: 800 }}>2</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>Товары</span>
            {cartItems.length > 0 && (
              <span className="ml-auto" style={{ fontSize: 11, fontWeight: 700, color: M.indigoDeep, background: M.indigoBg, padding: '3px 9px', borderRadius: 7 }}>
                {cartItems.length} поз.
              </span>
            )}
          </div>
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
        <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 18, padding: 16, boxShadow: '0 2px 10px rgba(16,185,129,.07)' }}>
          <div className="flex items-center gap-[9px] mb-[13px]">
            <span className="flex items-center justify-center" style={{ width: 24, height: 24, borderRadius: 8, background: '#10B981', color: '#fff', fontSize: 12, fontWeight: 800 }}>3</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>Доставка</span>
          </div>
          <DeliveryModeSelector
            mode={form.deliveryMode}
            onChange={(v) => setField('deliveryMode', v)}
            fastFee={fastFee}
            normalFee={normalFee}
          />
        </div>

        {/* ── 4. Payment ── */}
        <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 18, padding: 16, boxShadow: '0 2px 10px rgba(245,158,11,.07)' }}>
          <div className="flex items-center gap-[9px] mb-[13px]">
            <span className="flex items-center justify-center" style={{ width: 24, height: 24, borderRadius: 8, background: '#F59E0B', color: '#fff', fontSize: 12, fontWeight: 800 }}>4</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>Оплата</span>
          </div>
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
          />
        </div>

        {/* ── Comment ── */}
        <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 18, padding: 16 }} className="space-y-2">
          <label style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>Комментарий</label>
          <textarea value={form.comment} onChange={(e) => setField('comment', e.target.value)}
            rows={2} placeholder="Особые пожелания…" className="w-full resize-none outline-none"
            style={{ border: `1px solid ${M.borderAlt}`, borderRadius: 13, padding: '11px 14px', fontFamily: 'inherit', fontSize: 13.5, color: M.ink, background: '#fff' }} />
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
        </div>

        {/* ── Total + CTA — flows at the end of the page, right after the comment card ── */}
        <div
          style={{
            background: '#fff', border: `1px solid ${M.border}`,
            borderRadius: 20, padding: '14px 18px 16px', marginTop: 14,
            boxShadow: '0 -8px 24px rgba(20,20,20,.05), 0 10px 28px rgba(20,20,20,.10)',
          }}
        >
          <div className="flex items-center justify-between" style={{ paddingBottom: 8, marginBottom: 8, borderBottom: `1px solid ${M.bg}` }}>
            <span style={{ fontSize: 12, color: M.sub, fontWeight: 600 }}>Товары · Доставка</span>
            <span style={{ fontSize: 12, color: '#76766E', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {fmtAmount(productTotal)} с · {formatDeliveryFee(deliveryFee)}
            </span>
          </div>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, color: M.sub, fontWeight: 600 }}>
              {prepayAmt > 0 ? 'К сбору при получении' : 'К оплате'}
            </span>
            <span style={{ fontSize: 26, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', fontVariantNumeric: 'tabular-nums' }}>
              {fmtAmount(prepayAmt > 0 ? amountToCollect : totalOrderAmount)} с
            </span>
          </div>
          {!canSubmit && cartItems.length === 0 && (
            <p className="flex items-center gap-1" style={{ fontSize: 11, color: M.muted, marginBottom: 8 }}>
              <AlertCircle size={11} /> Добавьте хотя бы один товар
            </p>
          )}
          {!canSubmit && cartItems.length > 0 && form.payMode === 'prepayment' && prepayAmt > totalOrderAmount && (
            <p className="flex items-center gap-1" style={{ fontSize: 11, color: '#BE123C', marginBottom: 8 }}>
              <AlertCircle size={11} /> Предоплата не может быть больше итога заказа
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center justify-center active:scale-95 transition-transform"
              style={{ width: 52, borderRadius: 14, background: '#fff', border: `1px solid ${M.borderAlt}`, color: '#76766E', cursor: 'pointer' }}
            >
              <X size={17} />
            </button>
            <button
              type="button"
              onClick={() => submitMut.mutate()}
              disabled={!canSubmit || submitMut.isPending}
              className="flex-1 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg,#6366F1,#4F46E5)', color: '#fff', border: 'none',
                fontFamily: 'inherit', fontSize: 15, fontWeight: 700, padding: 15, borderRadius: 14,
                cursor: 'pointer', boxShadow: '0 8px 20px rgba(99,102,241,.38)',
              }}
            >
              {submitMut.isPending ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Оформляем…
                </>
              ) : (
                <>
                  <ShoppingCart size={18} />
                  Оформить заказ
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* ═══════════════════════════════════════════════════════════
        DESKTOP LAYOUT — Seller Panel Redesign
    ═══════════════════════════════════════════════════════════ */}
    <div className="hidden lg:flex flex-col gap-5" style={{ padding: '36px 44px', minHeight: '100vh', background: M.bg, fontFamily: M.font }}>
      <div className="flex items-center gap-2">
        <h1 style={{ fontSize: 28, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', margin: 0 }}>Новый заказ</h1>
      </div>

      <div className="grid gap-[22px] flex-1 min-h-0" style={{ gridTemplateColumns: '1fr 400px' }}>
        {/* ── Left column: client + products ── */}
        <div className="overflow-y-auto flex flex-col gap-4">
          <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 18, padding: '20px 22px', boxShadow: '0 2px 10px rgba(99,102,241,.07)' }} className="space-y-4 flex-shrink-0">
            <div className="flex items-center gap-[9px]">
              <span className="flex items-center justify-center" style={{ width: 26, height: 26, borderRadius: 8, background: M.indigo, color: '#fff', fontSize: 13, fontWeight: 800 }}>1</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: M.ink }}>Клиент</span>
              {form.customerId && (
                <span className="ml-auto inline-flex items-center gap-[5px]" style={{ fontSize: 11.5, fontWeight: 700, color: M.green, background: M.greenBg, padding: '4px 9px', borderRadius: 7 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2"><path d="M20 6 9 17l-5-5" /></svg>
                  Найден
                </span>
              )}
            </div>
            <PhoneSearchField
              phone={form.phone}
              onChange={(v) => setField('phone', v)}
              customers={customers}
              selectedId={form.customerId}
              onSelect={handleSelectCustomer}
              onClearSelection={() => setField('customerId', null)}
            />
            <div className="space-y-2">
              <label className="input-label">Имя клиента</label>
              <input type="text" value={form.fullName} onChange={(e) => setField('fullName', e.target.value)}
                placeholder="Фамилия Имя" className="input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="input-label">Город доставки *</label>
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

          <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 18, padding: '20px 22px', boxShadow: '0 2px 10px rgba(139,92,246,.07)' }} className="space-y-4 flex-1">
            <div className="flex items-center gap-[9px]">
              <span className="flex items-center justify-center" style={{ width: 26, height: 26, borderRadius: 8, background: '#8B5CF6', color: '#fff', fontSize: 13, fontWeight: 800 }}>2</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: M.ink }}>Товары</span>
              {cartItems.length > 0 && (
                <span className="ml-auto" style={{ fontSize: 11.5, fontWeight: 700, color: M.indigoDeep, background: M.indigoBg, padding: '4px 10px', borderRadius: 7 }}>
                  {cartItems.length} поз.
                </span>
              )}
            </div>
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
        </div>

        {/* ── Right column: delivery + payment + sticky summary ── */}
        <div className="overflow-y-auto flex flex-col gap-4">
          <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 18, padding: '20px 22px', boxShadow: '0 2px 10px rgba(16,185,129,.07)' }} className="flex-shrink-0">
            <div className="flex items-center gap-[9px] mb-[15px]">
              <span className="flex items-center justify-center" style={{ width: 26, height: 26, borderRadius: 8, background: '#10B981', color: '#fff', fontSize: 13, fontWeight: 800 }}>3</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: M.ink }}>Доставка</span>
            </div>
            <div className="flex flex-col gap-[10px]">
              <DeliveryModeSelector
                mode={form.deliveryMode}
                onChange={(v) => setField('deliveryMode', v)}
                fastFee={fastFee}
                normalFee={normalFee}
              />
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 18, padding: '20px 22px', boxShadow: '0 2px 10px rgba(245,158,11,.07)' }} className="flex-shrink-0">
            <div className="flex items-center gap-[9px] mb-[15px]">
              <span className="flex items-center justify-center" style={{ width: 26, height: 26, borderRadius: 8, background: '#F59E0B', color: '#fff', fontSize: 13, fontWeight: 800 }}>4</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: M.ink }}>Оплата</span>
            </div>
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
            />
          </div>

          <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 18, padding: '20px 22px' }} className="space-y-2 flex-shrink-0">
            <label style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>Комментарий</label>
            <textarea value={form.comment} onChange={(e) => setField('comment', e.target.value)}
              rows={2} placeholder="Особые пожелания…" className="w-full resize-none outline-none"
              style={{ border: `1px solid ${M.borderAlt}`, borderRadius: 13, padding: '11px 14px', fontFamily: 'inherit', fontSize: 13.5, color: M.ink, background: '#fff' }} />
          </div>

          {cartItems.length > 0 && (
            <div className="flex-shrink-0">
              <CartTotalsBreakdown
                items={cartItems}
                productTotal={productTotal}
                deliveryFee={deliveryFee}
                prepaymentAmount={prepayAmt}
                totalPayment={totalOrderAmount}
                amountToCollect={amountToCollect}
              />
            </div>
          )}

          {submitError && (
            <div className="flex-shrink-0">
              <Alert variant="error" title="Ошибка">{submitError}</Alert>
            </div>
          )}

          {/* Summary + CTA */}
          <div style={{ background: '#fff', border: `1px solid ${M.border}`, borderRadius: 18, padding: '20px 22px', boxShadow: '0 4px 16px rgba(20,20,20,.06)' }} className="flex-shrink-0">
            <div className="flex items-center justify-between" style={{ paddingBottom: 10, marginBottom: 10, borderBottom: `1px solid ${M.bg}` }}>
              <span style={{ fontSize: 13, color: M.sub, fontWeight: 600 }}>Товары · Доставка</span>
              <span style={{ fontSize: 13, color: '#76766E', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {fmtAmount(productTotal)} с · {formatDeliveryFee(deliveryFee)}
              </span>
            </div>
            <div className="flex items-baseline justify-between" style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: M.sub, fontWeight: 600 }}>
                {prepayAmt > 0 ? 'К сбору при получении' : 'К оплате'}
              </span>
              <span style={{ fontSize: 28, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', fontVariantNumeric: 'tabular-nums' }}>
                {fmtAmount(prepayAmt > 0 ? amountToCollect : totalOrderAmount)} с
              </span>
            </div>
            {!canSubmit && cartItems.length === 0 && (
              <p className="flex items-center gap-1" style={{ fontSize: 11.5, color: M.muted, marginBottom: 10 }}>
                <AlertCircle size={12} /> Добавьте хотя бы один товар
              </p>
            )}
            {!canSubmit && cartItems.length > 0 && form.payMode === 'prepayment' && prepayAmt > totalOrderAmount && (
              <p className="flex items-center gap-1" style={{ fontSize: 11.5, color: '#BE123C', marginBottom: 10 }}>
                <AlertCircle size={12} /> Предоплата не может быть больше итога заказа
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleClear}
                className="flex items-center justify-center active:scale-95 transition-transform"
                style={{ width: 52, borderRadius: 14, background: '#fff', border: `1px solid ${M.borderAlt}`, color: '#76766E', cursor: 'pointer' }}
              >
                <X size={17} />
              </button>
              <button
                type="button"
                onClick={() => submitMut.mutate()}
                disabled={!canSubmit || submitMut.isPending}
                className="flex-1 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg,#6366F1,#4F46E5)', color: '#fff', border: 'none',
                  fontFamily: 'inherit', fontSize: 15.5, fontWeight: 700, padding: 16, borderRadius: 14,
                  cursor: 'pointer', boxShadow: '0 8px 20px rgba(99,102,241,.38)',
                }}
              >
                {submitMut.isPending ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Оформляем…
                  </>
                ) : (
                  <>
                    <ShoppingCart size={18} />
                    Оформить заказ
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
