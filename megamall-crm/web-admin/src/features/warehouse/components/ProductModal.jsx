import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, X } from 'lucide-react'
import Modal from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import { addProductImage, createProduct, updateProduct } from '../api'
import {
  getId,
  getProductImage,
  getProductName,
  getProductSku,
  getPurchasePrice,
  getSalePrice,
} from '../utils/warehouseHelpers'

const emptyForm = {
  name: '',
  sku: '',
  purchase_price: '',
  sale_price: '',
  image_url: '',
}

export default function ProductModal({ open, onClose, product, categories = [], suppliers = [] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const isEdit = Boolean(product)
  const [form, setForm] = useState(emptyForm)
  const [imagePreview, setImagePreview] = useState(null) // local blob URL or existing URL
  const [imageFile, setImageFile] = useState(null)       // File object for new uploads
  const fileRef = useRef()

  useEffect(() => {
    if (!open) return
    if (!product) {
      setForm(emptyForm)
      setImagePreview(null)
      setImageFile(null)
      return
    }
    const existingImage = getProductImage(product)
    setForm({
      name: getProductName(product) === '—' ? '' : getProductName(product),
      sku: getProductSku(product) === '—' ? '' : getProductSku(product),
      purchase_price: getPurchasePrice(product) ?? '',
      sale_price: getSalePrice(product) ?? '',
      image_url: existingImage ?? '',
    })
    setImagePreview(existingImage || null)
    setImageFile(null)
  }, [open, product])

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    // reset input so same file can be re-selected
    e.target.value = ''
  }

  function removeImage() {
    setImageFile(null)
    setImagePreview(null)
    setForm(prev => ({ ...prev, image_url: '' }))
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim(),
      }
      if (form.purchase_price !== '') payload.purchase_price = Number(form.purchase_price)
      if (form.sale_price !== '')     payload.sale_price     = Number(form.sale_price)

      const saved = isEdit
        ? await updateProduct(getId(product), payload)
        : await createProduct(payload)

      const productId = getId(saved) ?? getId(product)

      // Upload new image file as base64 data URL
      if (productId && imageFile) {
        const dataUrl = await fileToDataURL(imageFile)
        await addProductImage(productId, { image_url: dataUrl, is_primary: true, sort_order: 0 })
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
    setForm(prev => ({ ...prev, [field]: value }))
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
        <Field label="Название *" value={form.name} onChange={v => setField('name', v)} placeholder="Например, Пахлавон" />
        <Field label="SKU *" value={form.sku} onChange={v => setField('sku', v)} placeholder="P-001" />
        <Field label="Закупочная цена" type="number" min="0" value={form.purchase_price} onChange={v => setField('purchase_price', v)} placeholder="0" />
        <Field label="Цена продажи" type="number" min="0" value={form.sale_price} onChange={v => setField('sale_price', v)} placeholder="0" />
      </div>

      {/* Photo upload */}
      <div className="mt-4">
        <span className="input-label block mb-1.5">Фото товара</span>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        {imagePreview ? (
          <div className="relative w-32 h-32 rounded-2xl overflow-hidden border border-slate-200 group">
            <img src={imagePreview} alt="preview" className="w-full h-full object-cover" />
            <button
              onClick={removeImage}
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 w-32 h-32 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors"
          >
            <ImagePlus size={24} />
            <span className="text-[11px] font-medium">Загрузить</span>
          </button>
        )}
        {imagePreview && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-2 text-[11.5px] text-indigo-500 hover:underline"
          >
            Заменить фото
          </button>
        )}
      </div>
    </Modal>
  )
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
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
        onChange={e => onChange(e.target.value)}
      />
    </label>
  )
}
