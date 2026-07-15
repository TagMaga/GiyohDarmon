import { useState, useMemo, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Search, Package, Plus, Minus, Trash2, Store, CheckCircle2 } from 'lucide-react'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import { fetchSellers, createOfficeOrder } from '../api'
import { fetchCustomers, createCustomer, fetchProducts, fetchCities } from '../../seller/api'

const EMPTY = {
  phone: '', customerId: null, fullName: '', cityId: '', city: '', address: '',
  cartItems: [],
  deliveryMode: 'normal',
  sellerId: '',
  forceStatus: 'confirmed',
}

export default function CreateOfficeOrderModal({ open, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [form, setForm] = useState(EMPTY)
  const [productSearch, setProductSearch] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')

  const { data: sellersRaw = [] } = useQuery({
    queryKey: KEYS.dispatcher.sellers,
    queryFn: fetchSellers,
    staleTime: 5 * 60_000,
    enabled: open,
  })
  const { data: customersRaw = [] } = useQuery({
    queryKey: KEYS.seller.customers,
    queryFn: fetchCustomers,
    staleTime: 60_000,
    enabled: open,
  })
  const { data: productsRaw = [], isLoading: prodLoading } = useQuery({
    queryKey: KEYS.seller.products,
    queryFn: fetchProducts,
    staleTime: 5 * 60_000,
    enabled: open,
  })
  const { data: cities = [] } = useQuery({
    queryKey: ['cities', 'active'],
    queryFn: fetchCities,
    staleTime: 5 * 60_000,
    enabled: open,
  })

  const sellers = Array.isArray(sellersRaw) ? sellersRaw : []
  const customers = Array.isArray(customersRaw) ? customersRaw : []
  const products = Array.isArray(productsRaw) ? productsRaw : []

  const setField = useCallback((key, val) => setForm((p) => ({ ...p, [key]: val })), [])

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return products.slice(0, 12)
    return products.filter((p) =>
      p.name?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    ).slice(0, 12)
  }, [products, productSearch])

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase()
    if (!q) return []
    return customers.filter((c) =>
      c.phone?.includes(q) || c.full_name?.toLowerCase().includes(q)
    ).slice(0, 6)
  }, [customers, customerSearch])

  const cartItems = form.cartItems

  function addToCart(product) {
    setForm((prev) => {
      const cart = prev.cartItems
      const idx = cart.findIndex((i) => i.product_id === product.id)
      if (idx >= 0) {
        return { ...prev, cartItems: cart.map((item, i) =>
          i === idx ? { ...item, quantity: item.quantity + 1, total_price: item.unit_price * (item.quantity + 1) } : item
        )}
      }
      const unitPrice = Number(product.sale_price ?? product.base_price ?? 0)
      return { ...prev, cartItems: [...cart, {
        product_id: product.id, name: product.name, sku: product.sku ?? '',
        quantity: 1, unit_price: unitPrice, total_price: unitPrice,
      }]}
    })
  }

  function changeQty(idx, delta) {
    setForm((prev) => {
      const cart = [...prev.cartItems]
      const item = cart[idx]
      const newQty = item.quantity + delta
      if (newQty <= 0) {
        cart.splice(idx, 1)
      } else {
        cart[idx] = { ...item, quantity: newQty, total_price: item.unit_price * newQty }
      }
      return { ...prev, cartItems: cart }
    })
  }

  function removeFromCart(idx) {
    setForm((prev) => ({ ...prev, cartItems: prev.cartItems.filter((_, i) => i !== idx) }))
  }

  function selectCustomer(c) {
    setForm((prev) => ({
      ...prev, customerId: c.id, fullName: c.full_name ?? '',
      phone: c.phone ?? prev.phone, city: c.city ?? '', address: c.address ?? '',
    }))
    setCustomerSearch('')
  }

  const productTotal = useMemo(() => cartItems.reduce((s, i) => s + (Number(i.total_price) || 0), 0), [cartItems])

  const canSubmit = form.sellerId && (form.customerId || form.phone.trim().length >= 5) && cartItems.length > 0 && form.cityId

  const { mutate: submit, isPending } = useMutation({
    mutationFn: async () => {
      let cid = form.customerId
      if (!cid) {
        const newCust = await createCustomer({
          full_name: form.fullName.trim() || form.phone.trim(),
          phone: form.phone.trim(),
          city: form.city || undefined,
          address: form.address.trim() || undefined,
          source: 'phone',
        })
        cid = newCust.id
      }

      return createOfficeOrder({
        customer_id:     cid,
        city_id:         form.cityId,
        order_type:      'seller_order',
        delivery_method: form.deliveryMode,
        seller_id:       form.sellerId,
        force_status:    form.forceStatus,
        items: cartItems.map((it) => ({
          product_id: it.product_id,
          quantity:   it.quantity,
          unit_price: it.unit_price,
        })),
        delivery_address: form.address.trim() || undefined,
      })
    },
    onSuccess: () => {
      toast.success('Офисный заказ создан')
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.newOrders })
      setForm(EMPTY)
      setProductSearch('')
      setCustomerSearch('')
      onClose()
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка создания заказа')
    },
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose}>
      <div
        className="relative flex flex-col w-full max-w-2xl max-h-[90vh] rounded-2xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Store size={18} style={{ color: 'var(--blue-text)' }} />
            <span className="font-semibold" style={{ color: 'var(--text1)', fontSize: 15 }}>Офисный заказ</span>
          </div>
          <button onClick={onClose} className="dv2-icon-btn"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Seller + Status row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="dv2-field-label">Продавец *</label>
              <select
                className="dv2-cash-select w-full"
                value={form.sellerId}
                onChange={(e) => setField('sellerId', e.target.value)}
              >
                <option value="">— выберите продавца —</option>
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name} {s.phone ? `(${s.phone})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="dv2-field-label">Статус заказа</label>
              <select
                className="dv2-cash-select w-full"
                value={form.forceStatus}
                onChange={(e) => setField('forceStatus', e.target.value)}
              >
                <option value="confirmed">Подтверждён</option>
                <option value="new">Новый</option>
              </select>
            </div>
          </div>

          {/* Customer */}
          <div>
            <label className="dv2-field-label">Клиент *</label>
            {form.customerId ? (
              <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)' }}>
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} style={{ color: 'var(--blue-text)' }} />
                  <div>
                    <div className="text-xs font-semibold" style={{ color: 'var(--text1)' }}>{form.fullName}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text3)' }}>{form.phone}</div>
                  </div>
                </div>
                <button onClick={() => setForm((p) => ({ ...p, customerId: null, fullName: '', phone: '', city: '', address: '' }))} className="dv2-icon-btn"><X size={13} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)' }} />
                <input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Имя или телефон клиента…"
                  className="dv2-cash-select w-full"
                  style={{ paddingLeft: 30 }}
                />
                {filteredCustomers.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-10" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
                    {filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => selectCustomer(c)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--bg2)]"
                        style={{ color: 'var(--text1)', borderBottom: '1px solid var(--border)' }}
                      >
                        <span className="font-medium">{c.full_name}</span>
                        <span style={{ color: 'var(--text3)' }}> · {c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
                {customerSearch && filteredCustomers.length === 0 && (
                  <div className="mt-2">
                    <div className="text-[11px] mb-1.5" style={{ color: 'var(--text3)' }}>Новый клиент:</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={form.phone} onChange={(e) => setField('phone', e.target.value)}
                        placeholder="Телефон" className="dv2-cash-select" style={{ fontSize: 12 }} />
                      <input value={form.fullName} onChange={(e) => setField('fullName', e.target.value)}
                        placeholder="Имя" className="dv2-cash-select" style={{ fontSize: 12 }} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Phone for new customer when no search results */}
          {!form.customerId && !customerSearch && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="dv2-field-label">Телефон *</label>
                <input value={form.phone} onChange={(e) => setField('phone', e.target.value)}
                  placeholder="+996…" className="dv2-cash-select w-full" style={{ fontSize: 13 }} />
              </div>
              <div>
                <label className="dv2-field-label">Имя</label>
                <input value={form.fullName} onChange={(e) => setField('fullName', e.target.value)}
                  placeholder="Имя клиента" className="dv2-cash-select w-full" style={{ fontSize: 13 }} />
              </div>
            </div>
          )}

          {/* City + Address */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="dv2-field-label">Город *</label>
              <select className="dv2-cash-select w-full" value={form.cityId} onChange={(e) => {
                const city = cities.find((c) => c.id === e.target.value)
                setForm((p) => ({ ...p, cityId: e.target.value, city: city?.name ?? '' }))
              }}>
                <option value="">— выберите город —</option>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="dv2-field-label">Адрес</label>
              <input value={form.address} onChange={(e) => setField('address', e.target.value)}
                placeholder="Адрес доставки" className="dv2-cash-select w-full" style={{ fontSize: 13 }} />
            </div>
          </div>

          {/* Delivery mode */}
          <div>
            <label className="dv2-field-label">Способ доставки</label>
            <div className="flex gap-2">
              {[{ val: 'normal', label: 'Обычная' }, { val: 'fast', label: 'Быстрая' }].map(({ val, label }) => (
                <button
                  key={val}
                  onClick={() => setField('deliveryMode', val)}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    background: form.deliveryMode === val ? 'var(--accent)' : 'var(--bg2)',
                    color: form.deliveryMode === val ? '#fff' : 'var(--text2)',
                    border: '1px solid ' + (form.deliveryMode === val ? 'var(--blue)' : 'var(--border)'),
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Product search */}
          <div>
            <label className="dv2-field-label">Товары *</label>
            <div className="relative mb-2">
              <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)' }} />
              <input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Поиск товара…"
                className="dv2-cash-select w-full"
                style={{ paddingLeft: 30 }}
              />
            </div>
            {prodLoading ? (
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--bg2)' }} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 max-h-44 overflow-y-auto">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { addToCart(p); setProductSearch('') }}
                    className="text-left p-2.5 rounded-xl transition-colors hover:bg-[var(--bg2)]"
                    style={{ border: '1px solid var(--border)', background: 'var(--bg3)' }}
                  >
                    <Package size={12} style={{ color: 'var(--text3)', marginBottom: 4 }} />
                    <div className="text-[11px] font-semibold leading-tight" style={{ color: 'var(--text1)' }}>{p.name}</div>
                    {(p.sale_price ?? p.base_price) != null && (
                      <div className="text-[10px] mt-0.5" style={{ color: 'var(--blue-text)' }}>
                        {Number(p.sale_price ?? p.base_price).toLocaleString('ru-RU')} с
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cart */}
          {cartItems.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="dv2-field-label" style={{ marginBottom: 0 }}>Корзина</label>
                <span className="text-xs font-bold" style={{ color: 'var(--blue-text)' }}>
                  {productTotal.toLocaleString('ru-RU')} с
                </span>
              </div>
              <div className="space-y-2">
                {cartItems.map((item, idx) => (
                  <div key={item.product_id} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--text1)' }}>{item.name}</div>
                      <div className="text-[10px]" style={{ color: 'var(--text3)' }}>{item.unit_price.toLocaleString('ru-RU')} с / шт</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => changeQty(idx, -1)} className="dv2-icon-btn" style={{ padding: '2px 4px' }}><Minus size={11} /></button>
                      <span className="text-xs font-bold w-5 text-center" style={{ color: 'var(--text1)' }}>{item.quantity}</span>
                      <button onClick={() => changeQty(idx, 1)} className="dv2-icon-btn" style={{ padding: '2px 4px' }}><Plus size={11} /></button>
                    </div>
                    <span className="text-xs font-semibold w-16 text-right" style={{ color: 'var(--text1)' }}>
                      {item.total_price.toLocaleString('ru-RU')} с
                    </span>
                    <button onClick={() => removeFromCart(idx)} className="dv2-icon-btn text-rose-500"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="dv2-btn dv2-btn-ghost">Отмена</button>
          <button
            onClick={() => submit()}
            disabled={!canSubmit || isPending}
            className="dv2-btn dv2-btn-primary"
            style={{ opacity: (!canSubmit || isPending) ? 0.5 : 1 }}
          >
            {isPending ? 'Создание…' : 'Создать заказ'}
          </button>
        </div>
      </div>
    </div>
  )
}
