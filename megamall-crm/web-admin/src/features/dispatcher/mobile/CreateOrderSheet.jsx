import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Package, CheckCircle2, X } from 'lucide-react'
import Sheet, { SheetTitle, SheetPrimaryButton } from './Sheet'
import { C, chipStyle } from './theme'
import { KEYS } from '../../../shared/queryKeys'
import { useToast } from '../../../shared/components/ToastProvider'
import { fetchSellers, fetchCities, createOfficeOrder } from '../api'
import { fetchCustomers, createCustomer, fetchProducts } from '../../seller/api'

const EMPTY = {
  phone: '', customerId: null, fullName: '', cityId: '', city: '', address: '',
  cartItems: [], deliveryMode: 'normal', sellerId: '', forceStatus: 'confirmed',
}

export default function CreateOrderSheet({ open, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [form, setForm] = useState(EMPTY)
  const [productSearch, setProductSearch] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')

  const { data: sellersRaw = [] } = useQuery({ queryKey: KEYS.dispatcher.sellers, queryFn: fetchSellers, staleTime: 5 * 60_000, enabled: open })
  const { data: customersRaw = [] } = useQuery({ queryKey: KEYS.seller.customers, queryFn: fetchCustomers, staleTime: 60_000, enabled: open })
  const { data: productsRaw = [], isLoading: prodLoading } = useQuery({ queryKey: KEYS.seller.products, queryFn: fetchProducts, staleTime: 5 * 60_000, enabled: open })
  const { data: cities = [] } = useQuery({ queryKey: ['cities', 'active'], queryFn: fetchCities, staleTime: 5 * 60_000, enabled: open })

  const sellers = Array.isArray(sellersRaw) ? sellersRaw : []
  const customers = Array.isArray(customersRaw) ? customersRaw : []
  const products = Array.isArray(productsRaw) ? productsRaw : []

  const setField = useCallback((key, val) => setForm((p) => ({ ...p, [key]: val })), [])

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return products.slice(0, 12)
    return products.filter((p) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)).slice(0, 12)
  }, [products, productSearch])

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase()
    if (!q) return []
    return customers.filter((c) => c.phone?.includes(q) || c.full_name?.toLowerCase().includes(q)).slice(0, 6)
  }, [customers, customerSearch])

  const cartItems = form.cartItems

  function addToCart(product) {
    setForm((prev) => {
      const cart = prev.cartItems
      const idx = cart.findIndex((i) => i.product_id === product.id)
      if (idx >= 0) {
        return { ...prev, cartItems: cart.map((item, i) => i === idx ? { ...item, quantity: item.quantity + 1, total_price: item.unit_price * (item.quantity + 1) } : item) }
      }
      const unitPrice = Number(product.sale_price ?? product.base_price ?? 0)
      return { ...prev, cartItems: [...cart, { product_id: product.id, name: product.name, quantity: 1, unit_price: unitPrice, total_price: unitPrice }] }
    })
  }

  function selectCustomer(c) {
    setForm((prev) => ({ ...prev, customerId: c.id, fullName: c.full_name ?? '', phone: c.phone ?? prev.phone, city: c.city ?? '', address: c.address ?? '' }))
    setCustomerSearch('')
  }

  const productTotal = useMemo(() => cartItems.reduce((s, i) => s + (Number(i.total_price) || 0), 0), [cartItems])
  const canSubmit = form.sellerId && (form.customerId || form.phone.trim().length >= 5) && cartItems.length > 0 && form.cityId

  const { mutate: submit, isPending } = useMutation({
    mutationFn: async () => {
      let cid = form.customerId
      if (!cid) {
        const newCust = await createCustomer({
          full_name: form.fullName.trim() || form.phone.trim(), phone: form.phone.trim(),
          city: form.city || undefined, address: form.address.trim() || undefined, source: 'phone',
        })
        cid = newCust.id
      }
      return createOfficeOrder({
        customer_id: cid, city_id: form.cityId, order_type: 'seller_order',
        delivery_method: form.deliveryMode, seller_id: form.sellerId, force_status: form.forceStatus,
        items: cartItems.map((it) => ({ product_id: it.product_id, quantity: it.quantity, unit_price: it.unit_price })),
        delivery_address: form.address.trim() || undefined,
      })
    },
    onSuccess: () => {
      toast.success('Офисный заказ создан')
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.newOrders })
      reset()
      onClose()
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка создания заказа'),
  })

  function reset() {
    setForm(EMPTY)
    setProductSearch('')
    setCustomerSearch('')
  }

  if (!open) return null

  return (
    <Sheet open={open} onClose={onClose} maxHeight="92%" zIndex={41}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 16px' }}>
        <Package size={18} color={C.violetDk} />
        <span style={{ fontSize: 17, fontWeight: 900 }}>Офисный заказ</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <Field label="Продавец" required>
          <select value={form.sellerId} onChange={(e) => setField('sellerId', e.target.value)} style={selectStyle}>
            <option value="">— выберите —</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </Field>
        <Field label="Статус">
          <select value={form.forceStatus} onChange={(e) => setField('forceStatus', e.target.value)} style={selectStyle}>
            <option value="confirmed">Подтверждён</option>
            <option value="new">Новый</option>
          </select>
        </Field>
      </div>

      <Field label="Клиент" required>
        {form.customerId ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: 12, background: C.violetBg, border: `1px solid ${C.violet}55` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={14} color={C.violetDk} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{form.fullName}</div>
                <div style={{ fontSize: 10.5, color: C.text3 }}>{form.phone}</div>
              </div>
            </div>
            <button onClick={() => setForm((p) => ({ ...p, customerId: null, fullName: '', phone: '', city: '', address: '' }))} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.text3 }}><X size={14} /></button>
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <Search size={14} color={C.text3} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Имя или телефон клиента…" style={{ ...inputStyle, paddingLeft: 34 }} />
            {filteredCustomers.length > 0 && (
              <div className="dm-scroll" style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, borderRadius: 12, overflow: 'hidden', zIndex: 5, background: '#fff', border: `1px solid ${C.border}`, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', maxHeight: 180, overflowY: 'auto' }}>
                {filteredCustomers.map((c) => (
                  <button key={c.id} onClick={() => selectCustomer(c)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', fontSize: 12, border: 'none', background: 'transparent', borderBottom: `1px solid ${C.border2}`, cursor: 'pointer' }}>
                    <span style={{ fontWeight: 600 }}>{c.full_name}</span> <span style={{ color: C.text3 }}>· {c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Field>

      {!form.customerId && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <Field label="Телефон" required>
            <input value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+996 …" style={inputStyle} />
          </Field>
          <Field label="Имя">
            <input value={form.fullName} onChange={(e) => setField('fullName', e.target.value)} placeholder="Имя клиента" style={inputStyle} />
          </Field>
        </div>
      )}

      <Field label="Город" required>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {cities.map((c) => (
            <button key={c.id} onClick={() => setForm((p) => ({ ...p, cityId: c.id, city: c.name }))} style={{ padding: '9px 14px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, ...chipStyle(form.cityId === c.id) }}>{c.name}</button>
          ))}
        </div>
      </Field>

      <div style={{ marginBottom: 14 }}>
        <input value={form.address} onChange={(e) => setField('address', e.target.value)} placeholder="Адрес доставки" style={inputStyle} />
      </div>

      <Field label="Способ доставки">
        <div style={{ display: 'flex', gap: 8 }}>
          {[['normal', 'Обычная'], ['express', 'Быстрая ⚡']].map(([v, l]) => (
            <button key={v} onClick={() => setField('deliveryMode', v)} style={{ padding: '9px 16px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, ...chipStyle(form.deliveryMode === v) }}>{l}</button>
          ))}
        </div>
      </Field>

      <Field label="Товары" required>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search size={14} color={C.text3} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Поиск товара…" style={{ ...inputStyle, paddingLeft: 34 }} />
        </div>
        {prodLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ height: 56, borderRadius: 12, background: C.border2 }} />)}
          </div>
        ) : (
          <div className="dm-scroll" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, maxHeight: 168, overflowY: 'auto' }}>
            {filteredProducts.map((p) => (
              <button key={p.id} onClick={() => { addToCart(p); setProductSearch('') }} style={{ textAlign: 'left', padding: 10, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${C.border}`, background: C.cardAlt }}>
                <Package size={13} color={C.text3} style={{ marginBottom: 5 }} />
                <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>{p.name}</div>
                <div style={{ fontSize: 10, color: C.violetDk, marginTop: 2 }}>{(p.sale_price ?? p.base_price ?? 0).toLocaleString('ru-RU')} сом</div>
              </button>
            ))}
          </div>
        )}
      </Field>

      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 13, padding: '4px 13px', marginBottom: 16 }}>
        {cartItems.length === 0 ? (
          <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 11.5, color: C.text3 }}>Выберите товары выше</div>
        ) : cartItems.map((it, i) => (
          <div key={it.product_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: i < cartItems.length - 1 ? `1px solid ${C.border2}` : 'none' }}>
            <span style={{ fontSize: 12.5 }}>{it.name} ×{it.quantity}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>{it.total_price.toLocaleString('ru-RU')} сом</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 14px' }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>Итого</span>
        <span style={{ fontSize: 19, fontWeight: 900, color: C.violetDk }}>{productTotal.toLocaleString('ru-RU')} сом</span>
      </div>

      <SheetPrimaryButton onClick={() => canSubmit && submit()} disabled={!canSubmit || isPending}>
        {isPending ? 'Создание…' : 'Создать заказ'}
      </SheetPrimaryButton>
    </Sheet>
  )
}

const inputStyle = {
  width: '100%', border: `1px solid ${C.border}`, background: '#fff', borderRadius: 12,
  padding: '12px 13px', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
const selectStyle = { ...inputStyle, padding: '11px 12px', fontSize: 12.5, color: C.text1 }

function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.text3, padding: '0 2px 6px' }}>{label}{required && ' *'}</div>
      {children}
    </div>
  )
}
