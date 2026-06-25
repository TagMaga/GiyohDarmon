import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import { addProductImage, createProduct, updateProduct } from '../api'
import {
  getId,
  getProductBarcode,
  getProductCategoryId,
  getProductImage,
  getProductName,
  getProductSku,
  getProductSupplierId,
  getPurchasePrice,
  getSalePrice,
  isUUID,
} from '../utils/warehouseHelpers'

const emptyForm = {
  name: '',
  sku: '',
  barcode: '',
  category_id: '',
  supplier_id: '',
  purchase_price: '',
  sale_price: '',
  image_url: '',
  normal_delivery_fee:  '',
  express_delivery_fee: '',
}

export default function ProductModal({ open, onClose, product, categories = [], suppliers = [] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const isEdit = Boolean(product)
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    if (!open) return
    if (!product) {
      setForm(emptyForm)
      return
    }
    setForm({
      name: getProductName(product) === '—' ? '' : getProductName(product),
      sku: getProductSku(product) === '—' ? '' : getProductSku(product),
      barcode: getProductBarcode(product) === '—' ? '' : getProductBarcode(product),
      category_id: getProductCategoryId(product) ?? '',
      supplier_id: getProductSupplierId(product) ?? '',
      purchase_price: getPurchasePrice(product) ?? '',
      sale_price: getSalePrice(product) ?? '',
      image_url: getProductImage(product) ?? '',
      normal_delivery_fee:  product?.normal_delivery_fee  ?? product?.NormalDeliveryFee  ?? '',
      express_delivery_fee: product?.express_delivery_fee ?? product?.ExpressDeliveryFee ?? '',
    })
  }, [open, product])

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = normalizePayload(form, isEdit)
      const saved = isEdit
        ? await updateProduct(getId(product), payload)
        : await createProduct(payload)

      const productId = getId(saved) ?? getId(product)
      const existingImage = getProductImage(product)
      if (productId && form.image_url.trim() && form.image_url.trim() !== existingImage) {
        await addProductImage(productId, {
          image_url: form.image_url.trim(),
          is_primary: true,
          sort_order: 0,
        })
      }
      return saved
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.warehouse.products })
      toast.success(isEdit ? 'Товар обновлён' : 'Товар создан')
      onClose()
    },
  })

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const errMsg = mutation.error?.response?.data?.error?.message ?? mutation.error?.message
  const canSubmit = form.name.trim() && form.sku.trim()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Редактировать товар' : 'Добавить товар'}
      description="Карточка товара для склада и продаж"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Отмена</Button>
          <Button variant="primary" onClick={() => canSubmit && mutation.mutate()} loading={mutation.isPending} disabled={!canSubmit}>
            {isEdit ? 'Сохранить' : 'Создать товар'}
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Название *" value={form.name} onChange={(v) => setField('name', v)} placeholder="Например, iPhone 15 Pro" />
        <Field label="SKU *" value={form.sku} onChange={(v) => setField('sku', v)} placeholder="SKU-001" />
        <Field label="Штрихкод" value={form.barcode} onChange={(v) => setField('barcode', v)} placeholder="Штрихкод" />
        <Field label="Ссылка на изображение" value={form.image_url} onChange={(v) => setField('image_url', v)} placeholder="https://..." />
        <SelectField label="Категория" value={form.category_id} onChange={(v) => setField('category_id', v)} options={categories} />
        <SelectField label="Поставщик" value={form.supplier_id} onChange={(v) => setField('supplier_id', v)} options={suppliers} />
        <Field label="Закупочная цена" type="number" min="0" value={form.purchase_price} onChange={(v) => setField('purchase_price', v)} placeholder="0" />
        <Field label="Цена продажи" type="number" min="0" value={form.sale_price} onChange={(v) => setField('sale_price', v)} placeholder="0" />
        <Field label="Доставка (обычная)" type="number" min="0" value={form.normal_delivery_fee} onChange={(v) => setField('normal_delivery_fee', v)} placeholder="Глобальные настройки" />
        <Field label="Доставка (экспресс)" type="number" min="0" value={form.express_delivery_fee} onChange={(v) => setField('express_delivery_fee', v)} placeholder="Глобальные настройки" />
      </div>

      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-xs font-medium text-amber-800">Минимальный порог хранится в остатках, а не в карточке товара.</p>
        <p className="text-xs text-amber-700 mt-0.5">Текущий backend не предоставляет endpoint для изменения порога из создания или редактирования товара.</p>
      </div>
    </Modal>
  )
}

function normalizePayload(form, isEdit) {
  const payload = {
    name: form.name.trim(),
    sku: form.sku.trim(),
  }
  if (form.barcode.trim()) payload.barcode = form.barcode.trim()
  if (form.category_id) payload.category_id = form.category_id
  if (form.supplier_id) payload.supplier_id = form.supplier_id
  if (form.purchase_price !== '') payload.purchase_price = Number(form.purchase_price)
  if (form.sale_price !== '') payload.sale_price = Number(form.sale_price)
  if (form.normal_delivery_fee !== '')  payload.normal_delivery_fee  = Number(form.normal_delivery_fee)
  if (form.express_delivery_fee !== '') payload.express_delivery_fee = Number(form.express_delivery_fee)

  if (isEdit) {
    return payload
  }
  return payload
}

function Field({ label, value, onChange, type = 'text', placeholder, min }) {
  return (
    <label>
      <span className="input-label">{label}</span>
      <input
        className="input"
        type={type}
        min={min}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label>
      <span className="input-label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Не выбрано</option>
        {options.filter((o) => isUUID(getId(o))).map((o) => (
          <option key={getId(o)} value={getId(o)}>{o.name ?? o.Name}</option>
        ))}
      </select>
    </label>
  )
}
